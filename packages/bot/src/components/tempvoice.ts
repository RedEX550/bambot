import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { ComponentHandler } from "../core/types";
import { prisma } from "../core/db";
import { errorEmbed, successEmbed } from "../lib/embeds";

const ephemeral = { flags: MessageFlags.Ephemeral as const };

export const tempVoiceHandler: ComponentHandler = {
  prefix: "tempvoice",
  async execute(interaction, args) {
    const guild = interaction.guild;
    if (!guild) return;

    const [action, channelId] = args;
    const record = await prisma.tempVoice.findUnique({ where: { channelId } });
    if (!record) {
      await interaction.reply({ embeds: [errorEmbed("This room is no longer managed.")], ...ephemeral });
      return;
    }
    if (record.ownerId !== interaction.user.id) {
      await interaction.reply({ embeds: [errorEmbed("Only the room owner can use these controls.")], ...ephemeral });
      return;
    }

    const channel = guild.channels.cache.get(channelId);
    if (!channel?.isVoiceBased()) {
      await interaction.reply({ embeds: [errorEmbed("That channel is gone.")], ...ephemeral });
      return;
    }

    if (action === "rename" || action === "limit") {
      if (!interaction.isMessageComponent()) return;
      const isRename = action === "rename";
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(`tempvoice:${isRename ? "renamed" : "limited"}:${channelId}`)
          .setTitle(isRename ? "Rename your room" : "Set a user limit")
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId("value")
                .setLabel(isRename ? "New name" : "Limit (0 for unlimited)")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(isRename ? 100 : 2),
            ),
          ),
      );
      return;
    }

    await interaction.deferReply(ephemeral);

    switch (action) {
      case "lock":
        await channel.permissionOverwrites.edit(guild.roles.everyone, { Connect: false });
        await prisma.tempVoice.update({ where: { id: record.id }, data: { locked: true } });
        await interaction.editReply({ embeds: [successEmbed("Room locked. Only people you allow can join.")] });
        return;

      case "unlock":
        await channel.permissionOverwrites.edit(guild.roles.everyone, { Connect: null });
        await prisma.tempVoice.update({ where: { id: record.id }, data: { locked: false } });
        await interaction.editReply({ embeds: [successEmbed("Room unlocked.")] });
        return;

      case "renamed": {
        if (!interaction.isModalSubmit()) return;
        const name = interaction.fields.getTextInputValue("value").slice(0, 100);
        await channel.setName(name).catch(() => undefined);
        await prisma.tempVoice.update({ where: { id: record.id }, data: { name } });
        await interaction.editReply({ embeds: [successEmbed(`Renamed to **${name}**.`)] });
        return;
      }

      case "limited": {
        if (!interaction.isModalSubmit()) return;
        const raw = Number.parseInt(interaction.fields.getTextInputValue("value"), 10);
        if (Number.isNaN(raw) || raw < 0 || raw > 99) {
          await interaction.editReply({ embeds: [errorEmbed("Enter a number between 0 and 99.")] });
          return;
        }
        await channel.setUserLimit(raw).catch(() => undefined);
        await interaction.editReply({
          embeds: [successEmbed(raw === 0 ? "User limit removed." : `User limit set to **${raw}**.`)],
        });
        return;
      }

      default:
        await interaction.editReply({ embeds: [errorEmbed("Unknown control.")] });
    }
  },
};

export default tempVoiceHandler;
