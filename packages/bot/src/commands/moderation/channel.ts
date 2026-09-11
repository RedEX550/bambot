import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type GuildTextBasedChannel,
  type Message,
} from "discord.js";
import { COLORS, EMOJI } from "@bambot/shared";
import type { BotCommand } from "../../core/types";
import { errorEmbed, successEmbed } from "../../lib/embeds";
import { parseDuration, formatDuration } from "../../lib/time";
import { createCase } from "../../services/moderation";

/** Discord refuses to bulk-delete anything older than 14 days. */
const TWO_WEEKS = 14 * 86_400_000;

export const purgeCommand: BotCommand = {
  permission: "mod",
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Bulk delete recent messages, with optional filters")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((o) =>
      o.setName("amount").setDescription("How many messages to scan").setRequired(true).setMinValue(1).setMaxValue(1000),
    )
    .addUserOption((o) => o.setName("user").setDescription("Only delete messages from this member"))
    .addStringOption((o) => o.setName("contains").setDescription("Only delete messages containing this text").setMaxLength(100))
    .addBooleanOption((o) => o.setName("bots").setDescription("Only delete bot messages"))
    .addBooleanOption((o) => o.setName("attachments").setDescription("Only delete messages with attachments"))
    .addStringOption((o) => o.setName("reason").setDescription("Recorded in the mod log").setMaxLength(500)),

  async execute(interaction, client) {
    const channel = interaction.channel;
    if (!channel || !("bulkDelete" in channel)) {
      await interaction.editReply({ embeds: [errorEmbed("I cannot purge messages in this kind of channel.")] });
      return;
    }

    const cfg = await client.config.get(interaction.guildId!, "moderation");
    const requested = interaction.options.getInteger("amount", true);
    const amount = Math.min(requested, cfg.purgeMaxMessages);

    const user = interaction.options.getUser("user");
    const contains = interaction.options.getString("contains")?.toLowerCase();
    const botsOnly = interaction.options.getBoolean("bots");
    const attachmentsOnly = interaction.options.getBoolean("attachments");
    const reason = interaction.options.getString("reason")?.trim() || "No reason provided";

    const fetched = await channel.messages.fetch({ limit: Math.min(amount, 100) }).catch(() => null);
    if (!fetched) {
      await interaction.editReply({ embeds: [errorEmbed("I could not read the recent messages here.")] });
      return;
    }

    const cutoff = Date.now() - TWO_WEEKS;
    const targets = [...fetched.values()].filter((message: Message) => {
      if (message.createdTimestamp < cutoff) return false;
      if (message.pinned) return false;
      if (user && message.author.id !== user.id) return false;
      if (botsOnly && !message.author.bot) return false;
      if (attachmentsOnly && message.attachments.size === 0) return false;
      if (contains && !message.content.toLowerCase().includes(contains)) return false;
      return true;
    });

    if (!targets.length) {
      await interaction.editReply({
        embeds: [errorEmbed("Nothing matched. Note that pinned messages and anything older than 14 days are skipped.")],
      });
      return;
    }

    const deleted = await (channel as GuildTextBasedChannel).bulkDelete(targets, true).catch(() => null);
    if (!deleted) {
      await interaction.editReply({ embeds: [errorEmbed("The delete failed. Check that I have Manage Messages here.")] });
      return;
    }

    await createCase(client, {
      guild: interaction.guild!,
      type: "PURGE",
      target: user ?? { id: interaction.channelId, tag: `#${"name" in channel ? channel.name : "channel"}` },
      moderator: interaction.user,
      reason: `${reason} (${deleted.size} messages)`,
      silent: true,
    });

    await interaction.editReply({
      embeds: [successEmbed(`Deleted **${deleted.size}** message(s).${deleted.size < targets.length ? " Some were too old to bulk delete." : ""}`)],
    });
  },
};

export const slowmodeCommand: BotCommand = {
  permission: "mod",
  data: new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Set the slowmode delay for a channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption((o) => o.setName("duration").setDescription("e.g. 10s, 5m, or 0 to turn it off").setRequired(true))
    .addChannelOption((o) =>
      o.setName("channel").setDescription("Defaults to this channel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildForum),
    ),

  async execute(interaction) {
    const raw = interaction.options.getString("duration", true);
    const target = (interaction.options.getChannel("channel") ?? interaction.channel) as GuildTextBasedChannel | null;

    if (!target || !("setRateLimitPerUser" in target)) {
      await interaction.editReply({ embeds: [errorEmbed("That channel does not support slowmode.")] });
      return;
    }

    const ms = raw === "0" ? 0 : parseDuration(raw);
    if (ms === null) {
      await interaction.editReply({ embeds: [errorEmbed(`I could not read "${raw}". Try \`10s\`, \`5m\` or \`0\`.`)] });
      return;
    }

    const seconds = Math.floor(ms / 1000);
    if (seconds > 21600) {
      await interaction.editReply({ embeds: [errorEmbed("Discord caps slowmode at 6 hours.")] });
      return;
    }

    await target.setRateLimitPerUser(seconds, `Set by ${interaction.user.username}`);
    await interaction.editReply({
      embeds: [
        successEmbed(
          seconds === 0 ? `Slowmode off in <#${target.id}>.` : `Slowmode in <#${target.id}> set to **${formatDuration(ms)}**.`,
        ),
      ],
    });
  },
};

export const lockCommand: BotCommand = {
  permission: "mod",
  data: new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Stop everyone from sending messages in a channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption((o) => o.setName("channel").setDescription("Defaults to this channel").addChannelTypes(ChannelType.GuildText))
    .addStringOption((o) => o.setName("reason").setDescription("Shown in the channel").setMaxLength(400)),

  async execute(interaction) {
    const guild = interaction.guild!;
    const target = (interaction.options.getChannel("channel") ?? interaction.channel) as GuildTextBasedChannel | null;
    if (!target || target.isDMBased() || !("permissionOverwrites" in target)) {
      await interaction.editReply({ embeds: [errorEmbed("Pick a normal text channel — threads inherit their parent permissions.")] });
      return;
    }
    const reason = interaction.options.getString("reason");

    await target.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }, { reason: `Locked by ${interaction.user.username}` });

    await target
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.warning)
            .setTitle(`${EMOJI.lock} Channel locked`)
            .setDescription(reason ?? "A moderator has locked this channel."),
        ],
      })
      .catch(() => undefined);

    await interaction.editReply({ embeds: [successEmbed(`<#${target.id}> is locked.`)] });
  },
};

export const unlockCommand: BotCommand = {
  permission: "mod",
  data: new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Re-open a locked channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption((o) => o.setName("channel").setDescription("Defaults to this channel").addChannelTypes(ChannelType.GuildText)),

  async execute(interaction) {
    const guild = interaction.guild!;
    const target = (interaction.options.getChannel("channel") ?? interaction.channel) as GuildTextBasedChannel | null;
    if (!target || target.isDMBased() || !("permissionOverwrites" in target)) {
      await interaction.editReply({ embeds: [errorEmbed("Pick a normal text channel — threads inherit their parent permissions.")] });
      return;
    }

    await target.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null }, { reason: `Unlocked by ${interaction.user.username}` });

    await target
      .send({
        embeds: [new EmbedBuilder().setColor(COLORS.success).setTitle(`${EMOJI.unlock} Channel unlocked`)],
      })
      .catch(() => undefined);

    await interaction.editReply({ embeds: [successEmbed(`<#${target.id}> is open again.`)] });
  },
};

export const lockdownCommand: BotCommand = {
  permission: "admin",
  data: new SlashCommandBuilder()
    .setName("lockdown")
    .setDescription("Lock or unlock every channel at once — for raids")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o
        .setName("state")
        .setDescription("on or off")
        .setRequired(true)
        .addChoices({ name: "on", value: "on" }, { name: "off", value: "off" }),
    )
    .addStringOption((o) => o.setName("reason").setDescription("Shown in every locked channel").setMaxLength(400)),

  async execute(interaction, client) {
    const guild = interaction.guild!;
    const state = interaction.options.getString("state", true);
    const reason = interaction.options.getString("reason") ?? "The server is temporarily locked down.";
    const cfg = await client.config.get(guild.id, "antiraid");

    const channels = cfg.lockdownAll
      ? [...guild.channels.cache.values()].filter((c) => c.type === ChannelType.GuildText)
      : cfg.lockdownChannels.map((id) => guild.channels.cache.get(id)).filter(Boolean);

    if (!channels.length) {
      await interaction.editReply({
        embeds: [errorEmbed("No channels are configured for lockdown. Set them on the Anti-raid page of the dashboard.")],
      });
      return;
    }

    let changed = 0;
    for (const channel of channels) {
      if (!channel || !("permissionOverwrites" in channel)) continue;
      const ok = await channel.permissionOverwrites
        .edit(guild.roles.everyone, { SendMessages: state === "on" ? false : null }, { reason: `Lockdown by ${interaction.user.username}` })
        .then(() => true)
        .catch(() => false);
      if (ok) changed += 1;
    }

    if (state === "on") client.setRaidMode(guild.id, cfg.raidModeMinutes);
    else client.clearRaidMode(guild.id);

    await interaction.editReply({
      embeds: [
        successEmbed(
          state === "on"
            ? `Locked **${changed}** channel(s). Raid mode is on for ${cfg.raidModeMinutes} minutes.\n${reason}`
            : `Unlocked **${changed}** channel(s). Raid mode is off.`,
        ),
      ],
    });
  },
};

export default [purgeCommand, slowmodeCommand, lockCommand, unlockCommand, lockdownCommand];
