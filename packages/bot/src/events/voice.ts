import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type VoiceState,
} from "discord.js";
import { COLORS } from "@bambot/shared";
import type { BotEvent } from "../core/types";
import type { BambotClient } from "../core/client";
import { prisma } from "../core/db";
import { childLogger } from "../core/logger";

const log = childLogger("tempvoice");

const controlRow = (channelId: string) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`tempvoice:rename:${channelId}`).setLabel("Rename").setEmoji("✏️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`tempvoice:lock:${channelId}`).setLabel("Lock").setEmoji("🔒").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`tempvoice:unlock:${channelId}`).setLabel("Unlock").setEmoji("🔓").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`tempvoice:limit:${channelId}`).setLabel("User limit").setEmoji("👥").setStyle(ButtonStyle.Secondary),
  );

const createRoom = async (client: BambotClient, state: VoiceState) => {
  const member = state.member;
  const guild = state.guild;
  if (!member || !state.channelId) return;

  const cfg = await client.config.get(guild.id, "tempvoice");
  if (!cfg.enabled || !cfg.hubChannelIds.includes(state.channelId)) return;
  if (cfg.blockedRoles.some((r) => member.roles.cache.has(r))) return;

  const owned = await prisma.tempVoice.count({ where: { guildId: guild.id, ownerId: member.id } });
  if (owned >= cfg.maxPerMember) {
    await member.voice.disconnect("Already owns the maximum number of rooms").catch(() => undefined);
    return;
  }

  const name = cfg.nameTemplate
    .replace(/\{user\.display\}/g, member.displayName)
    .replace(/\{user\}/g, member.user.username)
    .replace(/\{number\}/g, String(owned + 1))
    .slice(0, 100);

  const parent = cfg.parentCategoryId && guild.channels.cache.has(cfg.parentCategoryId)
    ? cfg.parentCategoryId
    : state.channel?.parentId ?? undefined;

  const channel = await guild.channels
    .create({
      name,
      type: ChannelType.GuildVoice,
      parent,
      userLimit: cfg.defaultUserLimit,
      permissionOverwrites: cfg.defaultLocked
        ? [
            { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.Connect] },
            { id: member.id, allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels] },
          ]
        : [{ id: member.id, allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels] }],
      reason: `Temp voice room for ${member.user.username}`,
    })
    .catch((err) => {
      log.debug({ err, guildId: guild.id }, "could not create temp voice channel");
      return null;
    });

  if (!channel) return;

  await prisma.tempVoice
    .create({ data: { guildId: guild.id, channelId: channel.id, ownerId: member.id, name, locked: cfg.defaultLocked } })
    .catch(() => undefined);

  await member.voice.setChannel(channel).catch(() => undefined);

  if (cfg.controlPanel) {
    await channel
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.brand)
            .setTitle("🎙️ Your room")
            .setDescription(`<@${member.id}> owns this channel. It disappears once everyone leaves.`),
        ],
        components: [controlRow(channel.id)],
      })
      .catch(() => undefined);
  }
};

const cleanupRoom = async (client: BambotClient, state: VoiceState) => {
  if (!state.channelId) return;
  const record = await prisma.tempVoice.findUnique({ where: { channelId: state.channelId } });
  if (!record) return;

  const channel = state.guild.channels.cache.get(state.channelId);
  if (!channel?.isVoiceBased()) {
    await prisma.tempVoice.delete({ where: { id: record.id } }).catch(() => undefined);
    return;
  }
  if (channel.members.size > 0) return;

  const cfg = await client.config.get(state.guild.id, "tempvoice");

  // Wait out the grace period, then re-check — people hop channels constantly.
  setTimeout(
    () => {
      void (async () => {
        const current = state.guild.channels.cache.get(record.channelId);
        if (!current?.isVoiceBased() || current.members.size > 0) return;
        await current.delete("Temp voice room empty").catch(() => undefined);
        await prisma.tempVoice.delete({ where: { id: record.id } }).catch(() => undefined);
      })();
    },
    Math.max(cfg.emptyGraceSeconds, 1) * 1000,
  ).unref();
};

export const voiceStateUpdate: BotEvent<"voiceStateUpdate"> = {
  name: "voiceStateUpdate",
  async execute(client, oldState, newState) {
    try {
      if (newState.channelId && newState.channelId !== oldState.channelId) {
        await createRoom(client, newState);
      }
      if (oldState.channelId && oldState.channelId !== newState.channelId) {
        await cleanupRoom(client, oldState);
      }
    } catch (err) {
      log.debug({ err }, "voice state handling failed");
    }
  },
};

export default voiceStateUpdate;
