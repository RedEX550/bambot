import {
  AuditLogEvent,
  ChannelType,
  EmbedBuilder,
  type Guild,
  type GuildChannel,
  type GuildMember,
  type Message,
  type PartialMessage,
  type Role,
  type User,
  type VoiceState,
} from "discord.js";
import type { LogGroup } from "@bambot/shared";
import { COLORS } from "@bambot/shared";
import type { BotEvent } from "../core/types";
import type { BambotClient } from "../core/client";
import { childLogger } from "../core/logger";
import { clamp } from "../lib/embeds";

const log = childLogger("logging");

/**
 * Central log dispatcher.
 *
 * Every handler funnels through `send`, which resolves the group's channel,
 * honours the per-event mute list and the ignore rules, and then posts. Keeping
 * that in one place means a new log event is a few lines rather than a
 * copy-pasted block of permission checks.
 */
const send = async (
  client: BambotClient,
  guild: Guild,
  group: LogGroup,
  event: string,
  embed: EmbedBuilder,
  context?: { channelId?: string; userId?: string; isBot?: boolean },
) => {
  try {
    const cfg = await client.config.get(guild.id, "logging");
    if (!cfg.enabled) return;

    const groupConfig = cfg.groups[group];
    if (!groupConfig?.enabled || !groupConfig.channelId) return;
    if (groupConfig.muted.includes(event)) return;

    if (context?.isBot && cfg.ignoreBots) return;
    if (context?.channelId && cfg.ignoredChannels.includes(context.channelId)) return;

    if (context?.userId && cfg.ignoredRoles.length) {
      const member = guild.members.cache.get(context.userId);
      if (member && cfg.ignoredRoles.some((role) => member.roles.cache.has(role))) return;
    }

    const channel = guild.channels.cache.get(groupConfig.channelId);
    if (!channel?.isTextBased()) return;
    // Never log the log channel back into itself.
    if (context?.channelId === channel.id) return;

    await channel.send({ embeds: [embed] });
  } catch (err) {
    log.debug({ err, group, event }, "log dispatch failed");
  }
};

const authorFor = (user: { username?: string; displayAvatarURL: (o?: { size: 64 }) => string } | null | undefined) =>
  user?.username ? { name: user.username, iconURL: user.displayAvatarURL({ size: 64 }) } : null;

/** Looks up who performed an action. Requires View Audit Log. */
const findExecutor = async (guild: Guild, type: AuditLogEvent, targetId: string): Promise<{ id: string } | null> => {
  if (!guild.members.me?.permissions.has("ViewAuditLog")) return null;
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 });
    const entry = logs.entries.find(
      (e) => e.targetId === targetId && Date.now() - e.createdTimestamp < 10_000,
    );
    return entry?.executor ?? null;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const messageDelete: BotEvent<"messageDelete"> = {
  name: "messageDelete",
  async execute(client, message: Message | PartialMessage) {
    if (!message.guild || message.partial) return;
    if (message.author?.bot && message.author.id === client.user?.id) return;

    const cfg = await client.config.get(message.guild.id, "logging");

    const embed = new EmbedBuilder()
      .setColor(COLORS.danger)
      .setAuthor(authorFor(message.author))
      .setTitle("Message deleted")
      .addFields({ name: "Channel", value: `<#${message.channelId}>`, inline: true })
      .setTimestamp(new Date());

    if (message.author) {
      embed.addFields({ name: "Author", value: `<@${message.author.id}>`, inline: true });
    }

    if (cfg.includeContent && message.content) {
      embed.setDescription(clamp(message.content, 3000));
    } else if (!cfg.includeContent) {
      embed.setDescription("_Content logging is switched off for this server._");
    }

    if (message.attachments.size) {
      embed.addFields({
        name: `Attachments (${message.attachments.size})`,
        value: clamp([...message.attachments.values()].map((a) => a.name).join(", "), 1024),
      });
      const image = message.attachments.find((a) => a.contentType?.startsWith("image/"));
      if (image && cfg.mirrorAttachments) embed.setImage(image.url);
    }

    await send(client, message.guild, "message", "messageDelete", embed, {
      channelId: message.channelId,
      userId: message.author?.id,
      isBot: message.author?.bot,
    });
  },
};

export const messageUpdate: BotEvent<"messageUpdate"> = {
  name: "messageUpdate",
  async execute(client, oldMessage, newMessage) {
    if (!newMessage.guild || oldMessage.partial) return;
    if (oldMessage.content === newMessage.content) return;
    if (newMessage.author?.bot) return;

    const cfg = await client.config.get(newMessage.guild.id, "logging");

    const embed = new EmbedBuilder()
      .setColor(COLORS.warning)
      .setAuthor(authorFor(newMessage.author))
      .setTitle("Message edited")
      .addFields({ name: "Channel", value: `<#${newMessage.channelId}>`, inline: true })
      .setTimestamp(new Date());

    if (cfg.includeContent) {
      embed.addFields(
        { name: "Before", value: clamp(oldMessage.content || "_empty_", 1024) },
        { name: "After", value: clamp(newMessage.content || "_empty_", 1024) },
      );
    }
    embed.addFields({ name: "Jump", value: `[Go to message](${newMessage.url})` });

    await send(client, newMessage.guild, "message", "messageUpdate", embed, {
      channelId: newMessage.channelId,
      userId: newMessage.author?.id,
      isBot: newMessage.author?.bot,
    });
  },
};

export const messageBulkDelete: BotEvent<"messageDeleteBulk"> = {
  name: "messageDeleteBulk",
  async execute(client, messages) {
    const first = messages.first();
    if (!first?.guild) return;

    const embed = new EmbedBuilder()
      .setColor(COLORS.danger)
      .setTitle("Messages purged")
      .setDescription(`**${messages.size}** messages were deleted in <#${first.channelId}>.`)
      .setTimestamp(new Date());

    await send(client, first.guild, "message", "messageBulkDelete", embed, { channelId: first.channelId });
  },
};

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export const memberJoinLog: BotEvent<"guildMemberAdd"> = {
  name: "guildMemberAdd",
  async execute(client, member) {
    const ageDays = Math.floor((Date.now() - member.user.createdTimestamp) / 86_400_000);

    const embed = new EmbedBuilder()
      .setColor(COLORS.success)
      .setAuthor(authorFor(member.user))
      .setTitle("Member joined")
      .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
      .addFields(
        { name: "Member", value: `<@${member.id}>`, inline: true },
        { name: "ID", value: member.id, inline: true },
        {
          name: "Account age",
          value: `${ageDays} day(s)${ageDays < 7 ? " ⚠️" : ""}`,
          inline: true,
        },
      )
      .setTimestamp(new Date());

    await send(client, member.guild, "member", "memberJoin", embed, { userId: member.id, isBot: member.user.bot });
  },
};

export const memberLeaveLog: BotEvent<"guildMemberRemove"> = {
  name: "guildMemberRemove",
  async execute(client, member) {
    const roles = member.roles?.cache
      ? [...member.roles.cache.values()].filter((r) => r.id !== member.guild.id).map((r) => `<@&${r.id}>`)
      : [];

    const embed = new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setAuthor(authorFor(member.user))
      .setTitle("Member left")
      .addFields(
        { name: "Member", value: `<@${member.id}>`, inline: true },
        { name: "ID", value: member.id, inline: true },
        {
          name: "Was here for",
          value: member.joinedTimestamp
            ? `${Math.floor((Date.now() - member.joinedTimestamp) / 86_400_000)} day(s)`
            : "unknown",
          inline: true,
        },
      )
      .setTimestamp(new Date());

    if (roles.length) embed.addFields({ name: "Roles", value: clamp(roles.join(" "), 1024) });

    await send(client, member.guild, "member", "memberLeave", embed, { userId: member.id, isBot: member.user.bot });
  },
};

export const memberUpdateLog: BotEvent<"guildMemberUpdate"> = {
  name: "guildMemberUpdate",
  async execute(client, oldMember: GuildMember, newMember: GuildMember) {
    if (oldMember.nickname !== newMember.nickname) {
      const embed = new EmbedBuilder()
        .setColor(COLORS.info)
        .setAuthor(authorFor(newMember.user))
        .setTitle("Nickname changed")
        .addFields(
          { name: "Member", value: `<@${newMember.id}>`, inline: true },
          { name: "Before", value: oldMember.nickname ?? "_none_", inline: true },
          { name: "After", value: newMember.nickname ?? "_none_", inline: true },
        )
        .setTimestamp(new Date());

      await send(client, newMember.guild, "member", "nicknameUpdate", embed, { userId: newMember.id });
    }

    const added = newMember.roles.cache.filter((role) => !oldMember.roles.cache.has(role.id));
    const removed = oldMember.roles.cache.filter((role) => !newMember.roles.cache.has(role.id));

    if (added.size || removed.size) {
      const embed = new EmbedBuilder()
        .setColor(COLORS.info)
        .setAuthor(authorFor(newMember.user))
        .setTitle("Roles changed")
        .addFields({ name: "Member", value: `<@${newMember.id}>` })
        .setTimestamp(new Date());

      if (added.size) {
        embed.addFields({ name: "Added", value: clamp(added.map((r) => `<@&${r.id}>`).join(" "), 1024) });
      }
      if (removed.size) {
        embed.addFields({ name: "Removed", value: clamp(removed.map((r) => `<@&${r.id}>`).join(" "), 1024) });
      }

      await send(client, newMember.guild, "member", "roleUpdate", embed, { userId: newMember.id });
    }
  },
};

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

export const banAdd: BotEvent<"guildBanAdd"> = {
  name: "guildBanAdd",
  async execute(client, ban) {
    const executor = await findExecutor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);

    const embed = new EmbedBuilder()
      .setColor(COLORS.danger)
      .setAuthor(authorFor(ban.user))
      .setTitle("Member banned")
      .addFields(
        { name: "Member", value: `<@${ban.user.id}> (${ban.user.username})`, inline: true },
        { name: "Banned by", value: executor ? `<@${executor.id}>` : "unknown", inline: true },
        { name: "Reason", value: clamp(ban.reason ?? "No reason recorded", 1024) },
      )
      .setTimestamp(new Date());

    await send(client, ban.guild, "moderation", "memberBan", embed, { userId: ban.user.id });
  },
};

export const banRemove: BotEvent<"guildBanRemove"> = {
  name: "guildBanRemove",
  async execute(client, ban) {
    const executor = await findExecutor(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);

    const embed = new EmbedBuilder()
      .setColor(COLORS.success)
      .setAuthor(authorFor(ban.user))
      .setTitle("Member unbanned")
      .addFields(
        { name: "Member", value: `<@${ban.user.id}> (${ban.user.username})`, inline: true },
        { name: "Unbanned by", value: executor ? `<@${executor.id}>` : "unknown", inline: true },
      )
      .setTimestamp(new Date());

    await send(client, ban.guild, "moderation", "memberUnban", embed, { userId: ban.user.id });
  },
};

// ---------------------------------------------------------------------------
// Server structure
// ---------------------------------------------------------------------------

const channelLabel = (channel: GuildChannel) =>
  `${channel.name} (${ChannelType[channel.type] ?? "channel"})`;

export const channelCreate: BotEvent<"channelCreate"> = {
  name: "channelCreate",
  async execute(client, channel) {
    if (!("guild" in channel)) return;
    const embed = new EmbedBuilder()
      .setColor(COLORS.success)
      .setTitle("Channel created")
      .setDescription(`<#${channel.id}> — ${channelLabel(channel as GuildChannel)}`)
      .setTimestamp(new Date());

    await send(client, channel.guild, "server", "channelCreate", embed);
  },
};

export const channelDelete: BotEvent<"channelDelete"> = {
  name: "channelDelete",
  async execute(client, channel) {
    if (!("guild" in channel)) return;
    const embed = new EmbedBuilder()
      .setColor(COLORS.danger)
      .setTitle("Channel deleted")
      .setDescription(`#${(channel as GuildChannel).name} — ${channelLabel(channel as GuildChannel)}`)
      .setTimestamp(new Date());

    await send(client, channel.guild, "server", "channelDelete", embed);
  },
};

export const roleCreate: BotEvent<"roleCreate"> = {
  name: "roleCreate",
  async execute(client, role: Role) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.success)
      .setTitle("Role created")
      .setDescription(`<@&${role.id}> (${role.name})`)
      .setTimestamp(new Date());

    await send(client, role.guild, "server", "roleCreate", embed);
  },
};

export const roleDelete: BotEvent<"roleDelete"> = {
  name: "roleDelete",
  async execute(client, role: Role) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.danger)
      .setTitle("Role deleted")
      .setDescription(`**${role.name}** — ${role.members.size} member(s) held it`)
      .setTimestamp(new Date());

    await send(client, role.guild, "server", "roleDelete", embed);
  },
};

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

export const voiceLog: BotEvent<"voiceStateUpdate"> = {
  name: "voiceStateUpdate",
  async execute(client, oldState: VoiceState, newState: VoiceState) {
    const member = newState.member ?? oldState.member;
    if (!member || member.user.bot) return;

    const guild = newState.guild;
    const base = () =>
      new EmbedBuilder().setAuthor(authorFor(member.user)).setTimestamp(new Date());

    if (!oldState.channelId && newState.channelId) {
      await send(
        client,
        guild,
        "voice",
        "voiceJoin",
        base().setColor(COLORS.success).setTitle("Joined voice").setDescription(`<@${member.id}> → <#${newState.channelId}>`),
        { channelId: newState.channelId, userId: member.id },
      );
      return;
    }

    if (oldState.channelId && !newState.channelId) {
      await send(
        client,
        guild,
        "voice",
        "voiceLeave",
        base().setColor(COLORS.neutral).setTitle("Left voice").setDescription(`<@${member.id}> ← <#${oldState.channelId}>`),
        { channelId: oldState.channelId, userId: member.id },
      );
      return;
    }

    if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
      await send(
        client,
        guild,
        "voice",
        "voiceMove",
        base()
          .setColor(COLORS.info)
          .setTitle("Moved voice channel")
          .setDescription(`<@${member.id}>: <#${oldState.channelId}> → <#${newState.channelId}>`),
        { channelId: newState.channelId, userId: member.id },
      );
    }
  },
};

export default [
  messageDelete,
  messageUpdate,
  messageBulkDelete,
  memberJoinLog,
  memberLeaveLog,
  memberUpdateLog,
  banAdd,
  banRemove,
  channelCreate,
  channelDelete,
  roleCreate,
  roleDelete,
  voiceLog,
];
