import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ThreadChannel,
  type Message,
} from "discord.js";
import { COLORS, EMOJI } from "@bambot/shared";
import type { BambotClient } from "../core/client";
import { prisma } from "../core/db";
import { childLogger } from "../core/logger";
import { buildMessage } from "../lib/payload";
import { clamp } from "../lib/embeds";
import { normaliseHms, hmsWikiUrl, WIKI_SERIES } from "../data/hms";
import { searchKb } from "./kb";

const log = childLogger("message-features");

// ---------------------------------------------------------------------------
// Auto-responders
// ---------------------------------------------------------------------------

const responderCooldowns = new Map<string, number>();

export const handleAutoResponders = async (client: BambotClient, message: Message<true>) => {
  const content = await client.config.get(message.guildId, "content");
  if (!content.autoRespondersEnabled) return;
  if (content.autoResponderIgnoredChannels.includes(message.channelId)) return;

  const responders = await prisma.autoResponder.findMany({ where: { guildId: message.guildId, enabled: true } });
  if (!responders.length) return;

  const text = message.content.toLowerCase();

  for (const responder of responders) {
    if (responder.channels.length && !responder.channels.includes(message.channelId)) continue;
    if (responder.ignoredRoles.some((r) => message.member?.roles.cache.has(r))) continue;
    if (responder.requiredRoles.length && !responder.requiredRoles.some((r) => message.member?.roles.cache.has(r))) continue;

    const trigger = responder.trigger.toLowerCase();
    let matched = false;
    switch (responder.matchType) {
      case "exact":
        matched = text.trim() === trigger;
        break;
      case "startswith":
        matched = text.startsWith(trigger);
        break;
      case "regex":
        try {
          matched = new RegExp(responder.trigger, "i").test(message.content);
        } catch {
          matched = false;
        }
        break;
      default:
        matched = text.includes(trigger);
    }
    if (!matched) continue;

    const key = `${responder.id}:${message.channelId}`;
    const now = Date.now();
    if ((responderCooldowns.get(key) ?? 0) > now) return;
    responderCooldowns.set(key, now + responder.cooldown * 1000);

    const built = buildMessage(responder.response as never, {
      member: message.member,
      user: message.author,
      guild: message.guild,
    });

    await message.channel
      .send({ content: built.content, embeds: built.embeds, components: built.components })
      .catch(() => undefined);

    if (responder.deleteTrigger) await message.delete().catch(() => undefined);
    await prisma.autoResponder.update({ where: { id: responder.id }, data: { uses: { increment: 1 } } }).catch(() => undefined);
    return;
  }
};

// ---------------------------------------------------------------------------
// Sticky messages
// ---------------------------------------------------------------------------

const stickyCounters = new Map<string, number>();

export const handleSticky = async (client: BambotClient, message: Message<true>) => {
  const content = await client.config.get(message.guildId, "content");
  if (!content.stickyEnabled) return;

  const sticky = await prisma.stickyMessage.findUnique({ where: { channelId: message.channelId } });
  if (!sticky?.enabled) return;

  const count = (stickyCounters.get(message.channelId) ?? 0) + 1;
  if (count < sticky.messageGap) {
    stickyCounters.set(message.channelId, count);
    return;
  }
  stickyCounters.set(message.channelId, 0);

  // Remove the previous copy so only one sticky exists per channel.
  if (sticky.lastMessageId && "messages" in message.channel) {
    const previous = await message.channel.messages.fetch(sticky.lastMessageId).catch(() => null);
    await previous?.delete().catch(() => undefined);
  }

  const built = buildMessage(sticky.payload as never, { guild: message.guild });
  const sent = await message.channel
    .send({ content: built.content, embeds: built.embeds, components: built.components })
    .catch(() => null);

  if (sent) {
    await prisma.stickyMessage.update({ where: { id: sticky.id }, data: { lastMessageId: sent.id } }).catch(() => undefined);
  }
};

// ---------------------------------------------------------------------------
// AFK + highlights
// ---------------------------------------------------------------------------

export const handleAfk = async (client: BambotClient, message: Message<true>) => {
  const content = await client.config.get(message.guildId, "content");
  if (!content.afkEnabled) return;

  const own = await prisma.afk.findUnique({ where: { guildId_userId: { guildId: message.guildId, userId: message.author.id } } });
  if (own) {
    await prisma.afk.delete({ where: { id: own.id } }).catch(() => undefined);
    const reply = await message.reply({ content: `${EMOJI.success} Welcome back, I removed your AFK.` }).catch(() => null);
    if (reply) setTimeout(() => void reply.delete().catch(() => undefined), 10_000).unref();
  }

  const mentioned = [...message.mentions.users.keys()].filter((id) => id !== message.author.id).slice(0, 3);
  if (!mentioned.length) return;

  const afks = await prisma.afk.findMany({ where: { guildId: message.guildId, userId: { in: mentioned } } });
  if (!afks.length) return;

  await message
    .reply({
      embeds: afks.map((afk) =>
        new EmbedBuilder()
          .setColor(COLORS.neutral)
          .setDescription(`<@${afk.userId}> is AFK: ${clamp(afk.message, 200)} — <t:${Math.floor(afk.since.getTime() / 1000)}:R>`),
      ),
      allowedMentions: { parse: [] },
    })
    .catch(() => undefined);
};

export const handleHighlights = async (client: BambotClient, message: Message<true>) => {
  const content = await client.config.get(message.guildId, "content");
  if (!content.highlightsEnabled) return;
  if (message.content.length < 3) return;

  const highlights = await prisma.highlight.findMany({ where: { guildId: message.guildId } });
  if (!highlights.length) return;

  const lower = message.content.toLowerCase();
  const notified = new Set<string>();

  for (const highlight of highlights) {
    if (highlight.userId === message.author.id) continue;
    if (notified.has(highlight.userId)) continue;
    if (!lower.includes(highlight.word.toLowerCase())) continue;

    const member = await message.guild.members.fetch(highlight.userId).catch(() => null);
    // Do not leak a channel the member cannot otherwise read.
    if (!member || !message.channel.permissionsFor(member)?.has("ViewChannel")) continue;

    notified.add(highlight.userId);
    await member
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.info)
            .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL({ size: 64 }) })
            .setTitle(`"${highlight.word}" was mentioned in ${message.guild.name}`)
            .setDescription(clamp(message.content, 500))
            .addFields({ name: "Jump", value: `[Go to message](${message.url})` })
            .setTimestamp(message.createdAt),
        ],
      })
      .catch(() => undefined);
  }
};

// ---------------------------------------------------------------------------
// Bambu Lab helpers
// ---------------------------------------------------------------------------

const HMS_IN_CHAT = /\b(?:HMS[_\s-]*)?([0-9A-F]{4}[-\s_][0-9A-F]{4}[-\s_][0-9A-F]{4}[-\s_][0-9A-F]{4})\b/i;

export const handleHmsDetect = async (client: BambotClient, message: Message<true>) => {
  const cfg = await client.config.get(message.guildId, "bambu");
  if (!cfg.enabled || !cfg.hms.enabled || !cfg.hms.autoDetectInChat) return;
  if (cfg.hms.autoDetectChannels.length && !cfg.hms.autoDetectChannels.includes(message.channelId)) return;

  const match = message.content.match(HMS_IN_CHAT);
  if (!match) return;

  const result = normaliseHms(match[1]);
  if (!result.ok || !result.slug || !result.canonical) return;

  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle(`${EMOJI.wrench} HMS ${result.canonical}`)
    .setURL(hmsWikiUrl(result.slug, "x1", cfg.wikiLocale));

  if (result.family) {
    embed.setDescription(`**${result.family.subsystem}** — ${result.family.summary}`);
    embed.addFields({
      name: "First things to check",
      value: result.family.firstSteps.slice(0, 3).map((s) => `• ${s}`).join("\n").slice(0, 1024),
    });
  } else {
    embed.setDescription("Here is the official page for that code.");
  }
  embed.setFooter({ text: "Run /hms for the full breakdown and a link for your exact printer." });

  await message.reply({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => undefined);
};

const MAKERWORLD_RE = /https?:\/\/(?:www\.)?makerworld\.com\/[^\s]+/i;

interface OpenGraph {
  title?: string;
  description?: string;
  image?: string;
}

/**
 * Reads Open Graph tags from a page.
 *
 * MakerWorld has no public search API — server-side requests to its search
 * endpoint come back empty — but model pages do serve OG tags, so link
 * enrichment is the one integration that actually works reliably.
 */
const fetchOpenGraph = async (url: string): Promise<OpenGraph | null> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; Bambot/1.0; +https://bambulab.com)" },
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!response.ok) return null;

    const html = (await response.text()).slice(0, 200_000);
    const pick = (property: string) => {
      const re = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']+)["']`, "i");
      const alt = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${property}["']`, "i");
      return html.match(re)?.[1] ?? html.match(alt)?.[1];
    };

    const decode = (value?: string) =>
      value
        ?.replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");

    return {
      title: decode(pick("og:title")),
      description: decode(pick("og:description")),
      image: pick("og:image"),
    };
  } catch {
    return null;
  }
};

export const handleMakerWorld = async (client: BambotClient, message: Message<true>) => {
  const cfg = await client.config.get(message.guildId, "bambu");
  if (!cfg.enabled || !cfg.makerworld.enabled) return;

  const match = message.content.match(MAKERWORLD_RE);
  if (!match) return;

  const isShowcase = cfg.makerworld.showcaseChannelIds.includes(message.channelId);

  if (isShowcase && cfg.makerworld.autoReactShowcase) {
    await message.react(cfg.makerworld.showcaseEmoji || "⭐").catch(() => undefined);
  }

  if (!cfg.makerworld.autoEmbedLinks) return;

  const og = await fetchOpenGraph(match[0]);
  if (!og?.title) return;

  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setTitle(clamp(og.title, 256))
    .setURL(match[0])
    .setAuthor({ name: "MakerWorld" });

  if (og.description) embed.setDescription(clamp(og.description, 400));
  if (og.image) embed.setImage(og.image);

  await message.reply({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => undefined);
};

// ---------------------------------------------------------------------------
// Knowledge base auto-answer
// ---------------------------------------------------------------------------

const autoAnswerCooldowns = new Map<string, number>();

export const handleKbAutoAnswer = async (client: BambotClient, message: Message<true>) => {
  const cfg = await client.config.get(message.guildId, "bambu");
  if (!cfg.enabled || !cfg.autoAnswer.enabled) return;

  const inWatchedText = cfg.autoAnswer.channelIds.includes(message.channelId);
  const parentId = message.channel instanceof ThreadChannel ? message.channel.parentId : null;
  const isForumStarter =
    message.channel instanceof ThreadChannel &&
    parentId !== null &&
    cfg.autoAnswer.forumChannelIds.includes(parentId) &&
    message.id === message.channel.id;

  if (!inWatchedText && !isForumStarter) return;
  if (message.content.length < 15) return;

  const key = message.channelId;
  const now = Date.now();
  if ((autoAnswerCooldowns.get(key) ?? 0) > now) return;

  const results = await searchKb(message.guildId, message.content, 1);
  const best = results[0];
  if (!best || best.confidence < cfg.autoAnswer.minConfidence) return;

  autoAnswerCooldowns.set(key, now + cfg.autoAnswer.cooldownSeconds * 1000);

  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle(`${EMOJI.bulb} ${best.article.title}`)
    .setDescription(clamp(best.article.summary || best.article.content, 600))
    .setFooter({ text: `Suggested automatically • ${best.confidence}% match • not always right` });

  if (best.article.linkUrl) embed.setURL(best.article.linkUrl);
  if (best.article.imageUrl) embed.setThumbnail(best.article.imageUrl);

  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (cfg.autoAnswer.offerSolvedButton) {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`kb:solved:${best.article.id}:${message.author.id}`)
          .setLabel("This solved it")
          .setEmoji("✅")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`kb:nothelpful:${best.article.id}:${message.author.id}`)
          .setLabel("Not what I needed")
          .setStyle(ButtonStyle.Secondary),
      ),
    );
  }

  await message
    .reply({ embeds: [embed], components, allowedMentions: { parse: [] } })
    .catch((err) => log.debug({ err }, "auto-answer reply failed"));

  await prisma.kbArticle.update({ where: { id: best.article.id }, data: { views: { increment: 1 } } }).catch(() => undefined);
};
