import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Guild,
  type GuildMember,
} from "discord.js";
import { COLORS } from "@bambot/shared";
import type { BambotClient } from "../core/client";
import { prisma } from "../core/db";
import { childLogger } from "../core/logger";
import { clamp } from "../lib/embeds";

const log = childLogger("giveaways");

export interface GiveawayRequirements {
  minAccountAgeDays: number;
  minServerDays: number;
  minLevel: number;
  requiredRoles: string[];
  blockedRoles: string[];
}

export const entryRow = (giveawayId: string, label: string, ended = false) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway:enter:${giveawayId}`)
      .setLabel(ended ? "Ended" : label)
      .setEmoji("🎉")
      .setStyle(ButtonStyle.Success)
      .setDisabled(ended),
  );

export const buildGiveawayEmbed = (
  giveaway: { prize: string; description: string | null; winnerCount: number; hostId: string; endsAt: Date; imageUrl: string | null },
  entryCount: number,
  color: number,
  ended = false,
  winners: string[] = [],
) => {
  const embed = new EmbedBuilder()
    .setColor(ended ? COLORS.neutral : color)
    .setTitle(`🎉 ${clamp(giveaway.prize, 240)}`)
    .setTimestamp(giveaway.endsAt);

  const lines: string[] = [];
  if (giveaway.description) lines.push(giveaway.description, "");
  lines.push(
    ended
      ? `**Ended** <t:${Math.floor(giveaway.endsAt.getTime() / 1000)}:R>`
      : `**Ends** <t:${Math.floor(giveaway.endsAt.getTime() / 1000)}:R> (<t:${Math.floor(giveaway.endsAt.getTime() / 1000)}:F>)`,
    `**Winners** ${giveaway.winnerCount}`,
    `**Entries** ${entryCount}`,
    `**Hosted by** <@${giveaway.hostId}>`,
  );

  if (ended) {
    lines.push("", winners.length ? `**Won by** ${winners.map((w) => `<@${w}>`).join(", ")}` : "**No valid entries.**");
  }

  embed.setDescription(lines.join("\n"));
  if (giveaway.imageUrl) embed.setImage(giveaway.imageUrl);
  embed.setFooter({ text: ended ? "Giveaway ended" : "Press the button to enter" });
  return embed;
};

/** Checks a member against the giveaway's eligibility rules. */
export const checkEligibility = async (
  member: GuildMember,
  requirements: GiveawayRequirements,
): Promise<{ ok: boolean; reason?: string }> => {
  const now = Date.now();

  if (requirements.blockedRoles.some((r) => member.roles.cache.has(r))) {
    return { ok: false, reason: "You are not eligible for this giveaway." };
  }
  if (requirements.requiredRoles.length && !requirements.requiredRoles.some((r) => member.roles.cache.has(r))) {
    return { ok: false, reason: "You do not have the role needed to enter." };
  }

  const accountDays = (now - member.user.createdTimestamp) / 86_400_000;
  if (accountDays < requirements.minAccountAgeDays) {
    return { ok: false, reason: `Your account must be at least ${requirements.minAccountAgeDays} days old.` };
  }

  if (member.joinedTimestamp) {
    const serverDays = (now - member.joinedTimestamp) / 86_400_000;
    if (serverDays < requirements.minServerDays) {
      return { ok: false, reason: `You must have been in the server for ${requirements.minServerDays} day(s).` };
    }
  }

  if (requirements.minLevel > 0) {
    const level = await prisma.level.findUnique({
      where: { guildId_userId: { guildId: member.guild.id, userId: member.id } },
    });
    if ((level?.level ?? 0) < requirements.minLevel) {
      return { ok: false, reason: `You need to be level ${requirements.minLevel} to enter.` };
    }
  }

  return { ok: true };
};

/** How many entries a member gets, counting role bonuses. */
export const entriesFor = (member: GuildMember, bonuses: { roleId: string; entries: number }[]): number => {
  let entries = 1;
  for (const bonus of bonuses) {
    if (member.roles.cache.has(bonus.roleId)) entries = Math.max(entries, bonus.entries);
  }
  return entries;
};

/**
 * Picks winners with weighted entries.
 *
 * Builds a ticket pool rather than sorting by random weight: with bonus entries
 * the pool model is what people expect ("3 entries = 3 tickets"), and it makes
 * the odds explainable when someone asks in chat.
 */
export const drawWinners = (entries: { userId: string; entries: number }[], count: number): string[] => {
  const pool: string[] = [];
  for (const entry of entries) {
    for (let i = 0; i < Math.max(1, entry.entries); i += 1) pool.push(entry.userId);
  }

  const winners: string[] = [];
  while (winners.length < count && pool.length) {
    const index = Math.floor(Math.random() * pool.length);
    const winner = pool[index];
    winners.push(winner);
    // Remove every ticket belonging to that member so nobody wins twice.
    for (let i = pool.length - 1; i >= 0; i -= 1) {
      if (pool[i] === winner) pool.splice(i, 1);
    }
  }
  return winners;
};

export const endGiveaway = async (
  client: BambotClient,
  guild: Guild,
  giveawayId: string,
  reroll = false,
): Promise<{ ok: boolean; message: string; winners: string[] }> => {
  const giveaway = await prisma.giveaway.findUnique({ where: { id: giveawayId }, include: { entries: true } });
  if (!giveaway) return { ok: false, message: "That giveaway no longer exists.", winners: [] };
  if (giveaway.ended && !reroll) return { ok: false, message: "That giveaway has already ended.", winners: [] };

  const cfg = await client.config.get(guild.id, "giveaways");

  // Re-validate at draw time: people leave, lose roles, or get banned.
  const valid: { userId: string; entries: number }[] = [];
  for (const entry of giveaway.entries) {
    if (reroll && giveaway.winners.includes(entry.userId)) continue;
    const member = await guild.members.fetch(entry.userId).catch(() => null);
    if (!member) continue;
    const eligible = await checkEligibility(member, (giveaway.requirements as never) ?? cfg.defaultRequirements);
    if (eligible.ok) valid.push({ userId: entry.userId, entries: entry.entries });
  }

  const winners = drawWinners(valid, giveaway.winnerCount);

  await prisma.giveaway.update({
    where: { id: giveaway.id },
    data: { ended: true, winners: reroll ? [...giveaway.winners, ...winners] : winners },
  });

  const channel = guild.channels.cache.get(giveaway.channelId);
  if (channel?.isTextBased() && giveaway.messageId) {
    const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
    if (message?.editable) {
      await message
        .edit({
          embeds: [buildGiveawayEmbed(giveaway, giveaway.entries.length, COLORS.brand, true, winners)],
          components: [entryRow(giveaway.id, cfg.buttonLabel, true)],
        })
        .catch(() => undefined);
    }

    await channel
      .send({
        content: winners.length ? winners.map((w) => `<@${w}>`).join(" ") : undefined,
        embeds: [
          new EmbedBuilder()
            .setColor(winners.length ? COLORS.success : COLORS.neutral)
            .setTitle(winners.length ? "🎉 We have a winner!" : "No valid entries")
            .setDescription(
              winners.length
                ? `${winners.map((w) => `<@${w}>`).join(", ")} won **${giveaway.prize}**!${
                    cfg.claimHours > 0 ? `\n\nClaim within ${cfg.claimHours} hours or it will be rerolled.` : ""
                  }`
                : `Nobody eligible entered **${giveaway.prize}**.`,
            )
            .setURL(message?.url ?? null),
        ],
      })
      .catch(() => undefined);
  }

  if (cfg.dmWinners) {
    for (const winnerId of winners) {
      const user = await client.users.fetch(winnerId).catch(() => null);
      await user
        ?.send({
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.success)
              .setTitle("🎉 You won!")
              .setDescription(
                `You won **${giveaway.prize}** in **${guild.name}**.\n\nA member of staff will be in touch. Remember: staff will never ask for your password or a payment to release a prize.`,
              ),
          ],
        })
        .catch(() => undefined);
    }
  }

  log.info({ giveawayId, winners: winners.length }, "giveaway ended");
  return { ok: true, message: winners.length ? `Drew ${winners.length} winner(s).` : "No valid entries.", winners };
};
