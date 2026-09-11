import type { GuildMember, Message } from "discord.js";
import type { LevelingConfig } from "@bambot/shared";
import { prisma } from "../core/db";
import { config } from "../core/config";
import { childLogger } from "../core/logger";
import { buildMessage } from "../lib/payload";
import type { BambotClient } from "../core/client";

const log = childLogger("leveling");

/** xp required to reach `level` from zero. */
export const xpForLevel = (level: number, cfg: Pick<LevelingConfig, "curveBase" | "curveExponent">): number =>
  Math.floor(cfg.curveBase * Math.pow(level, cfg.curveExponent));

export const levelFromXp = (xp: number, cfg: Pick<LevelingConfig, "curveBase" | "curveExponent">): number => {
  let level = 0;
  // The curve is monotonic and levels stay small, so a walk is cheaper and
  // more obviously correct than inverting the exponent in floating point.
  while (xpForLevel(level + 1, cfg) <= xp && level < 1000) level += 1;
  return level;
};

export interface LevelProgress {
  level: number;
  xp: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progress: number;
  rank: number | null;
}

export const getProgress = async (guildId: string, userId: string): Promise<LevelProgress | null> => {
  const cfg = await config.get(guildId, "leveling");
  const row = await prisma.level.findUnique({ where: { guildId_userId: { guildId, userId } } });
  if (!row) return null;

  const currentLevelXp = xpForLevel(row.level, cfg);
  const nextLevelXp = xpForLevel(row.level + 1, cfg);
  const span = Math.max(nextLevelXp - currentLevelXp, 1);

  const higher = await prisma.level.count({ where: { guildId, xp: { gt: row.xp }, optedOut: false } });

  return {
    level: row.level,
    xp: row.xp,
    currentLevelXp,
    nextLevelXp,
    progress: Math.min(Math.max((row.xp - currentLevelXp) / span, 0), 1),
    rank: higher + 1,
  };
};

const multiplierFor = (member: GuildMember, channelId: string, cfg: LevelingConfig): number => {
  let factor = 1;
  for (const entry of cfg.multipliers) {
    if (entry.type === "role" && member.roles.cache.has(entry.id)) factor *= entry.factor;
    if (entry.type === "channel" && channelId === entry.id) factor *= entry.factor;
  }
  return factor;
};

/** In-memory cooldown; losing it on restart costs nothing. */
const lastAward = new Map<string, number>();

export interface LevelUpResult {
  levelledUp: boolean;
  level: number;
  previousLevel: number;
}

export const awardMessageXp = async (client: BambotClient, message: Message<true>): Promise<LevelUpResult | null> => {
  const cfg = await client.config.get(message.guildId, "leveling");
  if (!cfg.enabled) return null;

  const member = message.member;
  if (!member) return null;
  if (cfg.noXpChannels.includes(message.channelId)) return null;
  if (cfg.noXpRoles.some((r) => member.roles.cache.has(r))) return null;

  const key = `${message.guildId}:${member.id}`;
  const now = Date.now();
  const previous = lastAward.get(key) ?? 0;
  if (now - previous < cfg.cooldownSeconds * 1000) return null;
  lastAward.set(key, now);

  const [min, max] = cfg.xpPerMessage;
  const base = Math.floor(Math.random() * (Math.max(max, min) - min + 1)) + min;
  const gain = Math.max(0, Math.round(base * multiplierFor(member, message.channelId, cfg)));
  if (!gain) return null;

  try {
    const row = await prisma.level.upsert({
      where: { guildId_userId: { guildId: message.guildId, userId: member.id } },
      create: { guildId: message.guildId, userId: member.id, xp: gain, messages: 1, level: 0 },
      update: { xp: { increment: gain }, messages: { increment: 1 }, lastMessageAt: new Date() },
    });

    if (row.optedOut) return null;

    const newLevel = levelFromXp(row.xp, cfg);
    if (newLevel === row.level) return { levelledUp: false, level: row.level, previousLevel: row.level };

    await prisma.level.update({ where: { id: row.id }, data: { level: newLevel } });
    await grantLevelRoles(client, member, newLevel);

    return { levelledUp: newLevel > row.level, level: newLevel, previousLevel: row.level };
  } catch (err) {
    log.debug({ err, guildId: message.guildId }, "xp award failed");
    return null;
  }
};

/** Applies configured level reward roles, removing superseded ones if asked. */
export const grantLevelRoles = async (client: BambotClient, member: GuildMember, level: number) => {
  const autorole = await client.config.get(member.guild.id, "autorole");
  const rewards = autorole.levelRoles.filter((r) => r.level <= level).sort((a, b) => a.level - b.level);
  if (!rewards.length) return;

  const top = rewards[rewards.length - 1];
  const role = member.guild.roles.cache.get(top.roleId);
  const me = member.guild.members.me;
  if (!role || !me || role.position >= me.roles.highest.position) return;

  if (!member.roles.cache.has(role.id)) {
    await member.roles.add(role.id, `Reached level ${level}`).catch(() => undefined);
  }

  if (top.removePrevious) {
    for (const reward of rewards.slice(0, -1)) {
      if (member.roles.cache.has(reward.roleId)) {
        await member.roles.remove(reward.roleId, "Superseded by a higher level reward").catch(() => undefined);
      }
    }
  }
};

export const announceLevelUp = async (client: BambotClient, message: Message<true>, level: number) => {
  const cfg = await client.config.get(message.guildId, "leveling");
  if (cfg.announce === "off") return;
  if (cfg.announceEvery > 1 && level % cfg.announceEvery !== 0) return;

  const progress = await getProgress(message.guildId, message.author.id);
  const built = buildMessage(cfg.announceMessage, {
    member: message.member,
    user: message.author,
    guild: message.guild,
    level: { level, xp: progress?.xp ?? 0, rank: progress?.rank ?? undefined },
  });

  const payload = { content: built.content, embeds: built.embeds };

  try {
    if (cfg.announce === "dm") {
      await message.author.send(payload).catch(() => undefined);
      return;
    }
    if (cfg.announce === "channel" && cfg.announceChannelId) {
      const channel = message.guild.channels.cache.get(cfg.announceChannelId);
      if (channel?.isTextBased()) await channel.send(payload);
      return;
    }
    const sent = await message.reply(payload);
    if (built.deleteAfter > 0) {
      setTimeout(() => void sent.delete().catch(() => undefined), built.deleteAfter * 1000).unref();
    }
  } catch (err) {
    log.debug({ err }, "level up announcement failed");
  }
};

/** Voice XP is granted by a task; only members with company earn it. */
export const awardVoiceXp = async (client: BambotClient) => {
  for (const guild of client.guilds.cache.values()) {
    const cfg = await client.config.get(guild.id, "leveling");
    if (!cfg.enabled || cfg.voiceXpPerMinute <= 0) continue;

    for (const channel of guild.channels.cache.values()) {
      if (!channel.isVoiceBased()) continue;
      const humans = channel.members.filter((m) => !m.user.bot && !m.voice.selfDeaf && !m.voice.deaf);
      if (humans.size < 2) continue;

      for (const member of humans.values()) {
        if (cfg.noXpRoles.some((r) => member.roles.cache.has(r))) continue;
        await prisma.level
          .upsert({
            where: { guildId_userId: { guildId: guild.id, userId: member.id } },
            create: { guildId: guild.id, userId: member.id, xp: cfg.voiceXpPerMinute, voiceSeconds: 60 },
            update: { xp: { increment: cfg.voiceXpPerMinute }, voiceSeconds: { increment: 60 } },
          })
          .catch(() => undefined);
      }
    }
  }
};
