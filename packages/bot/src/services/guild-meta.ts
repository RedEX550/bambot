import { ChannelType, PermissionFlagsBits, type Guild, type GuildBasedChannel } from "discord.js";
import type { GuildChannel, GuildMeta, GuildRole } from "@bambot/shared";
import { config } from "../core/config";

const channelType = (channel: GuildBasedChannel): GuildChannel["type"] => {
  switch (channel.type) {
    case ChannelType.GuildText:
      return "text";
    case ChannelType.GuildVoice:
      return "voice";
    case ChannelType.GuildCategory:
      return "category";
    case ChannelType.GuildForum:
      return "forum";
    case ChannelType.GuildAnnouncement:
      return "announcement";
    case ChannelType.GuildStageVoice:
      return "stage";
    default:
      return "other";
  }
};

/**
 * Everything the dashboard needs to render channel and role pickers, plus a
 * pre-flight check of the permissions the enabled modules actually require.
 * Surfacing "I cannot send messages in #welcome" in the UI beats a silent
 * failure at 3am.
 */
export const buildGuildMeta = async (guild: Guild): Promise<GuildMeta> => {
  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));

  const channels: GuildChannel[] = [...guild.channels.cache.values()]
    .map((channel) => {
      const perms = me ? channel.permissionsFor(me) : null;
      const writable =
        channel.type === ChannelType.GuildCategory
          ? true
          : Boolean(perms?.has(PermissionFlagsBits.ViewChannel) && perms?.has(PermissionFlagsBits.SendMessages));
      return {
        id: channel.id,
        name: channel.name,
        type: channelType(channel),
        parentId: channel.parentId,
        position: "rawPosition" in channel ? channel.rawPosition : 0,
        writable,
      };
    })
    .sort((a, b) => a.position - b.position);

  const botPosition = me?.roles.highest.position ?? 0;

  const roles: GuildRole[] = [...guild.roles.cache.values()]
    .filter((role) => role.id !== guild.id)
    .map((role) => ({
      id: role.id,
      name: role.name,
      color: role.hexColor,
      position: role.position,
      managed: role.managed,
      assignable: !role.managed && role.position < botPosition,
      memberCount: role.members.size,
    }))
    .sort((a, b) => b.position - a.position);

  const emojis = [...guild.emojis.cache.values()].map((e) => ({
    id: e.id,
    name: e.name ?? "emoji",
    url: e.imageURL({ size: 64 }),
    animated: Boolean(e.animated),
  }));

  const warnings: GuildMeta["warnings"] = [];
  const channelById = new Map(channels.map((c) => [c.id, c]));

  const needsWritable = (module: string, channelId: string, label: string) => {
    if (!channelId) return;
    const channel = channelById.get(channelId);
    if (!channel) {
      warnings.push({ module, message: `The ${label} channel no longer exists.` });
      return;
    }
    if (!channel.writable) {
      warnings.push({ module, message: `I cannot post in the ${label} channel (#${channel.name}).` });
    }
  };

  const [welcome, tickets, logging, starboard, suggestions, verification, automod] = await Promise.all([
    config.get(guild.id, "welcome"),
    config.get(guild.id, "tickets"),
    config.get(guild.id, "logging"),
    config.get(guild.id, "starboard"),
    config.get(guild.id, "suggestions"),
    config.get(guild.id, "verification"),
    config.get(guild.id, "automod"),
  ]);

  if (welcome.enabled) {
    if (!welcome.channelId) warnings.push({ module: "welcome", message: "Welcome messages are on but no channel is set." });
    needsWritable("welcome", welcome.channelId, "welcome");
    if (welcome.image.enabled && !me?.permissions.has(PermissionFlagsBits.AttachFiles)) {
      warnings.push({ module: "welcome", message: "The welcome banner needs the Attach Files permission." });
    }
  }

  if (tickets.enabled) {
    if (!tickets.categories.some((c) => c.enabled)) {
      warnings.push({ module: "tickets", message: "Tickets are on but every category is disabled." });
    }
    if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      warnings.push({ module: "tickets", message: "Tickets need the Manage Channels permission to open channels." });
    }
    for (const panel of tickets.panels) needsWritable("tickets", panel.channelId, `${panel.name} panel`);
    needsWritable("tickets", tickets.transcriptChannelId, "transcript");
  }

  if (logging.enabled) {
    for (const [name, group] of Object.entries(logging.groups)) {
      if (group.enabled) needsWritable("logging", group.channelId, `${name} log`);
    }
    if (!me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
      warnings.push({ module: "logging", message: "Without View Audit Log I cannot name who performed bans and kicks." });
    }
  }

  if (starboard.enabled) needsWritable("starboard", starboard.channelId, "starboard");
  if (suggestions.enabled) needsWritable("suggestions", suggestions.channelId, "suggestions");
  if (verification.enabled) {
    needsWritable("verification", verification.channelId, "verification");
    if (verification.verifiedRoleId) {
      const role = roles.find((r) => r.id === verification.verifiedRoleId);
      if (role && !role.assignable) {
        warnings.push({ module: "verification", message: `I cannot assign @${role.name} — move my role above it.` });
      }
    }
  }

  if (automod.enabled && !me?.permissions.has(PermissionFlagsBits.ManageMessages)) {
    warnings.push({ module: "automod", message: "Automod needs Manage Messages to delete anything." });
  }

  return {
    id: guild.id,
    name: guild.name,
    iconUrl: guild.iconURL({ size: 128 }),
    memberCount: guild.memberCount,
    channels,
    roles,
    emojis,
    botRolePosition: botPosition,
    warnings,
  };
};
