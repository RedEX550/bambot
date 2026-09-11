import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { COLORS, EMOJI } from "@bambot/shared";
import type { BotCommand } from "../../core/types";
import type { BambotClient } from "../../core/client";
import { errorEmbed, successEmbed } from "../../lib/embeds";
import { canActOn } from "../../lib/permissions";
import { MAX_TIMEOUT_MS, formatDuration, parseDuration } from "../../lib/time";
import { applyWarnThresholds, createCase } from "../../services/moderation";
import { prisma } from "../../core/db";

/** Shared result embed so every moderation command reads the same way. */
const actionEmbed = (verb: string, targetTag: string, caseNumber: number, reason: string, extra?: string) =>
  new EmbedBuilder()
    .setColor(COLORS.success)
    .setDescription(
      `${EMOJI.success} **${targetTag}** was ${verb}.${extra ? `\n${extra}` : ""}\n**Reason:** ${reason}\n\`Case #${caseNumber}\``,
    );

const guardReason = async (interaction: ChatInputCommandInteraction, client: BambotClient, reason: string | null) => {
  const cfg = await client.config.get(interaction.guildId!, "moderation");
  if (cfg.requireReason && !reason) {
    await interaction.editReply({ embeds: [errorEmbed("This server requires a reason for every moderation action.")] });
    return null;
  }
  return reason?.trim() || "No reason provided";
};

export const banCommand: BotCommand = {
  permission: "mod",
  data: new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member, optionally for a set time")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((o) => o.setName("user").setDescription("Who to ban").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Why").setMaxLength(500))
    .addStringOption((o) => o.setName("duration").setDescription("e.g. 7d — leave empty for permanent"))
    .addIntegerOption((o) =>
      o.setName("delete_hours").setDescription("Delete their messages from the last N hours").setMinValue(0).setMaxValue(168),
    )
    .addBooleanOption((o) => o.setName("silent").setDescription("Do not DM them")),

  async execute(interaction, client) {
    const guild = interaction.guild!;
    const user = interaction.options.getUser("user", true);
    const reason = await guardReason(interaction, client, interaction.options.getString("reason"));
    if (reason === null) return;

    const cfg = await client.config.get(guild.id, "moderation");
    const durationRaw = interaction.options.getString("duration");
    const durationMs = durationRaw ? parseDuration(durationRaw) : null;
    if (durationRaw && !durationMs) {
      await interaction.editReply({ embeds: [errorEmbed(`I could not read "${durationRaw}" as a duration. Try \`7d\` or \`12h\`.`)] });
      return;
    }

    const member = await guild.members.fetch(user.id).catch(() => null);
    if (member) {
      const check = canActOn(interaction.member as never, member, cfg.protectedRoles);
      if (!check.ok) {
        await interaction.editReply({ embeds: [errorEmbed(check.reason!)] });
        return;
      }
    }

    const deleteHours = interaction.options.getInteger("delete_hours") ?? cfg.banDeleteMessageHours;

    const created = await createCase(client, {
      guild,
      type: "BAN",
      target: user,
      moderator: interaction.user,
      reason,
      durationMs: durationMs ?? undefined,
      silent: interaction.options.getBoolean("silent") ?? false,
    });

    try {
      await guild.members.ban(user.id, {
        reason: `${reason} — by ${interaction.user.username} (case #${created.caseNumber})`,
        deleteMessageSeconds: deleteHours * 3600,
      });
    } catch {
      await prisma.case.delete({ where: { id: created.id } }).catch(() => undefined);
      await interaction.editReply({ embeds: [errorEmbed("I could not ban them. Check my permissions and role position.")] });
      return;
    }

    await interaction.editReply({
      embeds: [
        actionEmbed(
          durationMs ? `banned for ${formatDuration(durationMs)}` : "banned",
          user.username,
          created.caseNumber,
          reason,
        ),
      ],
    });
  },
};

export const unbanCommand: BotCommand = {
  permission: "mod",
  data: new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Lift a ban")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption((o) => o.setName("user_id").setDescription("The banned user ID").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Why").setMaxLength(500)),

  async execute(interaction, client) {
    const guild = interaction.guild!;
    const userId = interaction.options.getString("user_id", true).replace(/\D/g, "");
    const reason = interaction.options.getString("reason")?.trim() || "No reason provided";

    const ban = await guild.bans.fetch(userId).catch(() => null);
    if (!ban) {
      await interaction.editReply({ embeds: [errorEmbed("That user is not banned here.")] });
      return;
    }

    await guild.members.unban(userId, `${reason} — by ${interaction.user.username}`);
    await prisma.case.updateMany({
      where: { guildId: guild.id, targetId: userId, type: "BAN", active: true },
      data: { active: false },
    });

    const created = await createCase(client, {
      guild,
      type: "UNBAN",
      target: { id: userId, tag: ban.user.username },
      moderator: interaction.user,
      reason,
    });

    await interaction.editReply({ embeds: [actionEmbed("unbanned", ban.user.username, created.caseNumber, reason)] });
  },
};

export const kickCommand: BotCommand = {
  permission: "mod",
  data: new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Remove a member from the server")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((o) => o.setName("user").setDescription("Who to kick").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Why").setMaxLength(500))
    .addBooleanOption((o) => o.setName("silent").setDescription("Do not DM them")),

  async execute(interaction, client) {
    const guild = interaction.guild!;
    const user = interaction.options.getUser("user", true);
    const reason = await guardReason(interaction, client, interaction.options.getString("reason"));
    if (reason === null) return;

    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      await interaction.editReply({ embeds: [errorEmbed("They are not in this server.")] });
      return;
    }

    const cfg = await client.config.get(guild.id, "moderation");
    const check = canActOn(interaction.member as never, member, cfg.protectedRoles);
    if (!check.ok) {
      await interaction.editReply({ embeds: [errorEmbed(check.reason!)] });
      return;
    }

    const created = await createCase(client, {
      guild,
      type: "KICK",
      target: user,
      moderator: interaction.user,
      reason,
      silent: interaction.options.getBoolean("silent") ?? false,
    });

    try {
      await member.kick(`${reason} — by ${interaction.user.username} (case #${created.caseNumber})`);
    } catch {
      await prisma.case.delete({ where: { id: created.id } }).catch(() => undefined);
      await interaction.editReply({ embeds: [errorEmbed("I could not kick them. Check my role position.")] });
      return;
    }

    await interaction.editReply({ embeds: [actionEmbed("kicked", user.username, created.caseNumber, reason)] });
  },
};

export const timeoutCommand: BotCommand = {
  permission: "mod",
  data: new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Temporarily stop a member from talking")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName("user").setDescription("Who").setRequired(true))
    .addStringOption((o) => o.setName("duration").setDescription("e.g. 10m, 1h, 7d — max 28 days"))
    .addStringOption((o) => o.setName("reason").setDescription("Why").setMaxLength(500))
    .addBooleanOption((o) => o.setName("silent").setDescription("Do not DM them")),

  async execute(interaction, client) {
    const guild = interaction.guild!;
    const user = interaction.options.getUser("user", true);
    const reason = await guardReason(interaction, client, interaction.options.getString("reason"));
    if (reason === null) return;

    const cfg = await client.config.get(guild.id, "moderation");
    const raw = interaction.options.getString("duration");
    const durationMs = raw ? parseDuration(raw) : cfg.defaultTimeoutSeconds * 1000;

    if (!durationMs) {
      await interaction.editReply({ embeds: [errorEmbed(`I could not read "${raw}" as a duration. Try \`10m\` or \`2h\`.`)] });
      return;
    }
    if (durationMs > MAX_TIMEOUT_MS) {
      await interaction.editReply({ embeds: [errorEmbed("Discord caps timeouts at 28 days. Use `/ban` with a duration for longer.")] });
      return;
    }

    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      await interaction.editReply({ embeds: [errorEmbed("They are not in this server.")] });
      return;
    }

    const check = canActOn(interaction.member as never, member, cfg.protectedRoles);
    if (!check.ok) {
      await interaction.editReply({ embeds: [errorEmbed(check.reason!)] });
      return;
    }

    const created = await createCase(client, {
      guild,
      type: "MUTE",
      target: user,
      moderator: interaction.user,
      reason,
      durationMs,
      silent: interaction.options.getBoolean("silent") ?? false,
    });

    try {
      await member.timeout(durationMs, `${reason} — by ${interaction.user.username} (case #${created.caseNumber})`);
    } catch {
      await prisma.case.delete({ where: { id: created.id } }).catch(() => undefined);
      await interaction.editReply({ embeds: [errorEmbed("I could not time them out. Check my permissions and role position.")] });
      return;
    }

    await interaction.editReply({
      embeds: [actionEmbed(`timed out for ${formatDuration(durationMs)}`, user.username, created.caseNumber, reason)],
    });
  },
};

export const untimeoutCommand: BotCommand = {
  permission: "mod",
  data: new SlashCommandBuilder()
    .setName("untimeout")
    .setDescription("Lift a timeout early")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName("user").setDescription("Who").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Why").setMaxLength(500)),

  async execute(interaction, client) {
    const guild = interaction.guild!;
    const user = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason")?.trim() || "No reason provided";

    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member?.isCommunicationDisabled()) {
      await interaction.editReply({ embeds: [errorEmbed("They are not timed out.")] });
      return;
    }

    await member.timeout(null, `${reason} — by ${interaction.user.username}`);
    await prisma.case.updateMany({
      where: { guildId: guild.id, targetId: user.id, type: "MUTE", active: true },
      data: { active: false },
    });

    const created = await createCase(client, {
      guild,
      type: "UNMUTE",
      target: user,
      moderator: interaction.user,
      reason,
    });

    await interaction.editReply({ embeds: [actionEmbed("un-timed out", user.username, created.caseNumber, reason)] });
  },
};

export const warnCommand: BotCommand = {
  permission: "mod",
  data: new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member and record it")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName("user").setDescription("Who").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Why").setRequired(true).setMaxLength(500))
    .addIntegerOption((o) => o.setName("severity").setDescription("1-3, affects thresholds").setMinValue(1).setMaxValue(3))
    .addBooleanOption((o) => o.setName("silent").setDescription("Do not DM them")),

  async execute(interaction, client) {
    const guild = interaction.guild!;
    const user = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason", true);
    const severity = interaction.options.getInteger("severity") ?? 1;

    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      await interaction.editReply({ embeds: [errorEmbed("They are not in this server.")] });
      return;
    }

    const cfg = await client.config.get(guild.id, "moderation");
    const check = canActOn(interaction.member as never, member, cfg.protectedRoles);
    if (!check.ok) {
      await interaction.editReply({ embeds: [errorEmbed(check.reason!)] });
      return;
    }

    const created = await createCase(client, {
      guild,
      type: "WARN",
      target: user,
      moderator: interaction.user,
      reason,
      points: severity,
      silent: interaction.options.getBoolean("silent") ?? false,
    });

    const outcome = await applyWarnThresholds(client, guild, member, interaction.user);

    await interaction.editReply({
      embeds: [
        actionEmbed(
          "warned",
          user.username,
          created.caseNumber,
          reason,
          outcome.applied
            ? `They now have **${outcome.warnCount}** active warnings — automatic **${outcome.action}** applied.`
            : `They now have **${outcome.warnCount}** active warning(s).`,
        ),
      ],
    });
  },
};

export const softbanCommand: BotCommand = {
  permission: "mod",
  data: new SlashCommandBuilder()
    .setName("softban")
    .setDescription("Ban then immediately unban, to clear a member's recent messages")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((o) => o.setName("user").setDescription("Who").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Why").setMaxLength(500))
    .addIntegerOption((o) =>
      o.setName("delete_hours").setDescription("How far back to clear").setMinValue(1).setMaxValue(168),
    ),

  async execute(interaction, client) {
    const guild = interaction.guild!;
    const user = interaction.options.getUser("user", true);
    const reason = await guardReason(interaction, client, interaction.options.getString("reason"));
    if (reason === null) return;
    const hours = interaction.options.getInteger("delete_hours") ?? 24;

    const member = await guild.members.fetch(user.id).catch(() => null);
    if (member) {
      const cfg = await client.config.get(guild.id, "moderation");
      const check = canActOn(interaction.member as never, member, cfg.protectedRoles);
      if (!check.ok) {
        await interaction.editReply({ embeds: [errorEmbed(check.reason!)] });
        return;
      }
    }

    const created = await createCase(client, {
      guild,
      type: "SOFTBAN",
      target: user,
      moderator: interaction.user,
      reason,
    });

    try {
      await guild.members.ban(user.id, { reason: `Softban: ${reason}`, deleteMessageSeconds: hours * 3600 });
      await guild.members.unban(user.id, "Softban — immediate unban");
    } catch {
      await interaction.editReply({ embeds: [errorEmbed("I could not softban them. Check my permissions.")] });
      return;
    }

    await interaction.editReply({
      embeds: [
        actionEmbed("softbanned", user.username, created.caseNumber, reason, `Their messages from the last ${hours}h were cleared.`),
      ],
    });
  },
};

export default [
  banCommand,
  unbanCommand,
  kickCommand,
  timeoutCommand,
  untimeoutCommand,
  warnCommand,
  softbanCommand,
];
