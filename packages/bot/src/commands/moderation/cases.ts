import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { COLORS, EMOJI } from "@bambot/shared";
import type { BotCommand } from "../../core/types";
import { prisma } from "../../core/db";
import { clamp, errorEmbed, successEmbed } from "../../lib/embeds";
import { formatDuration, timestamp } from "../../lib/time";
import { caseSummary, createCase } from "../../services/moderation";

const TYPE_EMOJI: Record<string, string> = {
  WARN: "⚠️",
  MUTE: "🔇",
  UNMUTE: "🔊",
  KICK: "👢",
  BAN: "🔨",
  UNBAN: "🕊️",
  SOFTBAN: "🧹",
  NOTE: "📝",
  QUARANTINE: "🚧",
};

export const caseCommand: BotCommand = {
  permission: "mod",
  data: new SlashCommandBuilder()
    .setName("case")
    .setDescription("Inspect and manage moderation cases")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((sub) =>
      sub
        .setName("view")
        .setDescription("Show one case")
        .addIntegerOption((o) => o.setName("number").setDescription("Case number").setRequired(true).setMinValue(1)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("reason")
        .setDescription("Change the reason on a case")
        .addIntegerOption((o) => o.setName("number").setDescription("Case number").setRequired(true).setMinValue(1))
        .addStringOption((o) => o.setName("reason").setDescription("New reason").setRequired(true).setMaxLength(500)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("pardon")
        .setDescription("Void a case so it stops counting toward thresholds")
        .addIntegerOption((o) => o.setName("number").setDescription("Case number").setRequired(true).setMinValue(1))
        .addStringOption((o) => o.setName("reason").setDescription("Why").setMaxLength(500)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("recent")
        .setDescription("The most recent cases in this server")
        .addIntegerOption((o) => o.setName("limit").setDescription("How many (max 20)").setMinValue(1).setMaxValue(20)),
    ),

  async execute(interaction) {
    const guildId = interaction.guildId!;
    const sub = interaction.options.getSubcommand();

    if (sub === "recent") {
      const limit = interaction.options.getInteger("limit") ?? 10;
      const cases = await prisma.case.findMany({ where: { guildId }, orderBy: { caseNumber: "desc" }, take: limit });
      if (!cases.length) {
        await interaction.editReply({ embeds: [errorEmbed("There are no cases in this server yet.")] });
        return;
      }
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.info)
            .setTitle(`${EMOJI.shield} Recent cases`)
            .setDescription(
              cases
                .map(
                  (c) =>
                    `${TYPE_EMOJI[c.type] ?? "•"} \`#${c.caseNumber}\` **${c.type}** — <@${c.targetId}>${
                      c.pardoned ? " *(pardoned)*" : ""
                    }\n└ ${clamp(c.reason, 80)} · ${timestamp(c.createdAt, "R")}`,
                )
                .join("\n")
                .slice(0, 4000),
            ),
        ],
      });
      return;
    }

    const number = interaction.options.getInteger("number", true);
    const record = await prisma.case.findUnique({ where: { guildId_caseNumber: { guildId, caseNumber: number } } });
    if (!record) {
      await interaction.editReply({ embeds: [errorEmbed(`Case #${number} does not exist.`)] });
      return;
    }

    if (sub === "view") {
      const embed = new EmbedBuilder()
        .setColor(record.pardoned ? COLORS.neutral : COLORS.info)
        .setTitle(`${TYPE_EMOJI[record.type] ?? ""} Case #${record.caseNumber} — ${record.type}`)
        .addFields(
          { name: "Member", value: `<@${record.targetId}>\n\`${record.targetTag}\``, inline: true },
          { name: "Moderator", value: `<@${record.moderatorId}>\n\`${record.moderatorTag}\``, inline: true },
          { name: "When", value: timestamp(record.createdAt, "F"), inline: false },
          { name: "Reason", value: clamp(record.reason, 1024) },
        )
        .setFooter({ text: record.pardoned ? "This case has been pardoned" : `Case #${record.caseNumber}` });

      if (record.duration) embed.addFields({ name: "Duration", value: formatDuration(record.duration), inline: true });
      if (record.expiresAt) embed.addFields({ name: "Expires", value: timestamp(record.expiresAt, "R"), inline: true });
      if (record.evidence.length) {
        embed.addFields({ name: "Evidence", value: record.evidence.map((e) => `• ${e}`).join("\n").slice(0, 1024) });
      }

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (sub === "reason") {
      const reason = interaction.options.getString("reason", true);
      await prisma.case.update({ where: { id: record.id }, data: { reason } });
      await interaction.editReply({ embeds: [successEmbed(`Case #${number} reason updated.`)] });
      return;
    }

    if (sub === "pardon") {
      if (record.pardoned) {
        await interaction.editReply({ embeds: [errorEmbed("That case is already pardoned.")] });
        return;
      }
      await prisma.case.update({
        where: { id: record.id },
        data: { pardoned: true, active: false, pardonedBy: interaction.user.id },
      });
      await interaction.editReply({
        embeds: [successEmbed(`Case #${number} pardoned. It no longer counts toward warn thresholds.`)],
      });
    }
  },
};

export const warningsCommand: BotCommand = {
  permission: "mod",
  data: new SlashCommandBuilder()
    .setName("history")
    .setDescription("Every case recorded against a member")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName("user").setDescription("Who").setRequired(true)),

  async execute(interaction) {
    const user = interaction.options.getUser("user", true);
    const { cases, counts, total } = await caseSummary(interaction.guildId!, user.id);

    if (!total) {
      await interaction.editReply({
        embeds: [successEmbed(`**${user.username}** has a clean record in this server.`)],
      });
      return;
    }

    const summary = Object.entries(counts)
      .map(([type, count]) => `${TYPE_EMOJI[type] ?? "•"} ${count} × ${type}`)
      .join(" · ");

    const embed = new EmbedBuilder()
      .setColor(COLORS.warning)
      .setAuthor({ name: user.username, iconURL: user.displayAvatarURL({ size: 64 }) })
      .setTitle(`${total} case(s) on record`)
      .setDescription(summary || "No active cases")
      .addFields({
        name: "Most recent",
        value:
          cases
            .slice(0, 10)
            .map(
              (c) =>
                `${TYPE_EMOJI[c.type] ?? "•"} \`#${c.caseNumber}\` ${c.type}${c.pardoned ? " *(pardoned)*" : ""} — ${clamp(
                  c.reason,
                  60,
                )} · ${timestamp(c.createdAt, "R")}`,
            )
            .join("\n")
            .slice(0, 1024) || "none",
      });

    if (total > 10) embed.setFooter({ text: `Showing 10 of ${total}. The dashboard has the full history.` });

    await interaction.editReply({ embeds: [embed] });
  },
};

export const noteCommand: BotCommand = {
  permission: "staff",
  data: new SlashCommandBuilder()
    .setName("note")
    .setDescription("Attach a private staff note to a member — they are never told")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName("user").setDescription("Who").setRequired(true))
    .addStringOption((o) => o.setName("note").setDescription("The note").setRequired(true).setMaxLength(500)),

  async execute(interaction, client) {
    const user = interaction.options.getUser("user", true);
    const note = interaction.options.getString("note", true);

    const created = await createCase(client, {
      guild: interaction.guild!,
      type: "NOTE",
      target: user,
      moderator: interaction.user,
      reason: note,
      silent: true,
    });

    await interaction.editReply({
      embeds: [successEmbed(`Note saved against **${user.username}** as case #${created.caseNumber}.`)],
    });
  },
};

export default [caseCommand, warningsCommand, noteCommand];
