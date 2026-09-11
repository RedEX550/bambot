import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type Guild,
  type GuildMember,
  type OverwriteResolvable,
  type TextChannel,
} from "discord.js";
import type { TicketCategory, TicketPanel, TicketsConfig } from "@bambot/shared";
import { COLORS, EMOJI, TICKET_PRIORITIES } from "@bambot/shared";
import { prisma } from "../core/db";
import { config } from "../core/config";
import { bumpDailyStat } from "../lib/stats";
import { childLogger } from "../core/logger";
import type { BambotClient } from "../core/client";
import { buildMessage } from "../lib/payload";
import { fetchAllMessages, renderTranscript } from "../lib/transcript";
import { clamp } from "../lib/embeds";

const log = childLogger("tickets");

export const PRIORITY_COLORS: Record<string, number> = {
  LOW: COLORS.neutral,
  NORMAL: COLORS.brand,
  HIGH: COLORS.warning,
  URGENT: COLORS.danger,
};

export const findCategory = (cfg: TicketsConfig, key: string): TicketCategory | undefined =>
  cfg.categories.find((c) => c.key === key);

/** Discord channel names: lowercase, no spaces, 100 chars. */
const sanitizeName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9\-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100) || "ticket";

/**
 * Allocates the next ticket number for a guild.
 *
 * Two people clicking at the same instant would otherwise collide on the
 * (guildId, ticketNumber) unique index, so the caller retries. Doing it this
 * way keeps numbers gapless and human-friendly, which matters when staff refer
 * to "ticket 1042" in conversation.
 */
const nextTicketNumber = async (guildId: string): Promise<number> => {
  const highest = await prisma.ticket.findFirst({
    where: { guildId },
    orderBy: { ticketNumber: "desc" },
    select: { ticketNumber: true },
  });
  return (highest?.ticketNumber ?? 0) + 1;
};

export const buildPanelComponents = (panel: TicketPanel, cfg: TicketsConfig) => {
  const categories = panel.categoryKeys
    .map((key) => findCategory(cfg, key))
    .filter((c): c is TicketCategory => Boolean(c) && c!.enabled);

  if (!categories.length) return [];

  if (panel.style === "select") {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`ticket:open:${panel.id}`)
      .setPlaceholder(clamp(panel.selectPlaceholder || "Choose an option", 150))
      .addOptions(
        categories.slice(0, 25).map((category) => {
          const option = new StringSelectMenuOptionBuilder()
            .setLabel(clamp(category.label, 100))
            .setValue(category.key);
          if (category.description) option.setDescription(clamp(category.description, 100));
          if (category.emoji) {
            try {
              option.setEmoji(category.emoji);
            } catch {
              // An emoji from another server would break the whole panel.
            }
          }
          return option;
        }),
      );
    return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
  }

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const buttons = categories.slice(0, 25).map((category) => {
    const button = new ButtonBuilder()
      .setCustomId(`ticket:open:${panel.id}:${category.key}`)
      .setLabel(clamp(category.label, 80))
      .setStyle(ButtonStyle.Secondary);
    if (category.emoji) {
      try {
        button.setEmoji(category.emoji);
      } catch {
        /* ignore unusable emoji */
      }
    }
    return button;
  });
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
  }
  return rows;
};

/** Publishes or refreshes a panel message in its channel. */
export const publishPanel = async (guild: Guild, panelId: string): Promise<{ ok: boolean; message: string }> => {
  const cfg = await config.get(guild.id, "tickets");
  const panel = cfg.panels.find((p) => p.id === panelId);
  if (!panel) return { ok: false, message: "That panel no longer exists." };
  if (!panel.channelId) return { ok: false, message: "Pick a channel for this panel first." };

  const channel = guild.channels.cache.get(panel.channelId);
  if (!channel || !channel.isTextBased()) return { ok: false, message: "The panel channel is missing or is not a text channel." };

  const components = buildPanelComponents(panel, cfg);
  if (!components.length) return { ok: false, message: "This panel has no enabled categories." };

  const built = buildMessage(panel.message, { guild });
  const payload = { content: built.content, embeds: built.embeds, components };

  const existing = await prisma.panelMessage.findUnique({ where: { guildId_panelId: { guildId: guild.id, panelId } } });

  if (existing) {
    const previous = await channel.messages.fetch(existing.messageId).catch(() => null);
    if (previous && previous.editable) {
      await previous.edit(payload);
      return { ok: true, message: `Panel refreshed in #${channel.name}.` };
    }
  }

  const sent = await channel.send(payload);
  await prisma.panelMessage.upsert({
    where: { guildId_panelId: { guildId: guild.id, panelId } },
    create: { guildId: guild.id, panelId, channelId: channel.id, messageId: sent.id },
    update: { channelId: channel.id, messageId: sent.id },
  });
  return { ok: true, message: `Panel posted in #${channel.name}.` };
};

export const ticketControlRow = (ticketId: string, cfg: TicketsConfig) => {
  const buttons = [
    new ButtonBuilder().setCustomId(`ticket:close:${ticketId}`).setLabel("Close").setEmoji(EMOJI.lock).setStyle(ButtonStyle.Danger),
  ];
  if (cfg.claimEnabled) {
    buttons.push(
      new ButtonBuilder().setCustomId(`ticket:claim:${ticketId}`).setLabel("Claim").setEmoji("🙋").setStyle(ButtonStyle.Success),
    );
  }
  buttons.push(
    new ButtonBuilder().setCustomId(`ticket:priority:${ticketId}`).setLabel("Priority").setEmoji("🎚️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ticket:adduser:${ticketId}`).setLabel("Add user").setEmoji("➕").setStyle(ButtonStyle.Secondary),
  );
  return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
};

export interface OpenTicketResult {
  ok: boolean;
  message: string;
  channelId?: string;
  ticketNumber?: number;
}

export const openTicket = async (
  client: BambotClient,
  guild: Guild,
  member: GuildMember,
  categoryKey: string,
  panelId: string | null,
  formResponses: Record<string, string>,
): Promise<OpenTicketResult> => {
  const cfg = await client.config.get(guild.id, "tickets");
  if (!cfg.enabled) return { ok: false, message: "The ticket system is switched off." };

  const category = findCategory(cfg, categoryKey);
  if (!category || !category.enabled) return { ok: false, message: "That ticket category is not available." };

  if (cfg.blockedRoles.some((r) => member.roles.cache.has(r)) || category.blockedRoles.some((r) => member.roles.cache.has(r))) {
    return { ok: false, message: "You are not allowed to open tickets." };
  }
  if (category.requiredRoles.length && !category.requiredRoles.some((r) => member.roles.cache.has(r))) {
    return { ok: false, message: "You do not have the role needed for this category." };
  }

  const openForUser = await prisma.ticket.count({
    where: { guildId: guild.id, openerId: member.id, status: { not: "CLOSED" } },
  });
  if (openForUser >= cfg.globalMaxOpenPerUser) {
    return { ok: false, message: `You already have ${openForUser} open ticket(s). Close one before opening another.` };
  }
  const openInCategory = await prisma.ticket.count({
    where: { guildId: guild.id, openerId: member.id, categoryKey, status: { not: "CLOSED" } },
  });
  if (openInCategory >= category.maxOpenPerUser) {
    return { ok: false, message: `You already have an open **${category.label}** ticket.` };
  }

  const supportRoles = category.supportRoles.length ? category.supportRoles : (await client.config.get(guild.id, "core")).staffRoles;

  const overwrites: OverwriteResolvable[] = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: member.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
  ];
  const me = guild.members.me;
  if (me) {
    overwrites.push({
      id: me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.AttachFiles,
      ],
    });
  }
  for (const roleId of supportRoles) {
    if (!guild.roles.cache.has(roleId)) continue;
    overwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageMessages,
      ],
    });
  }

  // Retry covers the race where two members open a ticket in the same tick.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ticketNumber = await nextTicketNumber(guild.id);
    const name = sanitizeName(
      category.naming
        .replace(/\{number\}/g, String(ticketNumber).padStart(4, "0"))
        .replace(/\{user\.id\}/g, member.id)
        .replace(/\{user\}/g, member.user.username)
        .replace(/\{category\}/g, category.key),
    );

    let channel: TextChannel;
    try {
      channel = (await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent: category.parentCategoryId && guild.channels.cache.has(category.parentCategoryId) ? category.parentCategoryId : undefined,
        permissionOverwrites: overwrites,
        topic: `Ticket #${ticketNumber} • ${category.label} • opened by ${member.user.username} (${member.id})`,
        reason: `Ticket #${ticketNumber} opened by ${member.user.tag}`,
      })) as TextChannel;
    } catch (err) {
      log.error({ err, guildId: guild.id }, "could not create ticket channel");
      return { ok: false, message: "I could not create the channel. Check that I have Manage Channels." };
    }

    try {
      await prisma.ticket.create({
        data: {
          guildId: guild.id,
          ticketNumber,
          channelId: channel.id,
          panelId,
          categoryKey,
          openerId: member.id,
          openerTag: member.user.username,
          priority: category.defaultPriority,
          status: "OPEN",
          formResponses: formResponses as never,
          participants: [member.id],
          subject: formResponses[Object.keys(formResponses)[0] ?? ""]?.slice(0, 120) ?? null,
        },
      });
    } catch (err) {
      await channel.delete("Ticket number collision, retrying").catch(() => undefined);
      if (attempt === 2) {
        log.error({ err }, "gave up allocating a ticket number");
        return { ok: false, message: "Could not open a ticket right now. Please try again." };
      }
      continue;
    }

    const built = buildMessage(category.openingMessage, {
      member,
      user: member.user,
      guild,
      ticket: {
        number: ticketNumber,
        category: category.label,
        opener: `<@${member.id}>`,
        channel: `<#${channel.id}>`,
        priority: category.defaultPriority,
      },
    });

    const embeds = [...built.embeds];

    if (Object.keys(formResponses).length) {
      const answers = new EmbedBuilder()
        .setColor(PRIORITY_COLORS[category.defaultPriority] ?? COLORS.brand)
        .setTitle("Details provided")
        .addFields(
          category.form
            .filter((field) => formResponses[field.id])
            .map((field) => ({ name: field.label, value: clamp(formResponses[field.id], 1024), inline: false })),
        );
      embeds.push(answers);
    }

    if (cfg.supportHours.enabled && !isWithinSupportHours(cfg)) {
      embeds.push(new EmbedBuilder().setColor(COLORS.warning).setDescription(`${EMOJI.info} ${cfg.supportHours.offHoursNote}`));
    }

    const pings = [`<@${member.id}>`, ...category.pingRoles.map((r) => `<@&${r}>`)].join(" ");

    await channel
      .send({
        content: pings,
        embeds,
        components: [ticketControlRow(channel.id, cfg)],
      })
      .catch((err) => log.error({ err }, "failed to send ticket opening message"));

    await logTicketEvent(client, guild, "opened", {
      ticketNumber,
      channelId: channel.id,
      categoryLabel: category.label,
      actorTag: member.user.username,
      actorId: member.id,
    });

    bumpDailyStat(guild.id, "ticketsOpened");

    return { ok: true, message: `Ticket opened: <#${channel.id}>`, channelId: channel.id, ticketNumber };
  }

  return { ok: false, message: "Could not open a ticket right now." };
};

export const isWithinSupportHours = (cfg: TicketsConfig): boolean => {
  if (!cfg.supportHours.enabled) return true;
  const now = new Date();
  let hour: number;
  let day: number;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: cfg.supportHours.timezone || "UTC",
      hour: "numeric",
      weekday: "short",
      hour12: false,
    }).formatToParts(now);
    hour = Number(parts.find((p) => p.type === "hour")?.value ?? now.getUTCHours());
    const weekdayName = parts.find((p) => p.type === "weekday")?.value ?? "";
    day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName);
  } catch {
    hour = now.getUTCHours();
    day = now.getUTCDay();
  }
  if (day >= 0 && !cfg.supportHours.days.includes(day)) return false;
  const { startHour, endHour } = cfg.supportHours;
  return startHour <= endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;
};

export interface TicketLogPayload {
  ticketNumber: number;
  channelId: string;
  categoryLabel?: string;
  actorTag: string;
  actorId: string;
  reason?: string;
  rating?: number;
}

export const logTicketEvent = async (
  client: BambotClient,
  guild: Guild,
  event: "opened" | "claimed" | "closed" | "rated",
  payload: TicketLogPayload,
) => {
  const cfg = await client.config.get(guild.id, "tickets");
  if (!cfg.logChannelId) return;
  const channel = guild.channels.cache.get(cfg.logChannelId);
  if (!channel?.isTextBased()) return;

  const colors = { opened: COLORS.success, claimed: COLORS.info, closed: COLORS.neutral, rated: COLORS.star };
  const titles = {
    opened: `${EMOJI.ticket} Ticket #${payload.ticketNumber} opened`,
    claimed: `🙋 Ticket #${payload.ticketNumber} claimed`,
    closed: `${EMOJI.lock} Ticket #${payload.ticketNumber} closed`,
    rated: `${EMOJI.star} Ticket #${payload.ticketNumber} rated`,
  };

  const embed = new EmbedBuilder()
    .setColor(colors[event])
    .setTitle(titles[event])
    .setTimestamp(new Date())
    .addFields(
      { name: "Member", value: `<@${payload.actorId}> (${payload.actorTag})`, inline: true },
      { name: "Channel", value: `<#${payload.channelId}>`, inline: true },
    );
  if (payload.categoryLabel) embed.addFields({ name: "Category", value: payload.categoryLabel, inline: true });
  if (payload.reason) embed.addFields({ name: "Reason", value: clamp(payload.reason, 1024) });
  if (payload.rating) embed.addFields({ name: "Rating", value: "⭐".repeat(payload.rating), inline: true });

  await channel.send({ embeds: [embed] }).catch(() => undefined);
};

/** Builds, stores and returns the transcript for a ticket channel. */
export const saveTranscript = async (
  guild: Guild,
  channel: TextChannel,
  ticket: { id: string; ticketNumber: number; categoryKey: string; openerTag: string; createdAt: Date },
  closedByTag: string,
  closeReason: string,
): Promise<{ id: string; html: string; messageCount: number } | null> => {
  try {
    const messages = await fetchAllMessages(channel);
    const participants = [...new Set(messages.map((m) => m.author.id))];
    const html = renderTranscript(messages, {
      guildName: guild.name,
      channelName: channel.name,
      ticketNumber: ticket.ticketNumber,
      category: ticket.categoryKey,
      openerTag: ticket.openerTag,
      closedByTag,
      closeReason,
      openedAt: ticket.createdAt,
      closedAt: new Date(),
      messageCount: messages.length,
      participants,
    });

    const row = await prisma.transcript.create({
      data: {
        guildId: guild.id,
        ticketId: ticket.id,
        channelId: channel.id,
        html,
        meta: {
          ticketNumber: ticket.ticketNumber,
          messageCount: messages.length,
          participants,
        } as never,
      },
      select: { id: true },
    });

    return { id: row.id, html, messageCount: messages.length };
  } catch (err) {
    log.error({ err, channelId: channel.id }, "failed to build transcript");
    return null;
  }
};

export const transcriptAttachment = (html: string, ticketNumber: number) =>
  new AttachmentBuilder(Buffer.from(html, "utf8"), { name: `ticket-${ticketNumber}-transcript.html` });

export const priorityRow = (ticketId: string) =>
  new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`ticket:setpriority:${ticketId}`)
      .setPlaceholder("Set the priority")
      .addOptions(
        TICKET_PRIORITIES.map((p) =>
          new StringSelectMenuOptionBuilder().setLabel(p).setValue(p).setEmoji(
            p === "URGENT" ? "🔴" : p === "HIGH" ? "🟠" : p === "NORMAL" ? "🟢" : "⚪",
          ),
        ),
      ),
  );
