import { EmbedBuilder, type MessageReaction, type PartialMessageReaction, type PartialUser, type User } from "discord.js";
import { COLORS } from "@bambot/shared";
import type { BotEvent } from "../core/types";
import type { BambotClient } from "../core/client";
import { prisma } from "../core/db";
import { childLogger } from "../core/logger";
import { clamp } from "../lib/embeds";

const log = childLogger("suggestions");

const matches = (reaction: MessageReaction | PartialMessageReaction, configured: string): boolean => {
  const name = reaction.emoji.name ?? "";
  const id = reaction.emoji.id;
  if (id && configured.includes(id)) return true;
  return name === configured || configured.includes(name);
};

/**
 * Recounts a suggestion's votes from the live reactions.
 *
 * Counting from the message rather than tracking increments means the number
 * stays correct across restarts and after Discord drops a reaction event, which
 * it occasionally does under load.
 */
const recount = async (client: BambotClient, reaction: MessageReaction | PartialMessageReaction) => {
  if (reaction.partial) {
    const full = await reaction.fetch().catch(() => null);
    if (!full) return;
    reaction = full;
  }

  const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
  if (!message?.guild) return;

  const suggestion = await prisma.suggestion.findFirst({
    where: { guildId: message.guild.id, messageId: message.id },
  });
  if (!suggestion || suggestion.status !== "PENDING") return;

  const cfg = await client.config.get(message.guild.id, "suggestions");
  if (!cfg.enabled) return;
  if (!matches(reaction, cfg.upvoteEmoji) && !matches(reaction, cfg.downvoteEmoji)) return;

  const up = message.reactions.cache.find((r) => matches(r, cfg.upvoteEmoji));
  const down = message.reactions.cache.find((r) => matches(r, cfg.downvoteEmoji));

  // Discord counts the bot's own seed reaction; subtract it.
  const upvotes = Math.max((up?.count ?? 1) - 1, 0);
  const downvotes = Math.max((down?.count ?? 1) - 1, 0);

  if (upvotes === suggestion.upvotes && downvotes === suggestion.downvotes) return;

  await prisma.suggestion
    .update({ where: { id: suggestion.id }, data: { upvotes, downvotes } })
    .catch((err) => log.debug({ err }, "vote update failed"));

  const score = upvotes - downvotes;

  if (cfg.autoDenyScore < 0 && score <= cfg.autoDenyScore) {
    await prisma.suggestion.update({
      where: { id: suggestion.id },
      data: { status: "DENIED", staffNote: `Automatically denied at a score of ${score}.`, handledAt: new Date() },
    });

    const embed = EmbedBuilder.from(message.embeds[0] ?? new EmbedBuilder().toJSON())
      .setColor(COLORS.danger)
      .setFooter({ text: `Automatically denied • score ${score}` });

    await message.edit({ embeds: [embed] }).catch(() => undefined);
    await message.reactions.removeAll().catch(() => undefined);

    if (cfg.dmOnStatusChange) {
      const author = await client.users.fetch(suggestion.authorId).catch(() => null);
      await author
        ?.send({
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.neutral)
              .setTitle(`Suggestion #${suggestion.number} was denied`)
              .setDescription(clamp(suggestion.content, 1000))
              .setFooter({ text: `${message.guild.name} • community vote` }),
          ],
        })
        .catch(() => undefined);
    }
  }
};

export const suggestionReactionAdd: BotEvent<"messageReactionAdd"> = {
  name: "messageReactionAdd",
  async execute(client, reaction, user: User | PartialUser) {
    if (user.bot) return;
    await recount(client, reaction);
  },
};

export const suggestionReactionRemove: BotEvent<"messageReactionRemove"> = {
  name: "messageReactionRemove",
  async execute(client, reaction, user: User | PartialUser) {
    if (user.bot) return;
    await recount(client, reaction);
  },
};

export default [suggestionReactionAdd, suggestionReactionRemove];
