import { EmbedBuilder, type Guild, type GuildMember, type User } from "discord.js";
import type { CaseType, ModerationConfig } from "@bambot/shared";
import { COLORS } from "@bambot/shared";
import { prisma } from "../core/db";
import { config } from "../core/config";
import { childLogger } from "../core/logger";
import { bumpDailyStat } from "../lib/stats";
import { clamp } from "../lib/embeds";
import { formatDuration, timestamp } from "../lib/time";
import { render } from "../lib/placeholders";
import type { BambotClient } from "../core/client";

const log = childLogger("moderation");

const CASE_COLORS: Record<string, number> = {
  WARN: COLORS.warning,
  MUTE: COLORS.warning,
  UNMUTE: COLORS.success,
  KICK: COLORS.danger,
  BAN: COLORS.danger,
  UNBAN: COLORS.success,
  SOFTBAN: COLORS.danger,
  NOTE: COLORS.neutral,
  PURGE: COLORS.neutral,
  LOCKDOWN: COLORS.warning,
  QUARANTINE: COLORS.danger,
};

const PAST_TENSE: Record<string, string> = {
  WARN: "warned",
  MUTE: "timed out",
  UNMUTE: "timeout removed",
  KICK: "kicked",
  BAN: "banned",
  UNBAN: "unbanned",
  SOFTBAN: "softbanned",
  NOTE: "noted",
  PURGE: "purged",
  LOCKDOWN: "locked down",
  QUARANTINE: "quarantined",
};

export interface CreateCaseInput {
  guild: Guild;
  type: CaseType;
  target: User | { id: string; tag: string };
  moderator: User | { id: string; tag: string };
  reason?: string;
  durationMs?: number;
  evidence?: string[];
  points?: number;
  /** Skip the DM even when the server has DMs switched on. */
  silent?: boolean;
  context?: Record<string, unknown>;
}

export interface CreatedCase {
  caseNumber: number;
  id: string;
}

const tagOf = (value: User | { id: string; tag: string }): string =>
  "username" in value ? value.username : value.tag;

/**
 * Allocates the next case number for a guild.
 * Same gapless-sequence reasoning as ticket numbers: staff quote case numbers
 * to each other, so they must be small and stable.
 */
const nextCaseNumber = async (guildId: string): Promise<number> => {
  const highest = await prisma.case.findFirst({
    where: { guildId },
    orderBy: { caseNumber: "desc" },
    select: { caseNumber: true },
  });
  return (highest?.caseNumber ?? 0) + 1;
};

/**
 * Records a moderation action, notifies the member, posts to the mod log, and
 * returns the case. Every moderation path in the bot goes through here so that
 * the case book is complete — including actions taken by automod.
 */
export const createCase = async (client: BambotClient, input: CreateCaseInput): Promise<CreatedCase> => {
  const { guild, type, target, moderator } = input;
  const cfg = await config.get(guild.id, "moderation");
  const reason = input.reason?.trim() || "No reason provided";
  const expiresAt = input.durationMs ? new Date(Date.now() + input.durationMs) : null;

  let created: { id: string; caseNumber: number } | null = null;
  for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
    const caseNumber = await nextCaseNumber(guild.id);
    try {
      created = await prisma.case.create({
        data: {
          guildId: guild.id,
          caseNumber,
          type,
          targetId: target.id,
          targetTag: tagOf(target),
          moderatorId: moderator.id,
          moderatorTag: tagOf(moderator),
          reason,
          duration: input.durationMs ?? null,
          expiresAt,
          evidence: input.evidence ?? [],
          points: input.points ?? (type === "WARN" ? 1 : 0),
          active: type !== "NOTE",
          context: (input.context ?? {}) as never,
        },
        select: { id: true, caseNumber: true },
      });
    } catch (err) {
      if (attempt === 2) {
        log.error({ err, guildId: guild.id }, "could not allocate a case number");
        throw err;
      }
    }
  }

  if (!created) throw new Error("case creation failed");

  bumpDailyStat(guild.id, "modActions");

  if (cfg.dmOnAction && !input.silent && type !== "NOTE") {
    await notifyTarget(client, guild, target.id, {
      type,
      reason,
      caseNumber: created.caseNumber,
      durationMs: input.durationMs,
      cfg,
    });
  }

  await postCaseLog(client, guild, {
    caseNumber: created.caseNumber,
    type,
    targetId: target.id,
    targetTag: tagOf(target),
    moderatorId: moderator.id,
    moderatorTag: tagOf(moderator),
    reason,
    durationMs: input.durationMs,
    expiresAt,
  });

  return created;
};

const notifyTarget = async (
  client: BambotClient,
  guild: Guild,
  userId: string,
  data: { type: string; reason: string; caseNumber: number; durationMs?: number; cfg: ModerationConfig },
) => {
  const user = await client.users.fetch(userId).catch(() => null);
  if (!user) return;

  const body = render(data.cfg.dmTemplate, {
    guild,
    user,
    moderationCase: {
      number: data.caseNumber,
      reason: data.reason,
      duration: data.durationMs ? formatDuration(data.durationMs) : "permanent",
      type: data.type,
    },
  });

  const embed = new EmbedBuilder()
    .setColor(CASE_COLORS[data.type] ?? COLORS.neutral)
    .setTitle(`You were ${PAST_TENSE[data.type] ?? data.type.toLowerCase()} in ${guild.name}`)
    .setDescription(clamp(body, 4000))
    .setTimestamp(new Date());

  if (data.cfg.appealUrl) {
    embed.addFields({ name: "Appeal", value: `If you think this was a mistake, you can appeal here: ${data.cfg.appealUrl}` });
  }

  // Closed DMs are expected and not an error worth logging loudly.
  await user.send({ embeds: [embed] }).catch(() => undefined);
};

export interface CaseLogData {
  caseNumber: number;
  type: string;
  targetId: string;
  targetTag: string;
  moderatorId: string;
  moderatorTag: string;
  reason: string;
  durationMs?: number;
  expiresAt?: Date | null;
}

export const postCaseLog = async (client: BambotClient, guild: Guild, data: CaseLogData) => {
  const cfg = await config.get(guild.id, "moderation");
  const logging = await config.get(guild.id, "logging");
  const channelId = cfg.logChannelId || (logging.groups.moderation.enabled ? logging.groups.moderation.channelId : "");
  if (!channelId) return;

  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(CASE_COLORS[data.type] ?? COLORS.neutral)
    .setAuthor({ name: `Case #${data.caseNumber} • ${data.type}` })
    .addFields(
      { name: "Member", value: `<@${data.targetId}>\n\`${data.targetTag}\` (${data.targetId})`, inline: true },
      { name: "Moderator", value: `<@${data.moderatorId}>\n\`${data.moderatorTag}\``, inline: true },
    )
    .setTimestamp(new Date())
    .setFooter({ text: `Case #${data.caseNumber}` });

  if (data.durationMs) {
    embed.addFields({
      name: "Duration",
      value: `${formatDuration(data.durationMs)}${data.expiresAt ? `\nEnds ${timestamp(data.expiresAt, "R")}` : ""}`,
      inline: true,
    });
  }
  embed.addFields({ name: "Reason", value: clamp(data.reason, 1024) });

  const message = await channel.send({ embeds: [embed] }).catch(() => null);
  if (message) {
    await prisma.case
      .updateMany({
        where: { guildId: guild.id, caseNumber: data.caseNumber },
        data: { logChannelId: channel.id, logMessageId: message.id },
      })
      .catch(() => undefined);
  }
};

export interface ThresholdOutcome {
  applied: boolean;
  action?: string;
  warnCount: number;
}

/**
 * Applies the configured automatic punishment once a member reaches a warn
 * count. Only the highest matching threshold fires, so going from 4 to 5 warns
 * does not stack a kick on top of a timeout.
 */
export const applyWarnThresholds = async (
  client: BambotClient,
  guild: Guild,
  member: GuildMember,
  moderator: User | { id: string; tag: string },
): Promise<ThresholdOutcome> => {
  const cfg = await config.get(guild.id, "moderation");
  if (!cfg.warnThresholds.length) return { applied: false, warnCount: 0 };

  const since = cfg.warnExpiryDays > 0 ? new Date(Date.now() - cfg.warnExpiryDays * 86_400_000) : undefined;
  const warnCount = await prisma.case.count({
    where: {
      guildId: guild.id,
      targetId: member.id,
      type: "WARN",
      pardoned: false,
      ...(since ? { createdAt: { gte: since } } : {}),
    },
  });

  const matching = cfg.warnThresholds
    .filter((t) => t.count <= warnCount)
    .sort((a, b) => b.count - a.count)[0];

  if (!matching || matching.count !== warnCount || matching.action === "none") {
    return { applied: false, warnCount };
  }

  const reason = `Automatic: reached ${warnCount} active warnings`;

  try {
    switch (matching.action) {
      case "timeout":
        await member.timeout(matching.durationSeconds * 1000, reason);
        await createCase(client, {
          guild,
          type: "MUTE",
          target: member.user,
          moderator,
          reason,
          durationMs: matching.durationSeconds * 1000,
        });
        break;
      case "kick":
        await member.kick(reason);
        await createCase(client, { guild, type: "KICK", target: member.user, moderator, reason });
        break;
      case "ban":
        await member.ban({ reason });
        await createCase(client, { guild, type: "BAN", target: member.user, moderator, reason });
        break;
      default:
        return { applied: false, warnCount };
    }
  } catch (err) {
    log.warn({ err, memberId: member.id }, "warn threshold action failed");
    return { applied: false, warnCount };
  }

  return { applied: true, action: matching.action, warnCount };
};

/** Counts a member's active cases, used by /warnings and the dashboard. */
export const caseSummary = async (guildId: string, userId: string) => {
  const cases = await prisma.case.findMany({
    where: { guildId, targetId: userId },
    orderBy: { caseNumber: "desc" },
    take: 50,
  });
  const counts = cases.reduce<Record<string, number>>((acc, c) => {
    if (!c.pardoned) acc[c.type] = (acc[c.type] ?? 0) + 1;
    return acc;
  }, {});
  return { cases, counts, total: cases.length };
};
