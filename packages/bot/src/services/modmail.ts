import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Guild,
  type Message,
  type OverwriteResolvable,
  type TextChannel,
} from "discord.js";
import { COLORS, EMOJI } from "@bambot/shared";
import type { BambotClient } from "../core/client";
import { prisma } from "../core/db";
import { childLogger } from "../core/logger";
import { buildMessage } from "../lib/payload";
import { clamp } from "../lib/embeds";
import { canManageTicket } from "./ticket-actions";

const log = childLogger("modmail");

const cooldowns = new Map<string, number>();

/**
 * Picks which guild a DM belongs to.
 *
 * Most members share exactly one server with the bot, which is the easy case.
 * When they share several, the most recently active open thread wins, falling
 * back to the first guild that has modmail switched on.
 */
const resolveGuild = async (client: BambotClient, userId: string): Promise<Guild | null> => {
  const open = await prisma.modmailThread.findFirst({
    where: { userId, open: true },
    orderBy: { lastMessageAt: "desc" },
  });
  if (open) {
    const guild = client.guilds.cache.get(open.guildId);
    if (guild) return guild;
  }

  const shared: Guild[] = [];
  for (const guild of client.guilds.cache.values()) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) shared.push(guild);
  }

  for (const guild of shared) {
    const cfg = await client.config.get(guild.id, "modmail");
    if (cfg.enabled) return guild;
  }
  return null;
};

export const handleIncomingDm = async (client: BambotClient, message: Message) => {
  const guild = await resolveGuild(client, message.author.id);
  if (!guild) return;

  const cfg = await client.config.get(guild.id, "modmail");
  if (!cfg.enabled) return;
  if (cfg.blockedUsers.includes(message.author.id)) return;

  const member = await guild.members.fetch(message.author.id).catch(() => null);
  if (!member) return;

  if (cfg.minServerMinutes > 0 && member.joinedTimestamp) {
    const minutes = (Date.now() - member.joinedTimestamp) / 60_000;
    if (minutes < cfg.minServerMinutes) {
      await message.reply(`You need to have been in **${guild.name}** for ${cfg.minServerMinutes} minutes before using modmail.`).catch(() => undefined);
      return;
    }
  }

  const now = Date.now();
  const cooldownKey = `${guild.id}:${message.author.id}`;
  if ((cooldowns.get(cooldownKey) ?? 0) > now) return;
  cooldowns.set(cooldownKey, now + cfg.cooldownSeconds * 1000);

  let thread = await prisma.modmailThread.findFirst({
    where: { guildId: guild.id, userId: message.author.id, open: true },
  });

  let channel = thread ? (guild.channels.cache.get(thread.channelId) as TextChannel | undefined) : undefined;

  // The channel may have been deleted by hand; reopen rather than fail.
  if (thread && !channel) {
    await prisma.modmailThread.update({ where: { id: thread.id }, data: { open: false, closedAt: new Date() } });
    thread = null;
  }

  if (!thread) {
    const overwrites: OverwriteResolvable[] = [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }];
    const me = guild.members.me;
    if (me) {
      overwrites.push({
        id: me.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels],
      });
    }
    const core = await client.config.get(guild.id, "core");
    for (const roleId of [...cfg.staffRoles, ...core.staffRoles, ...core.modRoles]) {
      if (guild.roles.cache.has(roleId)) {
        overwrites.push({
          id: roleId,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        });
      }
    }

    const created = await guild.channels
      .create({
        name: `dm-${message.author.username}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 90),
        type: ChannelType.GuildText,
        parent: cfg.categoryId && guild.channels.cache.has(cfg.categoryId) ? cfg.categoryId : undefined,
        permissionOverwrites: overwrites,
        topic: `Modmail with ${message.author.username} (${message.author.id})`,
      })
      .catch((err) => {
        log.error({ err, guildId: guild.id }, "could not create modmail channel");
        return null;
      });

    if (!created) return;
    channel = created as TextChannel;

    thread = await prisma.modmailThread.create({
      data: {
        guildId: guild.id,
        userId: message.author.id,
        userTag: message.author.username,
        channelId: channel.id,
      },
    });

    const intro = new EmbedBuilder()
      .setColor(COLORS.brand)
      .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL({ size: 64 }) })
      .setTitle("New modmail thread")
      .addFields(
        { name: "Member", value: `<@${message.author.id}>`, inline: true },
        { name: "Account created", value: `<t:${Math.floor(message.author.createdTimestamp / 1000)}:R>`, inline: true },
        {
          name: "Joined server",
          value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : "unknown",
          inline: true,
        },
      )
      .setFooter({ text: "Reply with /reply — or use /close to end the thread" });

    await channel
      .send({ content: cfg.pingRoles.map((r) => `<@&${r}>`).join(" ") || undefined, embeds: [intro] })
      .catch(() => undefined);

    const greeting = buildMessage(cfg.greeting, { member, user: message.author, guild });
    await message.author.send({ content: greeting.content, embeds: greeting.embeds }).catch(() => undefined);
  }

  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL({ size: 64 }) })
    .setDescription(clamp(message.content || "*(no text)*", 4000))
    .setTimestamp(message.createdAt);

  const attachments = [...message.attachments.values()];
  if (attachments.length) {
    embed.addFields({
      name: "Attachments",
      value: attachments.map((a) => `[${a.name}](${a.url})`).join("\n").slice(0, 1024),
    });
    const image = attachments.find((a) => a.contentType?.startsWith("image/"));
    if (image) embed.setImage(image.url);
  }

  await channel.send({ embeds: [embed] }).catch(() => undefined);
  await prisma.modmailThread.update({ where: { id: thread.id }, data: { lastMessageAt: new Date() } }).catch(() => undefined);
  await message.react(EMOJI.success).catch(() => undefined);
};

/** Sends a staff reply back to the member. */
export const sendModmailReply = async (
  client: BambotClient,
  guild: Guild,
  channelId: string,
  staffTag: string,
  content: string,
): Promise<{ ok: boolean; message: string }> => {
  const thread = await prisma.modmailThread.findUnique({ where: { channelId } });
  if (!thread?.open) return { ok: false, message: "This channel is not an open modmail thread." };

  const cfg = await client.config.get(guild.id, "modmail");
  const user = await client.users.fetch(thread.userId).catch(() => null);
  if (!user) return { ok: false, message: "I can no longer reach that member." };

  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setAuthor({ name: cfg.anonymousStaff ? `${guild.name} staff` : staffTag, iconURL: guild.iconURL({ size: 64 }) ?? undefined })
    .setDescription(clamp(content, 4000))
    .setTimestamp(new Date());

  const sent = await user.send({ embeds: [embed] }).catch(() => null);
  if (!sent) return { ok: false, message: "Their DMs are closed, so the reply could not be delivered." };

  await prisma.modmailThread.update({ where: { id: thread.id }, data: { lastMessageAt: new Date() } }).catch(() => undefined);
  return { ok: true, message: "Reply sent." };
};

export const closeModmailThread = async (
  client: BambotClient,
  guild: Guild,
  channelId: string,
  closedById: string,
  reason: string,
): Promise<{ ok: boolean; message: string }> => {
  const thread = await prisma.modmailThread.findUnique({ where: { channelId } });
  if (!thread?.open) return { ok: false, message: "This channel is not an open modmail thread." };

  const cfg = await client.config.get(guild.id, "modmail");

  await prisma.modmailThread.update({
    where: { id: thread.id },
    data: { open: false, closedAt: new Date(), closedById, closeReason: reason },
  });

  const user = await client.users.fetch(thread.userId).catch(() => null);
  await user
    ?.send({ embeds: [new EmbedBuilder().setColor(COLORS.neutral).setDescription(cfg.closingMessage)] })
    .catch(() => undefined);

  const channel = guild.channels.cache.get(channelId);
  if (channel?.isTextBased() && "delete" in channel) {
    setTimeout(() => void channel.delete("Modmail thread closed").catch(() => undefined), 10_000).unref();
  }

  return { ok: true, message: "Thread closed. The channel will be removed shortly." };
};

/**
 * Records the first staff reply in a ticket so the SLA report is meaningful.
 * Cheap: one indexed lookup per message, and only inside ticket channels.
 */
export const trackTicketActivity = async (client: BambotClient, message: Message<true>) => {
  const ticket = await prisma.ticket.findUnique({ where: { channelId: message.channelId } });
  if (!ticket || ticket.status === "CLOSED") return;

  const updates: Record<string, unknown> = { messageCount: { increment: 1 } };

  if (!ticket.firstResponseAt && message.author.id !== ticket.openerId) {
    const isStaff = await canManageTicket(message.guild, message.author.id, ticket.categoryKey);
    if (isStaff) updates.firstResponseAt = new Date();
  }

  await prisma.ticket.update({ where: { id: ticket.id }, data: updates as never }).catch(() => undefined);
};
