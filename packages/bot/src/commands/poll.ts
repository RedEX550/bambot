import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { COLORS } from "@bambot/shared";
import type { BotCommand, ComponentHandler } from "../core/types";
import { prisma } from "../core/db";
import { errorEmbed, successEmbed, clamp } from "../lib/embeds";
import { parseDuration, timestamp } from "../lib/time";

const LETTERS = ["🇦", "🇧", "🇨", "🇩", "🇪", "🇫", "🇬", "🇭", "🇮", "🇯"];

interface PollOption {
  label: string;
}

const buildEmbed = (
  question: string,
  options: PollOption[],
  counts: number[],
  endsAt: Date | null,
  closed: boolean,
  authorTag: string,
) => {
  const total = counts.reduce((sum, n) => sum + n, 0);

  const lines = options.map((option, index) => {
    const count = counts[index] ?? 0;
    const percent = total ? Math.round((count / total) * 100) : 0;
    const filled = Math.round(percent / 5);
    return `${LETTERS[index]} **${option.label}**\n\`${"█".repeat(filled)}${"░".repeat(20 - filled)}\` ${percent}% · ${count} vote${count === 1 ? "" : "s"}`;
  });

  const embed = new EmbedBuilder()
    .setColor(closed ? COLORS.neutral : COLORS.brand)
    .setTitle(`📊 ${clamp(question, 240)}`)
    .setDescription(lines.join("\n\n"))
    .setFooter({ text: `${total} vote${total === 1 ? "" : "s"} • started by ${authorTag}${closed ? " • closed" : ""}` });

  if (endsAt && !closed) embed.addFields({ name: "Closes", value: timestamp(endsAt, "R") });

  return embed;
};

const buildRows = (pollId: string, options: PollOption[], closed: boolean) => {
  const buttons = options.map((option, index) =>
    new ButtonBuilder()
      .setCustomId(`poll:vote:${pollId}:${index}`)
      .setLabel(clamp(option.label, 80))
      .setEmoji(LETTERS[index])
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(closed),
  );

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
  }
  return rows;
};

export const pollCommand: BotCommand = {
  module: "content",
  cooldown: 10,
  data: new SlashCommandBuilder()
    .setName("poll")
    .setDescription("Run a quick poll with buttons")
    .addStringOption((o) => o.setName("question").setDescription("What are you asking?").setRequired(true).setMaxLength(240))
    .addStringOption((o) =>
      o.setName("options").setDescription("Separate choices with a | e.g. PLA | PETG | ABS").setRequired(true).setMaxLength(600),
    )
    .addStringOption((o) => o.setName("duration").setDescription("e.g. 1h, 3d — leave empty to keep it open"))
    .addBooleanOption((o) => o.setName("multi").setDescription("Let people pick more than one")),

  async execute(interaction) {
    const question = interaction.options.getString("question", true);
    const options = interaction.options
      .getString("options", true)
      .split("|")
      .map((part) => part.trim())
      .filter(Boolean)
      .slice(0, 10)
      .map((label) => ({ label: clamp(label, 80) }));

    if (options.length < 2) {
      await interaction.editReply({
        embeds: [errorEmbed("Give at least two choices, separated by `|`. For example: `PLA | PETG | ABS`")],
      });
      return;
    }

    const durationRaw = interaction.options.getString("duration");
    const durationMs = durationRaw ? parseDuration(durationRaw) : null;
    if (durationRaw && !durationMs) {
      await interaction.editReply({ embeds: [errorEmbed(`I could not read "${durationRaw}" as a duration.`)] });
      return;
    }
    const endsAt = durationMs ? new Date(Date.now() + durationMs) : null;

    // The message must exist before the poll row, because the row keys on it.
    const channel = interaction.channel;
    if (!channel?.isTextBased() || !("send" in channel)) {
      await interaction.editReply({ embeds: [errorEmbed("I cannot post a poll in this kind of channel.")] });
      return;
    }
    const message = await channel.send({ content: "Setting up the poll…" }).catch(() => null);
    if (!message) {
      await interaction.editReply({ embeds: [errorEmbed("I could not post in this channel.")] });
      return;
    }

    const poll = await prisma.poll.create({
      data: {
        guildId: interaction.guildId!,
        channelId: interaction.channelId,
        messageId: message.id,
        question,
        options: options as never,
        multi: interaction.options.getBoolean("multi") ?? false,
        authorId: interaction.user.id,
        endsAt,
      },
    });

    await message.edit({
      content: null,
      embeds: [buildEmbed(question, options, options.map(() => 0), endsAt, false, interaction.user.username)],
      components: buildRows(poll.id, options, false),
    });

    await interaction.editReply({ embeds: [successEmbed(`Poll posted.\n${message.url}`)] });
  },
};

export const pollHandler: ComponentHandler = {
  prefix: "poll",
  async execute(interaction, args) {
    if (!interaction.isMessageComponent()) return;
    const [action, pollId, choiceRaw] = args;
    if (action !== "vote") return;

    const poll = await prisma.poll.findUnique({ where: { id: pollId } });
    if (!poll || poll.closed) {
      await interaction.reply({ embeds: [errorEmbed("This poll is closed.")], flags: MessageFlags.Ephemeral });
      return;
    }
    if (poll.endsAt && poll.endsAt < new Date()) {
      await interaction.reply({ embeds: [errorEmbed("This poll has ended.")], flags: MessageFlags.Ephemeral });
      return;
    }

    const choice = Number(choiceRaw);
    const options = poll.options as unknown as PollOption[];
    if (!Number.isInteger(choice) || choice < 0 || choice >= options.length) return;

    const existing = await prisma.pollVote.findMany({ where: { pollId, userId: interaction.user.id } });
    const already = existing.find((vote) => vote.choice === choice);

    if (already) {
      await prisma.pollVote.delete({ where: { id: already.id } });
    } else {
      // Single-choice polls replace the previous answer rather than rejecting it.
      if (!poll.multi && existing.length) {
        await prisma.pollVote.deleteMany({ where: { pollId, userId: interaction.user.id } });
      }
      await prisma.pollVote.create({ data: { pollId, userId: interaction.user.id, choice } });
    }

    const votes = await prisma.pollVote.findMany({ where: { pollId } });
    const counts = options.map((_, index) => votes.filter((vote) => vote.choice === index).length);

    const author = await interaction.client.users.fetch(poll.authorId).catch(() => null);

    await interaction.update({
      embeds: [buildEmbed(poll.question, options, counts, poll.endsAt, false, author?.username ?? "staff")],
      components: buildRows(poll.id, options, false),
    });
  },
};

export default [pollCommand];
