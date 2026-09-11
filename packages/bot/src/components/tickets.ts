import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { COLORS, EMOJI } from "@bambot/shared";
import type { ComponentHandler } from "../core/types";
import { prisma } from "../core/db";
import { config } from "../core/config";
import { childLogger } from "../core/logger";
import { errorEmbed, successEmbed, clamp } from "../lib/embeds";
import { findCategory, logTicketEvent, openTicket, priorityRow } from "../services/tickets";
import {
  addUserToTicket,
  canManageTicket,
  claimTicket,
  closeTicketByChannel,
  setTicketPriority,
} from "../services/ticket-actions";

const log = childLogger("ticket-components");

const ephemeral = { flags: MessageFlags.Ephemeral as const };

const reply = async (interaction: MessageComponentInteraction | ModalSubmitInteraction, embed: EmbedBuilder) => {
  if (interaction.deferred || interaction.replied) await interaction.followUp({ embeds: [embed], ...ephemeral });
  else await interaction.reply({ embeds: [embed], ...ephemeral });
};

/** Builds the intake modal for a category, or null when it has no form. */
const buildIntakeModal = (panelId: string, categoryKey: string, category: ReturnType<typeof findCategory>) => {
  if (!category?.form.length) return null;
  const modal = new ModalBuilder()
    .setCustomId(`ticket:submit:${panelId}:${categoryKey}`)
    .setTitle(clamp(category.label, 45));

  for (const field of category.form.slice(0, 5)) {
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setLabel(clamp(field.label, 45))
      .setStyle(field.style === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(field.required)
      .setMaxLength(Math.min(field.maxLength, 4000));
    if (field.placeholder) input.setPlaceholder(clamp(field.placeholder, 100));
    if (field.minLength > 0) input.setMinLength(field.minLength);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  }
  return modal;
};

export const ticketHandler: ComponentHandler = {
  prefix: "ticket",
  async execute(interaction, args, client) {
    const [action, ...rest] = args;
    const guild = interaction.guild;
    if (!guild) {
      // Rating buttons arrive in DMs, which is the one case without a guild.
      if (action === "rate") return handleRating(interaction, rest);
      await reply(interaction, errorEmbed("This only works inside a server."));
      return;
    }

    switch (action) {
      case "open": {
        const panelId = rest[0] ?? null;
        const categoryKey = interaction.isStringSelectMenu() ? interaction.values[0] : rest[1];
        if (!categoryKey) {
          await reply(interaction, errorEmbed("That option is no longer available."));
          return;
        }

        const cfg = await client.config.get(guild.id, "tickets");
        const category = findCategory(cfg, categoryKey);
        if (!category || !category.enabled) {
          await reply(interaction, errorEmbed("That ticket category is not available any more."));
          return;
        }

        const modal = buildIntakeModal(panelId ?? "none", categoryKey, category);
        if (modal && interaction.isMessageComponent()) {
          await interaction.showModal(modal);
          return;
        }

        // No form: open straight away.
        await interaction.deferReply(ephemeral);
        const member = await guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member) {
          await interaction.editReply({ embeds: [errorEmbed("I could not find you in this server.")] });
          return;
        }
        const result = await openTicket(client, guild, member, categoryKey, panelId, {});
        await interaction.editReply({ embeds: [result.ok ? successEmbed(result.message) : errorEmbed(result.message)] });
        return;
      }

      case "submit": {
        if (!interaction.isModalSubmit()) return;
        const panelId = rest[0] === "none" ? null : (rest[0] ?? null);
        const categoryKey = rest[1];
        await interaction.deferReply(ephemeral);

        const cfg = await client.config.get(guild.id, "tickets");
        const category = findCategory(cfg, categoryKey);
        if (!category) {
          await interaction.editReply({ embeds: [errorEmbed("That ticket category no longer exists.")] });
          return;
        }

        const responses: Record<string, string> = {};
        for (const field of category.form) {
          const value = interaction.fields.getTextInputValue(field.id);
          if (value) responses[field.id] = value;
        }

        const member = await guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member) {
          await interaction.editReply({ embeds: [errorEmbed("I could not find you in this server.")] });
          return;
        }

        const result = await openTicket(client, guild, member, categoryKey, panelId, responses);
        await interaction.editReply({ embeds: [result.ok ? successEmbed(result.message) : errorEmbed(result.message)] });
        return;
      }

      case "close": {
        const channelId = rest[0];
        const ticket = await prisma.ticket.findUnique({ where: { channelId } });
        if (!ticket) {
          await reply(interaction, errorEmbed("This channel is not an open ticket."));
          return;
        }

        const cfg = await client.config.get(guild.id, "tickets");
        const isOwner = ticket.openerId === interaction.user.id;
        const isStaff = await canManageTicket(guild, interaction.user.id, ticket.categoryKey);
        if (!isStaff && !(isOwner && cfg.allowUserClose)) {
          await reply(interaction, errorEmbed("Only staff can close this ticket."));
          return;
        }

        if (cfg.closeReasonRequired) {
          const modal = new ModalBuilder()
            .setCustomId(`ticket:closewithreason:${channelId}`)
            .setTitle(`Close ticket #${ticket.ticketNumber}`)
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId("reason")
                  .setLabel("Why are you closing this?")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(true)
                  .setMaxLength(500),
              ),
            );
          if (interaction.isMessageComponent()) {
            await interaction.showModal(modal);
            return;
          }
        }

        if (cfg.closeConfirmation) {
          await interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(COLORS.warning)
                .setDescription(`${EMOJI.warning} Close ticket **#${ticket.ticketNumber}**? A transcript will be saved.`),
            ],
            components: [
              new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`ticket:confirmclose:${channelId}`).setLabel("Close it").setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId("noop:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
              ),
            ],
            ...ephemeral,
          });
          return;
        }

        await interaction.deferReply(ephemeral);
        const result = await closeTicketByChannel(
          client,
          guild,
          channelId,
          { id: interaction.user.id, tag: interaction.user.username },
          "No reason given",
        );
        await interaction.editReply({ embeds: [result.ok ? successEmbed(result.message) : errorEmbed(result.message)] });
        return;
      }

      case "confirmclose": {
        await interaction.deferReply(ephemeral);
        const result = await closeTicketByChannel(
          client,
          guild,
          rest[0],
          { id: interaction.user.id, tag: interaction.user.username },
          "No reason given",
        );
        await interaction.editReply({ embeds: [result.ok ? successEmbed(result.message) : errorEmbed(result.message)] });
        return;
      }

      case "closewithreason": {
        if (!interaction.isModalSubmit()) return;
        await interaction.deferReply(ephemeral);
        const reason = interaction.fields.getTextInputValue("reason");
        const result = await closeTicketByChannel(
          client,
          guild,
          rest[0],
          { id: interaction.user.id, tag: interaction.user.username },
          reason,
        );
        await interaction.editReply({ embeds: [result.ok ? successEmbed(result.message) : errorEmbed(result.message)] });
        return;
      }

      case "claim": {
        const channelId = rest[0];
        const ticket = await prisma.ticket.findUnique({ where: { channelId } });
        if (!ticket) {
          await reply(interaction, errorEmbed("This channel is not a ticket."));
          return;
        }
        if (!(await canManageTicket(guild, interaction.user.id, ticket.categoryKey))) {
          await reply(interaction, errorEmbed("Only support staff can claim tickets."));
          return;
        }

        await interaction.deferReply();
        const result = await claimTicket(client, guild, channelId, { id: interaction.user.id, tag: interaction.user.username });
        await interaction.editReply({ embeds: [result.ok ? successEmbed(result.message) : errorEmbed(result.message)] });
        return;
      }

      case "priority": {
        const channelId = rest[0];
        const ticket = await prisma.ticket.findUnique({ where: { channelId } });
        if (!ticket || !(await canManageTicket(guild, interaction.user.id, ticket.categoryKey))) {
          await reply(interaction, errorEmbed("Only support staff can change the priority."));
          return;
        }
        await interaction.reply({ content: "Choose a priority:", components: [priorityRow(channelId)], ...ephemeral });
        return;
      }

      case "setpriority": {
        if (!interaction.isStringSelectMenu()) return;
        await interaction.deferUpdate();
        const result = await setTicketPriority(guild, rest[0], interaction.values[0]);
        await interaction.editReply({
          content: result.message,
          components: [],
          embeds: [],
        });
        return;
      }

      case "adduser": {
        const channelId = rest[0];
        const ticket = await prisma.ticket.findUnique({ where: { channelId } });
        if (!ticket) {
          await reply(interaction, errorEmbed("This channel is not a ticket."));
          return;
        }
        const allowed =
          ticket.openerId === interaction.user.id || (await canManageTicket(guild, interaction.user.id, ticket.categoryKey));
        if (!allowed) {
          await reply(interaction, errorEmbed("You cannot add people to this ticket."));
          return;
        }
        if (!interaction.isMessageComponent()) return;
        await interaction.showModal(
          new ModalBuilder()
            .setCustomId(`ticket:addusermodal:${channelId}`)
            .setTitle("Add someone to this ticket")
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId("userId")
                  .setLabel("User ID")
                  .setPlaceholder("Right-click a member > Copy User ID")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setMaxLength(25),
              ),
            ),
        );
        return;
      }

      case "addusermodal": {
        if (!interaction.isModalSubmit()) return;
        await interaction.deferReply(ephemeral);
        const userId = interaction.fields.getTextInputValue("userId").replace(/\D/g, "");
        if (!userId) {
          await interaction.editReply({ embeds: [errorEmbed("That is not a valid user ID.")] });
          return;
        }
        const result = await addUserToTicket(guild, rest[0], userId);
        await interaction.editReply({ embeds: [result.ok ? successEmbed(result.message) : errorEmbed(result.message)] });
        return;
      }

      case "rate":
        await handleRating(interaction, rest);
        return;

      default:
        log.debug({ action }, "unknown ticket action");
    }
  },
};

const handleRating = async (interaction: MessageComponentInteraction | ModalSubmitInteraction, rest: string[]) => {
  const [ticketId, starsRaw] = rest;
  const stars = Number(starsRaw);
  if (!ticketId || !Number.isInteger(stars) || stars < 1 || stars > 5) return;

  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) {
    await reply(interaction, errorEmbed("That ticket no longer exists."));
    return;
  }
  if (ticket.openerId !== interaction.user.id) {
    await reply(interaction, errorEmbed("Only the person who opened the ticket can rate it."));
    return;
  }
  if (ticket.rating) {
    await reply(interaction, errorEmbed("You have already rated this ticket. Thank you!"));
    return;
  }

  await prisma.ticket.update({ where: { id: ticketId }, data: { rating: stars } });

  if (interaction.isMessageComponent()) {
    await interaction.update({
      embeds: [successEmbed(`Thanks for rating us ${"⭐".repeat(stars)}.`)],
      components: [],
    });
  } else {
    await reply(interaction, successEmbed(`Thanks for rating us ${"⭐".repeat(stars)}.`));
  }

  const client = interaction.client;
  const guild = client.guilds.cache.get(ticket.guildId);
  if (!guild) return;

  const cfg = await config.get(guild.id, "tickets");
  const target = cfg.ratingChannelId || cfg.logChannelId;
  if (!target) return;
  const channel = guild.channels.cache.get(target);
  if (!channel?.isTextBased()) return;

  await channel
    .send({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.star)
          .setTitle(`${EMOJI.star} Ticket #${ticket.ticketNumber} rated ${"⭐".repeat(stars)}`)
          .addFields(
            { name: "Member", value: `<@${ticket.openerId}>`, inline: true },
            { name: "Handled by", value: ticket.claimedById ? `<@${ticket.claimedById}>` : "unclaimed", inline: true },
          )
          .setTimestamp(new Date()),
      ],
    })
    .catch(() => undefined);
};

export default ticketHandler;
