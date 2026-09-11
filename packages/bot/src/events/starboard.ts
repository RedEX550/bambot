import { EmbedBuilder, type MessageReaction, type PartialMessageReaction, type PartialUser, type User } from "discord.js";
import { COLORS } from "@bambot/shared";
import type { BotEvent } from "../core/types";
import type { BambotClient } from "../core/client";
import { prisma } from "../core/db";
import { childLogger } from "../core/logger";
import { clamp } from "../lib/embeds";

const log = childLogger("starboard");

const emojiMatches = (reaction: MessageReaction | PartialMessageReaction, configured: string): boolean => {
  const name = reaction.emoji.name ?? "";
  const id = reaction.emoji.id;
  if (id && configured.includes(id)) return true;
  return name === configured || configured.includes(name);
};

/**
 * Recomputes a starboard entry from the current reaction count.
 *
 * Driven by the live count rather than an internal tally, so removing and
 * re-adding a star cannot drift the number, and a restart does not lose state.
 */
const sync = async (client: BambotClient, reaction: MessageReaction | PartialMessageReaction) => {
  if (reaction.partial) {
    const full = await reaction.fetch().catch(() => null);
    if (!full) return;
    reaction = full;
  }

  const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
  if (!message?.guild) return;

  const cfg = await client.config.get(message.guild.id, "starboard");
  if (!cfg.enabled || !cfg.channelId) return;
  if (!emojiMatches(reaction, cfg.emoji)) return;
  if (cfg.ignoredChannels.includes(message.channelId)) return;
  if (message.channelId === cfg.channelId) return;
  if (!cfg.allowBotMessages && message.author?.bot) return;
  if (!cfg.nsfwAllowed && "nsfw" in message.channel && message.channel.nsfw) return;

  // Count only the stars that actually qualify.
  let count = reaction.count ?? 0;
  if (!cfg.allowSelfStar || cfg.requiredRoles.length) {
    const users = await reaction.users.fetch().catch(() => null);
    if (users) {
      count = 0;
      for (const user of users.values()) {
        if (user.bot) continue;
        if (!cfg.allowSelfStar && user.id === message.author?.id) continue;
        if (cfg.requiredRoles.length) {
          const member = await message.guild.members.fetch(user.id).catch(() => null);
          if (!member || !cfg.requiredRoles.some((r) => member.roles.cache.has(r))) continue;
        }
        count += 1;
      }
    }
  }

  const starChannel = message.guild.channels.cache.get(cfg.channelId);
  if (!starChannel?.isTextBased()) return;

  const existing = await prisma.starboardEntry.findUnique({
    where: { guildId_sourceMessageId: { guildId: message.guild.id, sourceMessageId: message.id } },
  });

  if (count < cfg.threshold) {
    if (existing?.starMessageId && cfg.removeWhenUnstarred) {
      const post = await starChannel.messages.fetch(existing.starMessageId).catch(() => null);
      await post?.delete().catch(() => undefined);
      await prisma.starboardEntry.delete({ where: { id: existing.id } }).catch(() => undefined);
    }
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(cfg.color ? Number.parseInt(cfg.color.replace("#", ""), 16) : COLORS.star)
    .setAuthor({
      name: message.author?.username ?? "Unknown",
      iconURL: message.author?.displayAvatarURL({ size: 64 }),
    })
    .setTimestamp(message.createdAt)
    .addFields({ name: "Source", value: `[Jump to message](${message.url}) in <#${message.channelId}>` });

  if (message.content) embed.setDescription(clamp(message.content, 2000));

  const image = message.attachments.find((a) => a.contentType?.startsWith("image/"));
  if (image) embed.setImage(image.url);
  else if (message.embeds[0]?.image) embed.setImage(message.embeds[0].image.url);

  const content = cfg.showCount ? `${cfg.emoji} **${count}** in <#${message.channelId}>` : `<#${message.channelId}>`;

  try {
    if (existing?.starMessageId) {
      const post = await starChannel.messages.fetch(existing.starMessageId).catch(() => null);
      if (post?.editable) {
        await post.edit({ content, embeds: [embed] });
        await prisma.starboardEntry.update({ where: { id: existing.id }, data: { count } });
        return;
      }
    }

    const sent = await starChannel.send({ content, embeds: [embed] });
    await prisma.starboardEntry.upsert({
      where: { guildId_sourceMessageId: { guildId: message.guild.id, sourceMessageId: message.id } },
      create: {
        guildId: message.guild.id,
        sourceMessageId: message.id,
        sourceChannelId: message.channelId,
        starMessageId: sent.id,
        authorId: message.author?.id ?? "0",
        count,
      },
      update: { starMessageId: sent.id, count },
    });
  } catch (err) {
    log.debug({ err }, "starboard sync failed");
  }
};

export const reactionAdd: BotEvent<"messageReactionAdd"> = {
  name: "messageReactionAdd",
  async execute(client, reaction, user: User | PartialUser) {
    if (user.bot) return;
    await sync(client, reaction);
  },
};

export const reactionRemove: BotEvent<"messageReactionRemove"> = {
  name: "messageReactionRemove",
  async execute(client, reaction, user: User | PartialUser) {
    if (user.bot) return;
    await sync(client, reaction);
  },
};

export default [reactionAdd, reactionRemove];
