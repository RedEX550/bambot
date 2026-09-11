import { EmbedBuilder, PermissionFlagsBits, type GuildMember, type Message } from "discord.js";
import type { AutomodAction, AutomodConfig, CoreConfig } from "@bambot/shared";
import { COLORS, EMOJI } from "@bambot/shared";
import type { BambotClient } from "../core/client";
import { prisma } from "../core/db";
import { childLogger } from "../core/logger";
import { bumpDailyStat } from "../lib/stats";
import { clamp } from "../lib/embeds";
import { isExempt } from "../lib/permissions";
import { createCase } from "./moderation";

const log = childLogger("automod");

export interface RuleHit {
  rule: string;
  reason: string;
  action: AutomodAction;
  timeoutSeconds: number;
  points: number;
  notifyUser: boolean;
}

/** Rolling per-member state for the rate-based rules. Memory only, by design. */
interface MemberState {
  timestamps: number[];
  recent: { content: string; channelId: string; at: number; messageId: string }[];
  stickers: number[];
  heat: { points: number; at: number }[];
}

const state = new Map<string, MemberState>();

const stateFor = (guildId: string, userId: string): MemberState => {
  const key = `${guildId}:${userId}`;
  let entry = state.get(key);
  if (!entry) {
    entry = { timestamps: [], recent: [], stickers: [], heat: [] };
    state.set(key, entry);
  }
  return entry;
};

// Keep the map from growing without bound on a large server.
setInterval(() => {
  const cutoff = Date.now() - 900_000;
  for (const [key, entry] of state) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    entry.recent = entry.recent.filter((r) => r.at > cutoff);
    entry.stickers = entry.stickers.filter((t) => t > cutoff);
    entry.heat = entry.heat.filter((h) => h.at > cutoff);
    if (!entry.timestamps.length && !entry.recent.length && !entry.heat.length) state.delete(key);
  }
}, 300_000).unref();

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

const INVITE_RE = /(?:discord\.(?:gg|io|me|li)|discord(?:app)?\.com\/invite)\/([a-z0-9-_]+)/gi;
const URL_RE = /https?:\/\/([^\s/$.?#][^\s/]*)/gi;
const EMOJI_RE = /<a?:\w+:\d+>|\p{Extended_Pictographic}/gu;
const ZALGO_RE = /[̀-ͯ҃-҉᪰-᫿᷀-᷿⃐-⃰]/g;

/**
 * Phrase clusters seen in scams aimed at 3D-printing communities.
 * Scoring beats a keyword blocklist here: "free" alone is harmless, "free
 * printer giveaway click here" is not. Each cluster contributes once.
 */
const SCAM_CLUSTERS: { name: string; weight: number; patterns: RegExp[] }[] = [
  {
    name: "giveaway-bait",
    weight: 2,
    patterns: [/free\s+(3d\s+)?printer/i, /printer\s+giveaway/i, /claim\s+your\s+(free|prize)/i, /you\s+(have\s+)?won/i, /selected\s+as\s+(a\s+)?winner/i],
  },
  {
    name: "urgency",
    weight: 1,
    patterns: [/act\s+(now|fast)/i, /limited\s+(time|spots)/i, /only\s+\d+\s+left/i, /expires\s+(in|today)/i, /hurry/i],
  },
  {
    name: "crypto",
    weight: 2,
    patterns: [/\b(btc|eth|usdt|bitcoin|ethereum)\b/i, /crypto\s+(giveaway|investment|signal)/i, /\bairdrop\b/i, /wallet\s+address/i, /seed\s+phrase/i],
  },
  {
    name: "credential-phish",
    weight: 3,
    patterns: [/verify\s+your\s+account/i, /confirm\s+your\s+(password|login|identity)/i, /account\s+(will\s+be\s+)?suspended/i, /log\s?in\s+(here|below)\s+to/i],
  },
  {
    name: "staff-impersonation",
    weight: 3,
    patterns: [/i\s?am\s+(a\s+)?(bambu|discord)\s+(staff|admin|support)/i, /official\s+support\s+will\s+dm/i, /contact\s+me\s+for\s+support/i],
  },
  {
    name: "nitro-bait",
    weight: 2,
    patterns: [/free\s+(discord\s+)?nitro/i, /steam\s+gift/i, /\bnitro\s+giveaway\b/i],
  },
  {
    name: "dm-push",
    weight: 1,
    patterns: [/dm\s+me\b/i, /add\s+me\s+on\s+(telegram|whatsapp)/i, /message\s+me\s+privately/i],
  },
];

/** Domains that look like bambulab.com but are not. */
const LOOKALIKE_RE =
  /\b(?:bamb[uo]{1,2}-?labs?|bambulab[a-z0-9-]+|bambu[il1]ab|bmbulab|barnbulab)\.(?!com\b)[a-z]{2,}\b|\bbambulab\.(?!com\b|com\.)[a-z]{2,}\b/i;

const domainOf = (host: string): string => host.toLowerCase().replace(/^www\./, "");

const matchesDomain = (host: string, list: string[]): boolean => {
  const clean = domainOf(host);
  return list.some((entry) => {
    const target = entry.toLowerCase().replace(/^www\./, "").replace(/^\*\./, "");
    return clean === target || clean.endsWith(`.${target}`);
  });
};

/** Normalises letter substitution so "fr33 pr1nter" still matches. */
const deLeet = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[0]/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/[3]/g, "e")
    .replace(/[4@]/g, "a")
    .replace(/[5$]/g, "s")
    .replace(/[7]/g, "t")
    .replace(/[^a-z0-9\s]/g, "");

export const scoreScam = (content: string, extraPhrases: string[], checkLookalikes: boolean): { score: number; hits: string[] } => {
  const hits: string[] = [];
  let score = 0;

  for (const cluster of SCAM_CLUSTERS) {
    if (cluster.patterns.some((p) => p.test(content))) {
      score += cluster.weight;
      hits.push(cluster.name);
    }
  }

  if (checkLookalikes && LOOKALIKE_RE.test(content)) {
    score += 4;
    hits.push("lookalike-domain");
  }

  const normalised = deLeet(content);
  for (const phrase of extraPhrases) {
    if (phrase && normalised.includes(deLeet(phrase))) {
      score += 2;
      hits.push(`custom:${phrase}`);
      break;
    }
  }

  // A link plus any scam signal is much more likely to be real.
  if (score > 0 && URL_RE.test(content)) {
    score += 1;
    hits.push("with-link");
  }
  URL_RE.lastIndex = 0;

  return { score, hits };
};

// ---------------------------------------------------------------------------
// Rule evaluation
// ---------------------------------------------------------------------------

type RuleConfig = {
  enabled: boolean;
  action: AutomodAction;
  timeoutSeconds: number;
  points: number;
  notifyUser: boolean;
  exemptRoles: string[];
  exemptChannels: string[];
};

const ruleApplies = (rule: RuleConfig, member: GuildMember, channelId: string, strict: boolean): boolean => {
  if (!rule.enabled) return false;
  if (rule.exemptChannels.includes(channelId)) return false;
  // Strict mode ignores role exemptions: a brand new account gets no free pass.
  if (!strict && rule.exemptRoles.some((r) => member.roles.cache.has(r))) return false;
  return true;
};

const hitFrom = (rule: RuleConfig, name: string, reason: string): RuleHit => ({
  rule: name,
  reason,
  action: rule.action,
  timeoutSeconds: rule.timeoutSeconds,
  points: rule.points,
  notifyUser: rule.notifyUser,
});

/**
 * Runs every enabled filter against a message and returns the first hit.
 *
 * Order is deliberate: the cheap structural checks (mentions, caps, emoji) run
 * before the regex-heavy scam scorer, and the rate rules run last because they
 * mutate state.
 */
export const evaluateMessage = (
  message: Message<true>,
  member: GuildMember,
  cfg: AutomodConfig,
  strict: boolean,
): RuleHit | null => {
  const content = message.content ?? "";
  const channelId = message.channelId;

  // --- invites -------------------------------------------------------------
  if (ruleApplies(cfg.invites, member, channelId, strict)) {
    const matches = [...content.matchAll(INVITE_RE)];
    if (matches.length) {
      const allowed = cfg.invites.allowOwnServer;
      const foreign = !allowed || matches.some(() => true);
      if (foreign && !cfg.invites.allowedGuildIds.length) {
        return hitFrom(cfg.invites, "invites", "Posted a Discord invite link");
      }
    }
    INVITE_RE.lastIndex = 0;
  }

  // --- mentions ------------------------------------------------------------
  if (ruleApplies(cfg.mentions, member, channelId, strict)) {
    const userMentions = message.mentions.users.size;
    const roleMentions = message.mentions.roles.size;
    if (userMentions > cfg.mentions.maxPerMessage) {
      return hitFrom(cfg.mentions, "mentions", `Mentioned ${userMentions} members in one message`);
    }
    if (roleMentions > cfg.mentions.maxRoleMentions) {
      return hitFrom(cfg.mentions, "mentions", `Mentioned ${roleMentions} roles in one message`);
    }
    if (cfg.mentions.banEveryoneAttempts && message.mentions.everyone) {
      return { ...hitFrom(cfg.mentions, "mentions", "Attempted an @everyone ping"), action: "ban" };
    }
  }

  // --- caps ----------------------------------------------------------------
  if (ruleApplies(cfg.caps, member, channelId, strict) && content.length >= cfg.caps.minLength) {
    const letters = content.replace(/[^a-zA-Z]/g, "");
    if (letters.length >= cfg.caps.minLength) {
      const upper = letters.replace(/[^A-Z]/g, "").length;
      const percent = Math.round((upper / letters.length) * 100);
      if (percent >= cfg.caps.percent) {
        return hitFrom(cfg.caps, "caps", `${percent}% of the message was uppercase`);
      }
    }
  }

  // --- emoji ---------------------------------------------------------------
  if (ruleApplies(cfg.emoji, member, channelId, strict)) {
    const count = (content.match(EMOJI_RE) ?? []).length;
    if (count > cfg.emoji.maxPerMessage) {
      return hitFrom(cfg.emoji, "emoji", `${count} emoji in one message`);
    }
  }

  // --- walls of text -------------------------------------------------------
  if (ruleApplies(cfg.walls, member, channelId, strict)) {
    const newlines = (content.match(/\n/g) ?? []).length;
    if (newlines > cfg.walls.maxNewlines) return hitFrom(cfg.walls, "walls", `${newlines} line breaks in one message`);
    if (content.length > cfg.walls.maxLength) return hitFrom(cfg.walls, "walls", `Message was ${content.length} characters`);
  }

  // --- zalgo ---------------------------------------------------------------
  if (ruleApplies(cfg.zalgo, member, channelId, strict)) {
    const marks = (content.match(ZALGO_RE) ?? []).length;
    if (marks > 8 && marks / Math.max(content.length, 1) > 0.1) {
      return hitFrom(cfg.zalgo, "zalgo", "Message used combining-character abuse");
    }
  }

  // --- attachments ---------------------------------------------------------
  if (ruleApplies(cfg.attachments, member, channelId, strict) && message.attachments.size) {
    if (message.attachments.size > cfg.attachments.maxPerMessage) {
      return hitFrom(cfg.attachments, "attachments", `${message.attachments.size} attachments in one message`);
    }
    for (const attachment of message.attachments.values()) {
      const ext = attachment.name.split(".").pop()?.toLowerCase() ?? "";
      if (cfg.attachments.blockedExtensions.map((e) => e.toLowerCase()).includes(ext)) {
        return hitFrom(cfg.attachments, "attachments", `Uploaded a blocked file type (.${ext})`);
      }
    }
  }

  // --- links ---------------------------------------------------------------
  if (ruleApplies(cfg.links, member, channelId, strict)) {
    const hosts = [...content.matchAll(URL_RE)].map((m) => m[1]);
    URL_RE.lastIndex = 0;
    for (const host of hosts) {
      if (cfg.links.mode === "allowlist") {
        if (!matchesDomain(host, cfg.links.allowedDomains)) {
          return hitFrom(cfg.links, "links", `Linked to ${domainOf(host)}, which is not on the allow list`);
        }
      } else if (matchesDomain(host, cfg.links.blockedDomains)) {
        return hitFrom(cfg.links, "links", `Linked to a blocked domain (${domainOf(host)})`);
      }
    }
  }

  // --- word filter ---------------------------------------------------------
  if (ruleApplies(cfg.words, member, channelId, strict)) {
    const haystack = cfg.words.fuzzy ? deLeet(content) : content.toLowerCase();
    for (const word of cfg.words.blocked) {
      const needle = cfg.words.fuzzy ? deLeet(word) : word.toLowerCase();
      if (!needle) continue;
      const found = cfg.words.wholeWordOnly
        ? new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(haystack)
        : haystack.includes(needle);
      if (found) return hitFrom(cfg.words, "words", "Message contained a filtered word");
    }
    for (const pattern of cfg.words.regexes) {
      try {
        if (new RegExp(pattern, "i").test(content)) {
          return hitFrom(cfg.words, "words", "Message matched a filtered pattern");
        }
      } catch {
        // A broken regex from the dashboard must not break moderation.
      }
    }
  }

  // --- scam scorer ---------------------------------------------------------
  if (ruleApplies(cfg.scam, member, channelId, strict)) {
    const { score, hits } = scoreScam(content, cfg.scam.extraPhrases, cfg.scam.blockLookalikeDomains);
    if (score >= cfg.scam.threshold) {
      return hitFrom(cfg.scam, "scam", `Scam score ${score} (${hits.join(", ")})`);
    }
  }

  // --- rate rules (mutate state, so they run last) -------------------------
  const memberState = stateFor(message.guildId, member.id);
  const now = Date.now();

  if (ruleApplies(cfg.spam, member, channelId, strict)) {
    memberState.timestamps.push(now);
    const window = now - cfg.spam.seconds * 1000;
    memberState.timestamps = memberState.timestamps.filter((t) => t > window);
    if (memberState.timestamps.length > cfg.spam.messages) {
      memberState.timestamps = [];
      return hitFrom(cfg.spam, "spam", `Sent ${cfg.spam.messages}+ messages in ${cfg.spam.seconds}s`);
    }
  }

  if (ruleApplies(cfg.duplicates, member, channelId, strict) && content.trim().length > 3) {
    const window = now - cfg.duplicates.windowSeconds * 1000;
    memberState.recent = memberState.recent.filter((r) => r.at > window);
    const normalised = content.trim().toLowerCase();
    const matches = memberState.recent.filter(
      (r) => r.content === normalised && (cfg.duplicates.crossChannel || r.channelId === channelId),
    );
    memberState.recent.push({ content: normalised, channelId, at: now, messageId: message.id });
    if (matches.length + 1 >= cfg.duplicates.count) {
      memberState.recent = memberState.recent.filter((r) => r.content !== normalised);
      return hitFrom(cfg.duplicates, "duplicates", `Repeated the same message ${matches.length + 1} times`);
    }
  }

  if (ruleApplies(cfg.stickers, member, channelId, strict) && message.stickers.size) {
    const window = now - cfg.stickers.windowSeconds * 1000;
    memberState.stickers = memberState.stickers.filter((t) => t > window);
    memberState.stickers.push(now);
    if (memberState.stickers.length > cfg.stickers.maxPerWindow) {
      memberState.stickers = [];
      return hitFrom(cfg.stickers, "stickers", "Sticker spam");
    }
  }

  return null;
};

// ---------------------------------------------------------------------------
// Enforcement
// ---------------------------------------------------------------------------

/** Adds heat and returns the escalated action, if any tier is crossed. */
const escalate = (guildId: string, userId: string, points: number, cfg: AutomodConfig): { action: AutomodAction; timeoutSeconds: number } | null => {
  if (!cfg.escalation.enabled || points <= 0) return null;
  const memberState = stateFor(guildId, userId);
  const now = Date.now();
  const window = now - cfg.escalation.windowMinutes * 60_000;
  memberState.heat = memberState.heat.filter((h) => h.at > window);
  memberState.heat.push({ points, at: now });

  const total = memberState.heat.reduce((sum, h) => sum + h.points, 0);
  const tier = [...cfg.escalation.tiers].sort((a, b) => b.points - a.points).find((t) => total >= t.points);
  if (!tier) return null;
  return { action: tier.action, timeoutSeconds: tier.timeoutSeconds };
};

const ACTION_RANK: Record<AutomodAction, number> = {
  none: 0,
  delete: 1,
  warn: 2,
  timeout: 3,
  quarantine: 4,
  kick: 5,
  ban: 6,
};

export const enforce = async (client: BambotClient, message: Message<true>, member: GuildMember, hit: RuleHit, cfg: AutomodConfig) => {
  const guild = message.guild;

  // Escalation can only make the response harsher, never softer.
  const escalated = escalate(guild.id, member.id, hit.points, cfg);
  let action = hit.action;
  let timeoutSeconds = hit.timeoutSeconds;
  if (escalated && ACTION_RANK[escalated.action] > ACTION_RANK[action]) {
    action = escalated.action;
    timeoutSeconds = escalated.timeoutSeconds;
  }

  if (action !== "none") {
    await message.delete().catch(() => undefined);
  }

  bumpDailyStat(guild.id, "automodHits");
  await prisma.automodHit
    .create({
      data: {
        guildId: guild.id,
        userId: member.id,
        userTag: member.user.username,
        channelId: message.channelId,
        rule: hit.rule,
        action,
        excerpt: clamp(message.content || "(no text)", 500),
        score: hit.points,
      },
    })
    .catch((err) => log.debug({ err }, "could not record automod hit"));

  const me = guild.members.me;
  const reason = `Automod: ${hit.reason}`;

  try {
    switch (action) {
      case "warn":
        await createCase(client, { guild, type: "WARN", target: member.user, moderator: client.user!, reason, points: hit.points, silent: !hit.notifyUser });
        break;
      case "timeout":
        if (me?.permissions.has(PermissionFlagsBits.ModerateMembers) && member.moderatable) {
          await member.timeout(timeoutSeconds * 1000, reason);
          await createCase(client, { guild, type: "MUTE", target: member.user, moderator: client.user!, reason, durationMs: timeoutSeconds * 1000, silent: !hit.notifyUser });
        }
        break;
      case "kick":
        if (member.kickable) {
          await createCase(client, { guild, type: "KICK", target: member.user, moderator: client.user!, reason, silent: !hit.notifyUser });
          await member.kick(reason);
        }
        break;
      case "ban":
        if (member.bannable) {
          await createCase(client, { guild, type: "BAN", target: member.user, moderator: client.user!, reason, silent: !hit.notifyUser });
          await member.ban({ reason, deleteMessageSeconds: 3600 });
        }
        break;
      case "quarantine":
        if (cfg.quarantineRoleId && guild.roles.cache.has(cfg.quarantineRoleId)) {
          await member.roles.add(cfg.quarantineRoleId, reason);
          await createCase(client, { guild, type: "QUARANTINE", target: member.user, moderator: client.user!, reason, silent: !hit.notifyUser });
        }
        break;
      default:
        break;
    }
  } catch (err) {
    log.warn({ err, rule: hit.rule, action }, "automod action failed");
  }

  if (hit.notifyUser && action !== "none" && action !== "warn") {
    await member
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.warning)
            .setTitle(`${EMOJI.warning} Your message in ${guild.name} was removed`)
            .setDescription(hit.reason),
        ],
      })
      .catch(() => undefined);
  }

  if (cfg.logChannelId) {
    const channel = guild.channels.cache.get(cfg.logChannelId);
    if (channel?.isTextBased()) {
      await channel
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.warning)
              .setAuthor({ name: member.user.username, iconURL: member.user.displayAvatarURL({ size: 64 }) })
              .setTitle(`${EMOJI.shield} Automod — ${hit.rule}`)
              .setDescription(hit.reason)
              .addFields(
                { name: "Member", value: `<@${member.id}>`, inline: true },
                { name: "Channel", value: `<#${message.channelId}>`, inline: true },
                { name: "Action", value: action, inline: true },
                { name: "Message", value: clamp(message.content || "*(no text)*", 1000) },
              )
              .setTimestamp(new Date()),
          ],
        })
        .catch(() => undefined);
    }
  }
};

/** Entry point called from messageCreate. Returns true when the message was actioned. */
export const runAutomod = async (client: BambotClient, message: Message<true>, core: CoreConfig): Promise<boolean> => {
  const cfg = await client.config.get(message.guildId, "automod");
  if (!cfg.enabled) return false;

  const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member) return false;

  const accountAgeHours = (Date.now() - member.user.createdTimestamp) / 3_600_000;
  const strict = cfg.strictForNewAccountsHours > 0 && accountAgeHours < cfg.strictForNewAccountsHours;

  if (!strict) {
    if (isExempt(member, core)) return false;
    if (cfg.trustAfterDays > 0 && member.joinedTimestamp) {
      const daysInServer = (Date.now() - member.joinedTimestamp) / 86_400_000;
      if (daysInServer >= cfg.trustAfterDays) return false;
    }
  }

  const hit = evaluateMessage(message, member, cfg, strict);
  if (!hit) return false;

  await enforce(client, message, member, hit, cfg);
  return true;
};
