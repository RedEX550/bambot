import { ChannelType, EmbedBuilder, type Guild, type GuildMember } from "discord.js";
import { COLORS, EMOJI } from "@bambot/shared";
import type { BambotClient } from "../core/client";
import { childLogger } from "../core/logger";
import { createCase } from "./moderation";

const log = childLogger("antiraid");

interface JoinRecord {
  id: string;
  username: string;
  at: number;
  accountAgeMs: number;
  hasAvatar: boolean;
}

const recentJoins = new Map<string, JoinRecord[]>();

/** Strips digits and separators so "user1234" and "user5678" look alike. */
const nameSkeleton = (username: string): string => username.toLowerCase().replace(/[\d_.\-\s]/g, "");

const similarNames = (joins: JoinRecord[]): number => {
  const counts = new Map<string, number>();
  for (const join of joins) {
    const key = nameSkeleton(join.username);
    if (key.length < 3) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Math.max(0, ...counts.values());
};

export interface RaidAssessment {
  raid: boolean;
  joinsInWindow: number;
  similarNames: number;
  youngAccounts: number;
  reasons: string[];
}

/**
 * Records a join and decides whether the server is under attack.
 *
 * Raw join rate alone produces false positives whenever a server gets featured
 * somewhere, so the signal is combined: a burst *plus* near-identical usernames
 * or a cluster of brand-new accounts is what actually distinguishes a raid from
 * organic growth.
 */
export const assessJoin = async (client: BambotClient, member: GuildMember): Promise<RaidAssessment> => {
  const cfg = await client.config.get(member.guild.id, "antiraid");
  const now = Date.now();

  const list = recentJoins.get(member.guild.id) ?? [];
  list.push({
    id: member.id,
    username: member.user.username,
    at: now,
    accountAgeMs: now - member.user.createdTimestamp,
    hasAvatar: Boolean(member.user.avatar),
  });

  const window = now - cfg.joinWindowSeconds * 1000;
  const recent = list.filter((j) => j.at > window);
  recentJoins.set(member.guild.id, recent.slice(-200));

  const reasons: string[] = [];
  const youngAccounts = recent.filter((j) => j.accountAgeMs < 7 * 86_400_000).length;
  const similar = cfg.similarNameDetection ? similarNames(recent) : 0;

  if (!cfg.enabled) {
    return { raid: false, joinsInWindow: recent.length, similarNames: similar, youngAccounts, reasons };
  }

  const burst = recent.length >= cfg.joinThreshold;
  if (burst) reasons.push(`${recent.length} joins in ${cfg.joinWindowSeconds}s`);
  if (similar >= 3) reasons.push(`${similar} near-identical usernames`);
  if (youngAccounts >= Math.max(3, Math.floor(cfg.joinThreshold * 0.6))) {
    reasons.push(`${youngAccounts} accounts less than a week old`);
  }
  if (cfg.noAvatarSuspicion) {
    const noAvatar = recent.filter((j) => !j.hasAvatar).length;
    if (noAvatar >= Math.max(3, Math.floor(cfg.joinThreshold * 0.6))) reasons.push(`${noAvatar} default avatars`);
  }

  // A burst on its own is only a raid if something else corroborates it.
  const raid = burst && reasons.length >= 2;

  return { raid, joinsInWindow: recent.length, similarNames: similar, youngAccounts, reasons };
};

export const engageRaidMode = async (client: BambotClient, guild: Guild, assessment: RaidAssessment) => {
  const cfg = await client.config.get(guild.id, "antiraid");
  if (client.isRaidMode(guild.id)) return;

  client.setRaidMode(guild.id, cfg.raidModeMinutes);
  log.warn({ guildId: guild.id, reasons: assessment.reasons }, "raid detected");

  const channels = cfg.lockdownAll
    ? [...guild.channels.cache.values()].filter((c) => c.type === ChannelType.GuildText)
    : cfg.lockdownChannels.map((id) => guild.channels.cache.get(id)).filter(Boolean);

  let locked = 0;
  for (const channel of channels) {
    if (!channel || !("permissionOverwrites" in channel)) continue;
    const ok = await channel.permissionOverwrites
      .edit(guild.roles.everyone, { SendMessages: false }, { reason: "Automatic raid lockdown" })
      .then(() => true)
      .catch(() => false);
    if (ok) locked += 1;
  }

  if (cfg.alertChannelId) {
    const channel = guild.channels.cache.get(cfg.alertChannelId);
    if (channel?.isTextBased()) {
      await channel
        .send({
          content: cfg.alertRoleId ? `<@&${cfg.alertRoleId}>` : undefined,
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.danger)
              .setTitle(`${EMOJI.shield} Raid detected — raid mode engaged`)
              .setDescription(assessment.reasons.map((r) => `• ${r}`).join("\n"))
              .addFields(
                { name: "Action for new joins", value: cfg.action, inline: true },
                { name: "Channels locked", value: String(locked), inline: true },
                { name: "Lifts", value: `<t:${Math.floor((Date.now() + cfg.raidModeMinutes * 60_000) / 1000)}:R>`, inline: true },
              )
              .setFooter({ text: "Use /lockdown off once it is over" })
              .setTimestamp(new Date()),
          ],
        })
        .catch(() => undefined);
    }
  }
};

/** Applies the configured action to a member caught during raid mode. */
export const punishRaider = async (client: BambotClient, member: GuildMember) => {
  const cfg = await client.config.get(member.guild.id, "antiraid");
  const reason = "Caught in an active raid window";

  try {
    switch (cfg.action) {
      case "quarantine":
        if (cfg.quarantineRoleId && member.guild.roles.cache.has(cfg.quarantineRoleId)) {
          await member.roles.add(cfg.quarantineRoleId, reason);
          await createCase(client, { guild: member.guild, type: "QUARANTINE", target: member.user, moderator: client.user!, reason, silent: true });
        }
        break;
      case "kick":
        if (member.kickable) {
          await createCase(client, { guild: member.guild, type: "KICK", target: member.user, moderator: client.user!, reason, silent: true });
          await member.kick(reason);
        }
        break;
      case "ban":
        if (member.bannable) {
          await createCase(client, { guild: member.guild, type: "BAN", target: member.user, moderator: client.user!, reason, silent: true });
          await member.ban({ reason });
        }
        break;
      default:
        break;
    }
  } catch (err) {
    log.debug({ err, memberId: member.id }, "raid action failed");
  }
};

/** Enforces the account-age gate outside raid mode. */
export const enforceAccountAge = async (client: BambotClient, member: GuildMember): Promise<boolean> => {
  const cfg = await client.config.get(member.guild.id, "antiraid");
  if (!cfg.enabled || cfg.minAccountAgeHours <= 0) return false;

  const ageHours = (Date.now() - member.user.createdTimestamp) / 3_600_000;
  if (ageHours >= cfg.minAccountAgeHours) return false;

  const reason = `Account is only ${Math.floor(ageHours)}h old (minimum ${cfg.minAccountAgeHours}h)`;

  if (cfg.minAccountAgeAction === "kick" && member.kickable) {
    await member.send(`Your account is too new to join **${member.guild.name}**. Try again later.`).catch(() => undefined);
    await member.kick(reason).catch(() => undefined);
    return true;
  }

  if (cfg.minAccountAgeAction === "quarantine" && cfg.quarantineRoleId) {
    await member.roles.add(cfg.quarantineRoleId, reason).catch(() => undefined);
  }

  if (cfg.minAccountAgeAction !== "none" && cfg.alertChannelId) {
    const channel = member.guild.channels.cache.get(cfg.alertChannelId);
    if (channel?.isTextBased()) {
      await channel
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.warning)
              .setDescription(`${EMOJI.warning} <@${member.id}> joined with a very new account — ${reason}.`),
          ],
        })
        .catch(() => undefined);
    }
  }

  return cfg.minAccountAgeAction === "quarantine";
};
