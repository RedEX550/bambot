import { AuditLogEvent, type GuildMember, type PartialGuildMember } from "discord.js";
import type { BotEvent } from "../core/types";
import type { BambotClient } from "../core/client";
import { prisma } from "../core/db";
import { childLogger } from "../core/logger";
import { bumpDailyStat } from "../lib/stats";
import { buildMessage } from "../lib/payload";
import { render } from "../lib/placeholders";
import { renderWelcomeImage } from "../lib/welcome-image";
import { assessJoin, enforceAccountAge, engageRaidMode, punishRaider } from "../services/antiraid";

const log = childLogger("member");

/** Members welcomed recently, so a leave-and-rejoin does not spam the channel. */
const recentlyWelcomed = new Map<string, number>();

const applyAutoroles = async (client: BambotClient, member: GuildMember) => {
  const cfg = await client.config.get(member.guild.id, "autorole");
  if (!cfg.enabled) return;

  const roles = member.user.bot ? cfg.botRoles : cfg.roles;
  if (!roles.length) return;

  const grant = async () => {
    const me = member.guild.members.me;
    const assignable = roles.filter((id) => {
      const role = member.guild.roles.cache.get(id);
      return role && !role.managed && me && role.position < me.roles.highest.position;
    });
    if (assignable.length) {
      await member.roles.add(assignable, "Auto role on join").catch((err) => log.debug({ err }, "autorole failed"));
    }
  };

  if (cfg.delaySeconds > 0) setTimeout(() => void grant(), cfg.delaySeconds * 1000).unref();
  else await grant();
};

const sendWelcome = async (client: BambotClient, member: GuildMember) => {
  const cfg = await client.config.get(member.guild.id, "welcome");
  if (!cfg.enabled) return;

  if (cfg.minAccountAgeHours > 0) {
    const ageHours = (Date.now() - member.user.createdTimestamp) / 3_600_000;
    if (ageHours < cfg.minAccountAgeHours) return;
  }

  if (cfg.rejoinCooldownMinutes > 0) {
    const key = `${member.guild.id}:${member.id}`;
    const last = recentlyWelcomed.get(key) ?? 0;
    if (Date.now() - last < cfg.rejoinCooldownMinutes * 60_000) return;
    recentlyWelcomed.set(key, Date.now());
  }

  const ctx = { member, user: member.user, guild: member.guild };

  if (cfg.dm.enabled) {
    const dm = buildMessage(cfg.dm.message, ctx);
    await member.send({ content: dm.content, embeds: dm.embeds, components: dm.components }).catch(() => undefined);
  }

  if (!cfg.channelId) return;
  const channel = member.guild.channels.cache.get(cfg.channelId);
  if (!channel?.isTextBased()) return;

  const files = [];
  if (cfg.image.enabled) {
    const attachment = await renderWelcomeImage({
      title: render(cfg.image.title, ctx),
      subtitle: render(cfg.image.subtitle, ctx),
      avatarUrl: member.user.displayAvatarURL({ extension: "png", size: 256 }),
      config: cfg.image,
    });
    if (attachment) files.push(attachment);
  }

  const built = buildMessage(cfg.message, ctx, { files });

  const sent = await channel
    .send({ content: built.content, embeds: built.embeds, components: built.components, files: built.files })
    .catch((err) => {
      log.warn({ err, guildId: member.guild.id }, "welcome message failed");
      return null;
    });

  if (sent && built.deleteAfter > 0) {
    setTimeout(() => void sent.delete().catch(() => undefined), built.deleteAfter * 1000).unref();
  }
};

export const guildMemberAdd: BotEvent<"guildMemberAdd"> = {
  name: "guildMemberAdd",
  async execute(client, member) {
    bumpDailyStat(member.guild.id, "joins");

    try {
      const assessment = await assessJoin(client, member);
      if (assessment.raid) await engageRaidMode(client, member.guild, assessment);

      if (client.isRaidMode(member.guild.id)) {
        await punishRaider(client, member);
        // A member caught in a raid gets no welcome and no roles.
        return;
      }

      const quarantined = await enforceAccountAge(client, member);
      if (quarantined) return;
    } catch (err) {
      log.error({ err }, "raid assessment failed");
    }

    // The verification gate role, when the server uses one.
    try {
      const verification = await client.config.get(member.guild.id, "verification");
      if (verification.enabled && verification.unverifiedRoleId) {
        const role = member.guild.roles.cache.get(verification.unverifiedRoleId);
        const me = member.guild.members.me;
        if (role && me && role.position < me.roles.highest.position) {
          await member.roles.add(role, "Unverified gate role").catch(() => undefined);
        }
      }
    } catch (err) {
      log.debug({ err }, "verification gate failed");
    }

    try {
      await restoreRoles(client, member);
    } catch (err) {
      log.debug({ err }, "role restore failed");
    }

    try {
      await applyAutoroles(client, member);
    } catch (err) {
      log.debug({ err }, "autorole failed");
    }

    try {
      await sendWelcome(client, member);
    } catch (err) {
      log.error({ err }, "welcome failed");
    }
  },
};

/** Puts back the roles a member had when they last left. */
const restoreRoles = async (client: BambotClient, member: GuildMember) => {
  const cfg = await client.config.get(member.guild.id, "autorole");
  if (!cfg.restoreOnRejoin) return;

  const snapshot = await prisma.memberSnapshot.findUnique({
    where: { guildId_userId: { guildId: member.guild.id, userId: member.id } },
  });
  if (!snapshot?.roles.length) return;

  const me = member.guild.members.me;
  const assignable = snapshot.roles.filter((id) => {
    if (cfg.restoreBlacklist.includes(id)) return false;
    const role = member.guild.roles.cache.get(id);
    return role && !role.managed && me && role.position < me.roles.highest.position;
  });

  if (assignable.length) {
    await member.roles.add(assignable, "Restored on rejoin").catch(() => undefined);
  }
  await prisma.memberSnapshot.delete({ where: { id: snapshot.id } }).catch(() => undefined);
};

export const guildMemberRemove: BotEvent<"guildMemberRemove"> = {
  name: "guildMemberRemove",
  async execute(client, member: GuildMember | PartialGuildMember) {
    bumpDailyStat(member.guild.id, "leaves");

    // Snapshot roles so restoreOnRejoin has something to work with.
    try {
      const cfg = await client.config.get(member.guild.id, "autorole");
      if (cfg.restoreOnRejoin && member.roles) {
        const roleIds = [...member.roles.cache.keys()].filter((id) => id !== member.guild.id);
        if (roleIds.length) {
          await prisma.memberSnapshot.upsert({
            where: { guildId_userId: { guildId: member.guild.id, userId: member.id } },
            create: {
              guildId: member.guild.id,
              userId: member.id,
              roles: roleIds,
              nickname: member.nickname ?? null,
            },
            update: { roles: roleIds, nickname: member.nickname ?? null, createdAt: new Date() },
          });
        }
      }
    } catch (err) {
      log.debug({ err }, "role snapshot failed");
    }

    try {
      const cfg = await client.config.get(member.guild.id, "goodbye");
      if (!cfg.enabled || !cfg.channelId) return;

      if (cfg.skipOnModeration) {
        // Check the audit log so a ban or kick does not produce a farewell.
        const me = member.guild.members.me;
        if (me?.permissions.has("ViewAuditLog")) {
          const logs = await member.guild
            .fetchAuditLogs({ limit: 5, type: AuditLogEvent.MemberKick })
            .catch(() => null);
          const bans = await member.guild
            .fetchAuditLogs({ limit: 5, type: AuditLogEvent.MemberBanAdd })
            .catch(() => null);
          const recent = [...(logs?.entries.values() ?? []), ...(bans?.entries.values() ?? [])];
          const moderated = recent.some(
            (entry) => entry.targetId === member.id && Date.now() - entry.createdTimestamp < 10_000,
          );
          if (moderated) return;
        }
      }

      const channel = member.guild.channels.cache.get(cfg.channelId);
      if (!channel?.isTextBased()) return;

      const built = buildMessage(cfg.message, {
        member: member.partial ? null : (member as GuildMember),
        user: member.user,
        guild: member.guild,
      });
      await channel.send({ content: built.content, embeds: built.embeds }).catch(() => undefined);
    } catch (err) {
      log.error({ err }, "goodbye failed");
    }

    try {
      const leveling = await client.config.get(member.guild.id, "leveling");
      if (leveling.resetOnLeave) {
        await prisma.level
          .deleteMany({ where: { guildId: member.guild.id, userId: member.id } })
          .catch(() => undefined);
      }
    } catch {
      // Nothing to do.
    }
  },
};

export default [guildMemberAdd, guildMemberRemove];
