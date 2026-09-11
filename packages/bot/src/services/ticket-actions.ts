import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  type Guild,
  type TextChannel,
} from "discord.js";
import type { BotActionResult } from "@bambot/shared";
import { COLORS, EMOJI } from "@bambot/shared";
import type { BambotClient } from "../core/client";
import { prisma } from "../core/db";
import { config } from "../core/config";
import { childLogger } from "../core/logger";
import { bumpDailyStat } from "../lib/stats";
import { clamp } from "../lib/embeds";
import { findCategory, logTicketEvent, saveTranscript, transcriptAttachment } from "./tickets";

const log = childLogger("ticket-actions");

export interface Actor {
  id: string;
  tag: string;
}

/**
 * Closes a ticket: writes the transcript, notifies everyone who needs it, then
 * either archives or deletes the channel.
 *
 * Ordering matters — the transcript is captured before the channel is touched,
 * and a transcript failure never blocks the close, because a stuck open ticket
 * is worse than a missing archive.
 */
export const closeTicketByChannel = async (
  client: BambotClient,
  guild: Guild,
  channelId: string,
  actor: Actor,
  reason: string,
): Promise<BotActionResult> => {
  const ticket = await prisma.ticket.findUnique({ where: { channelId } });
  if (!ticket) return { ok: false, message: "That channel is not a ticket." };
  if (ticket.status === "CLOSED") return { ok: false, message: "That ticket is already closed." };

  const cfg = await config.get(guild.id, "tickets");
  const channel = guild.channels.cache.get(channelId) as TextChannel | undefined;

  let transcriptId: string | null = null;
  let transcriptHtml: string | null = null;

  if (channel && cfg.saveTranscripts) {
    const result = await saveTranscript(guild, channel, ticket, actor.tag, reason);
    if (result) {
      transcriptId = result.id;
      transcriptHtml = result.html;
      await prisma.ticket.update({ where: { id: ticket.id }, data: { messageCount: result.messageCount } }).catch(() => undefined);
    }
  }

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      closedById: actor.id,
      closedByTag: actor.tag,
      closeReason: reason,
      transcriptId,
    },
  });

  bumpDailyStat(guild.id, "ticketsClosed");

  const category = findCategory(cfg, ticket.categoryKey);
  const summary = new EmbedBuilder()
    .setColor(COLORS.neutral)
    .setTitle(`${EMOJI.lock} Ticket #${ticket.ticketNumber} closed`)
    .addFields(
      { name: "Opened by", value: `<@${ticket.openerId}>`, inline: true },
      { name: "Closed by", value: `<@${actor.id}>`, inline: true },
      { name: "Category", value: category?.label ?? ticket.categoryKey, inline: true },
      { name: "Reason", value: clamp(reason || "No reason given", 1024) },
    )
    .setTimestamp(new Date());

  // Archive copy for staff.
  if (cfg.transcriptChannelId && transcriptHtml) {
    const archive = guild.channels.cache.get(cfg.transcriptChannelId);
    if (archive?.isTextBased()) {
      await archive
        .send({ embeds: [summary], files: [transcriptAttachment(transcriptHtml, ticket.ticketNumber)] })
        .catch((err) => log.debug({ err }, "could not post transcript to archive"));
    }
  }

  // Copy plus a rating prompt for the person who opened it.
  if (cfg.dmTranscriptToOpener || cfg.ratingsEnabled) {
    const opener = await client.users.fetch(ticket.openerId).catch(() => null);
    if (opener) {
      const components: ActionRowBuilder<ButtonBuilder>[] = [];
      if (cfg.ratingsEnabled) {
        components.push(
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            [1, 2, 3, 4, 5].map((stars) =>
              new ButtonBuilder()
                .setCustomId(`ticket:rate:${ticket.id}:${stars}`)
                .setLabel("⭐".repeat(stars))
                .setStyle(stars >= 4 ? ButtonStyle.Success : ButtonStyle.Secondary),
            ),
          ),
        );
      }
      await opener
        .send({
          embeds: [
            summary,
            ...(cfg.ratingsEnabled
              ? [new EmbedBuilder().setColor(COLORS.star).setDescription("How did we do? Your rating helps the support team improve.")]
              : []),
          ],
          files: cfg.dmTranscriptToOpener && transcriptHtml ? [transcriptAttachment(transcriptHtml, ticket.ticketNumber)] : [],
          components,
        })
        .catch(() => {
          // Closed DMs are normal; nothing to do about it.
        });
    }
  }

  await logTicketEvent(client, guild, "closed", {
    ticketNumber: ticket.ticketNumber,
    channelId,
    categoryLabel: category?.label,
    actorTag: actor.tag,
    actorId: actor.id,
    reason,
  });

  if (channel) {
    // Lock it immediately so nobody keeps typing into a closed ticket.
    await channel.permissionOverwrites
      .edit(ticket.openerId, { SendMessages: false })
      .catch(() => undefined);

    if (cfg.deleteChannelAfterCloseMinutes === 0) {
      if (cfg.closedCategoryId && guild.channels.cache.has(cfg.closedCategoryId)) {
        await channel.setParent(cfg.closedCategoryId, { lockPermissions: false }).catch(() => undefined);
      }
      await channel.send({ embeds: [summary] }).catch(() => undefined);
    } else {
      const minutes = cfg.deleteChannelAfterCloseMinutes;
      await channel
        .send({
          embeds: [
            summary,
            new EmbedBuilder()
              .setColor(COLORS.warning)
              .setDescription(`This channel will be deleted in ${minutes} minute(s).`),
          ],
        })
        .catch(() => undefined);

      // Short waits are handled in-process; longer ones are picked up by the
      // ticket sweeper task, so a restart cannot strand the channel.
      if (minutes <= 15) {
        setTimeout(
          () => {
            void channel.delete(`Ticket #${ticket.ticketNumber} closed`).catch(() => undefined);
          },
          minutes * 60_000,
        ).unref();
      }
    }
  }

  return { ok: true, message: `Ticket #${ticket.ticketNumber} closed.` };
};

export const claimTicket = async (
  client: BambotClient,
  guild: Guild,
  channelId: string,
  actor: Actor,
): Promise<BotActionResult> => {
  const ticket = await prisma.ticket.findUnique({ where: { channelId } });
  if (!ticket) return { ok: false, message: "That channel is not a ticket." };
  if (ticket.status === "CLOSED") return { ok: false, message: "That ticket is closed." };
  if (ticket.claimedById && ticket.claimedById !== actor.id) {
    return { ok: false, message: `Already claimed by <@${ticket.claimedById}>.` };
  }

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { claimedById: actor.id, claimedByTag: actor.tag, claimedAt: new Date(), status: "CLAIMED" },
  });

  const cfg = await config.get(guild.id, "tickets");
  const channel = guild.channels.cache.get(channelId) as TextChannel | undefined;

  if (channel && cfg.claimRequiredToReply) {
    // Narrow write access to the claimer so two staff do not talk over each other.
    const category = findCategory(cfg, ticket.categoryKey);
    const supportRoles = category?.supportRoles.length ? category.supportRoles : (await config.get(guild.id, "core")).staffRoles;
    for (const roleId of supportRoles) {
      await channel.permissionOverwrites.edit(roleId, { SendMessages: false }).catch(() => undefined);
    }
    await channel.permissionOverwrites
      .edit(actor.id, { SendMessages: true, ViewChannel: true, ManageMessages: true })
      .catch(() => undefined);
  }

  await logTicketEvent(client, guild, "claimed", {
    ticketNumber: ticket.ticketNumber,
    channelId,
    actorTag: actor.tag,
    actorId: actor.id,
  });

  return { ok: true, message: `Ticket #${ticket.ticketNumber} claimed by <@${actor.id}>.` };
};

export const addUserToTicket = async (guild: Guild, channelId: string, userId: string): Promise<BotActionResult> => {
  const ticket = await prisma.ticket.findUnique({ where: { channelId } });
  if (!ticket) return { ok: false, message: "That channel is not a ticket." };

  const channel = guild.channels.cache.get(channelId) as TextChannel | undefined;
  if (!channel) return { ok: false, message: "That channel no longer exists." };

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return { ok: false, message: "That member is not in this server." };

  await channel.permissionOverwrites.edit(member.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true,
  });

  if (!ticket.participants.includes(userId)) {
    await prisma.ticket.update({ where: { id: ticket.id }, data: { participants: { push: userId } } });
  }

  await channel.send({ content: `${EMOJI.success} <@${userId}> was added to this ticket.` }).catch(() => undefined);
  return { ok: true, message: `Added <@${userId}>.` };
};

export const removeUserFromTicket = async (guild: Guild, channelId: string, userId: string): Promise<BotActionResult> => {
  const ticket = await prisma.ticket.findUnique({ where: { channelId } });
  if (!ticket) return { ok: false, message: "That channel is not a ticket." };
  if (ticket.openerId === userId) return { ok: false, message: "You cannot remove the person who opened the ticket." };

  const channel = guild.channels.cache.get(channelId) as TextChannel | undefined;
  if (!channel) return { ok: false, message: "That channel no longer exists." };

  await channel.permissionOverwrites.delete(userId).catch(() => undefined);
  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { participants: ticket.participants.filter((p) => p !== userId) },
  });

  return { ok: true, message: `Removed <@${userId}>.` };
};

export const setTicketPriority = async (guild: Guild, channelId: string, priority: string): Promise<BotActionResult> => {
  const ticket = await prisma.ticket.findUnique({ where: { channelId } });
  if (!ticket) return { ok: false, message: "That channel is not a ticket." };

  await prisma.ticket.update({ where: { id: ticket.id }, data: { priority } });

  const channel = guild.channels.cache.get(channelId) as TextChannel | undefined;
  if (channel && channel.manageable) {
    const marker = priority === "URGENT" ? "🔴" : priority === "HIGH" ? "🟠" : "";
    const base = channel.name.replace(/^[🔴🟠]-?/u, "");
    await channel.setName(marker ? `${marker}-${base}`.slice(0, 100) : base).catch(() => undefined);
  }

  return { ok: true, message: `Priority set to **${priority}**.` };
};

/** True when the member may act on staff-only ticket controls. */
export const canManageTicket = async (guild: Guild, memberId: string, ticketCategoryKey: string): Promise<boolean> => {
  const member = await guild.members.fetch(memberId).catch(() => null);
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;

  const cfg = await config.get(guild.id, "tickets");
  const core = await config.get(guild.id, "core");
  const category = findCategory(cfg, ticketCategoryKey);
  const roles = [...(category?.supportRoles ?? []), ...core.staffRoles, ...core.modRoles, ...core.adminRoles];
  return roles.some((roleId) => member.roles.cache.has(roleId));
};
