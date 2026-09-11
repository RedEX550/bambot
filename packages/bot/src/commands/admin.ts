import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { COLORS, EMOJI, MODULE_REGISTRY, MODULES, type ModuleName } from "@bambot/shared";
import type { BotCommand } from "../core/types";
import { prisma } from "../core/db";
import { env } from "../core/env";
import { clamp, errorEmbed, successEmbed } from "../lib/embeds";
import { publishPanel } from "../services/tickets";
import { closeTicketByChannel, addUserToTicket, removeUserFromTicket } from "../services/ticket-actions";
import { closeModmailThread, sendModmailReply } from "../services/modmail";
import { endGiveaway, buildGiveawayEmbed, entryRow } from "../services/giveaways";
import { parseDuration } from "../lib/time";

export const panelCommand: BotCommand = {
  permission: "admin",
  data: new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Publish a panel to its configured channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) =>
      o
        .setName("panel")
        .setDescription("Which panel")
        .setRequired(true)
        .setAutocomplete(true),
    ),

  async autocomplete(interaction, client) {
    const cfg = await client.config.get(interaction.guildId!, "tickets");
    const focused = interaction.options.getFocused().toLowerCase();
    const panels = cfg.panels.filter((p) => p.name.toLowerCase().includes(focused) || p.id.includes(focused)).slice(0, 24);
    await interaction.respond([
      ...panels.map((p) => ({ name: `Ticket panel — ${p.name}`, value: `ticket:${p.id}` })),
      { name: "Verification panel", value: "verification" },
    ]);
  },

  async execute(interaction, client) {
    const value = interaction.options.getString("panel", true);
    const guild = interaction.guild!;

    if (value === "verification") {
      const { runBotAction } = await import("../services/bot-actions");
      const result = await runBotAction(client, { action: "publishVerification", guildId: guild.id });
      await interaction.editReply({ embeds: [result.ok ? successEmbed(result.message) : errorEmbed(result.message)] });
      return;
    }

    const panelId = value.replace(/^ticket:/, "");
    const result = await publishPanel(guild, panelId);
    await interaction.editReply({ embeds: [result.ok ? successEmbed(result.message) : errorEmbed(result.message)] });
  },
};

export const ticketAdminCommand: BotCommand = {
  module: "tickets",
  permission: "staff",
  data: new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Manage the ticket you are in")
    .addSubcommand((s) =>
      s
        .setName("close")
        .setDescription("Close this ticket")
        .addStringOption((o) => o.setName("reason").setDescription("Why").setMaxLength(500)),
    )
    .addSubcommand((s) =>
      s
        .setName("add")
        .setDescription("Give someone access to this ticket")
        .addUserOption((o) => o.setName("user").setDescription("Who").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("remove")
        .setDescription("Remove someone from this ticket")
        .addUserOption((o) => o.setName("user").setDescription("Who").setRequired(true)),
    )
    .addSubcommand((s) => s.setName("info").setDescription("Details about this ticket")),

  async execute(interaction, client) {
    const guild = interaction.guild!;
    const channelId = interaction.channelId;
    const sub = interaction.options.getSubcommand();

    const ticket = await prisma.ticket.findUnique({ where: { channelId } });
    if (!ticket) {
      await interaction.editReply({ embeds: [errorEmbed("This is not a ticket channel.")] });
      return;
    }

    if (sub === "close") {
      const result = await closeTicketByChannel(
        client,
        guild,
        channelId,
        { id: interaction.user.id, tag: interaction.user.username },
        interaction.options.getString("reason") ?? "No reason given",
      );
      await interaction.editReply({ embeds: [result.ok ? successEmbed(result.message) : errorEmbed(result.message)] });
      return;
    }

    if (sub === "add" || sub === "remove") {
      const user = interaction.options.getUser("user", true);
      const result =
        sub === "add" ? await addUserToTicket(guild, channelId, user.id) : await removeUserFromTicket(guild, channelId, user.id);
      await interaction.editReply({ embeds: [result.ok ? successEmbed(result.message) : errorEmbed(result.message)] });
      return;
    }

    const cfg = await client.config.get(guild.id, "tickets");
    const category = cfg.categories.find((c) => c.key === ticket.categoryKey);
    const responses = (ticket.formResponses as Record<string, string> | null) ?? {};

    const embed = new EmbedBuilder()
      .setColor(COLORS.brand)
      .setTitle(`${EMOJI.ticket} Ticket #${ticket.ticketNumber}`)
      .addFields(
        { name: "Opened by", value: `<@${ticket.openerId}>`, inline: true },
        { name: "Category", value: category?.label ?? ticket.categoryKey, inline: true },
        { name: "Status", value: ticket.status, inline: true },
        { name: "Priority", value: ticket.priority, inline: true },
        { name: "Claimed by", value: ticket.claimedById ? `<@${ticket.claimedById}>` : "unclaimed", inline: true },
        { name: "Opened", value: `<t:${Math.floor(ticket.createdAt.getTime() / 1000)}:R>`, inline: true },
      );

    if (ticket.firstResponseAt) {
      const minutes = Math.round((ticket.firstResponseAt.getTime() - ticket.createdAt.getTime()) / 60_000);
      embed.addFields({ name: "First response", value: `${minutes} minute(s)`, inline: true });
    }

    const answers = Object.entries(responses);
    if (answers.length) {
      embed.addFields({
        name: "Intake form",
        value: answers.map(([k, v]) => `**${k}**: ${clamp(String(v), 200)}`).join("\n").slice(0, 1024),
      });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};

export const modmailCommand: BotCommand = {
  module: "modmail",
  permission: "staff",
  data: new SlashCommandBuilder()
    .setName("modmail")
    .setDescription("Work a modmail thread")
    .addSubcommand((s) =>
      s
        .setName("reply")
        .setDescription("Send a reply to the member")
        .addStringOption((o) => o.setName("message").setDescription("What to send").setRequired(true).setMaxLength(1900)),
    )
    .addSubcommand((s) =>
      s
        .setName("close")
        .setDescription("Close this thread")
        .addStringOption((o) => o.setName("reason").setDescription("Internal note").setMaxLength(500)),
    ),

  async execute(interaction, client) {
    const guild = interaction.guild!;
    const sub = interaction.options.getSubcommand();

    if (sub === "reply") {
      const result = await sendModmailReply(
        client,
        guild,
        interaction.channelId,
        interaction.user.username,
        interaction.options.getString("message", true),
      );
      await interaction.editReply({ embeds: [result.ok ? successEmbed(result.message) : errorEmbed(result.message)] });
      return;
    }

    const result = await closeModmailThread(
      client,
      guild,
      interaction.channelId,
      interaction.user.id,
      interaction.options.getString("reason") ?? "No reason given",
    );
    await interaction.editReply({ embeds: [result.ok ? successEmbed(result.message) : errorEmbed(result.message)] });
  },
};

export const giveawayCommand: BotCommand = {
  module: "giveaways",
  permission: "mod",
  data: new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Run a giveaway")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents)
    .addSubcommand((s) =>
      s
        .setName("start")
        .setDescription("Start a giveaway")
        .addStringOption((o) => o.setName("prize").setDescription("What are you giving away?").setRequired(true).setMaxLength(240))
        .addStringOption((o) => o.setName("duration").setDescription("e.g. 24h, 3d").setRequired(true))
        .addIntegerOption((o) => o.setName("winners").setDescription("How many winners").setMinValue(1).setMaxValue(50))
        .addStringOption((o) => o.setName("description").setDescription("Extra details").setMaxLength(1000))
        .addChannelOption((o) => o.setName("channel").setDescription("Where to post it"))
        .addStringOption((o) => o.setName("image").setDescription("Image URL")),
    )
    .addSubcommand((s) =>
      s
        .setName("end")
        .setDescription("End a giveaway now")
        .addStringOption((o) => o.setName("message_id").setDescription("The giveaway message ID").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("reroll")
        .setDescription("Draw replacement winners")
        .addStringOption((o) => o.setName("message_id").setDescription("The giveaway message ID").setRequired(true)),
    ),

  async execute(interaction, client) {
    const guild = interaction.guild!;
    const sub = interaction.options.getSubcommand();
    const cfg = await client.config.get(guild.id, "giveaways");

    if (sub === "start") {
      const durationMs = parseDuration(interaction.options.getString("duration", true));
      if (!durationMs || durationMs < 60_000) {
        await interaction.editReply({ embeds: [errorEmbed("Give it at least a minute — try `24h` or `3d`.")] });
        return;
      }

      const chosen = interaction.options.getChannel("channel");
      const channel = chosen ? guild.channels.cache.get(chosen.id) : interaction.channel;
      if (!channel?.isTextBased() || !("send" in channel)) {
        await interaction.editReply({ embeds: [errorEmbed("Pick a text channel.")] });
        return;
      }

      const endsAt = new Date(Date.now() + durationMs);
      const giveaway = await prisma.giveaway.create({
        data: {
          guildId: guild.id,
          channelId: channel.id,
          prize: interaction.options.getString("prize", true),
          description: interaction.options.getString("description"),
          winnerCount: interaction.options.getInteger("winners") ?? 1,
          hostId: interaction.user.id,
          imageUrl: interaction.options.getString("image"),
          requirements: cfg.defaultRequirements as never,
          endsAt,
        },
      });

      const message = await channel
        .send({
          embeds: [buildGiveawayEmbed(giveaway, 0, Number.parseInt(cfg.color.replace("#", ""), 16) || COLORS.brand)],
          components: [entryRow(giveaway.id, cfg.buttonLabel)],
        })
        .catch(() => null);

      if (!message) {
        await prisma.giveaway.delete({ where: { id: giveaway.id } }).catch(() => undefined);
        await interaction.editReply({ embeds: [errorEmbed("I could not post in that channel.")] });
        return;
      }

      await prisma.giveaway.update({ where: { id: giveaway.id }, data: { messageId: message.id } });
      await interaction.editReply({ embeds: [successEmbed(`Giveaway started in <#${channel.id}>.\n${message.url}`)] });
      return;
    }

    const messageId = interaction.options.getString("message_id", true).replace(/\D/g, "");
    const giveaway = await prisma.giveaway.findFirst({ where: { guildId: guild.id, messageId } });
    if (!giveaway) {
      await interaction.editReply({ embeds: [errorEmbed("I could not find a giveaway with that message ID.")] });
      return;
    }

    const result = await endGiveaway(client, guild, giveaway.id, sub === "reroll");
    await interaction.editReply({ embeds: [result.ok ? successEmbed(result.message) : errorEmbed(result.message)] });
  },
};

export const configCommand: BotCommand = {
  permission: "admin",
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName("config")
    .setDescription("See what is switched on, and where to change it")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) =>
      o
        .setName("module")
        .setDescription("Show one module in detail")
        .setAutocomplete(true),
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    await interaction.respond(
      MODULES.filter((m) => m.includes(focused))
        .slice(0, 25)
        .map((m) => ({ name: MODULE_REGISTRY[m].ui.title, value: m })),
    );
  },

  async execute(interaction, client) {
    const guildId = interaction.guildId!;
    const dashboardUrl = `${env.PUBLIC_URL}/guilds/${guildId}`;
    const requested = interaction.options.getString("module");

    const moduleName = MODULES.find((m) => m === requested);
    if (moduleName) {
      const definition = MODULE_REGISTRY[moduleName];
      const data = (await client.config.get(guildId, moduleName)) as Record<string, unknown>;

      const lines: string[] = [];
      for (const section of definition.ui.sections.slice(0, 6)) {
        const fields = section.fields
          .filter((f) => !f.path.includes(".") && f.kind !== "custom" && f.kind !== "message")
          .slice(0, 6);
        if (!fields.length) continue;
        lines.push(
          `**${section.title}**`,
          ...fields.map((f) => {
            const value = data[f.path];
            const rendered = Array.isArray(value)
              ? value.length
                ? `${value.length} selected`
                : "none"
              : typeof value === "boolean"
                ? value
                  ? "on"
                  : "off"
                : String(value ?? "not set") || "not set";
            return ` ${f.label}: \`${rendered}\``;
          }),
          "",
        );
      }

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.brand)
            .setTitle(`⚙️ ${definition.ui.title}`)
            .setDescription(`${definition.ui.description}\n\n${lines.join("\n").slice(0, 3500)}`)
            .setFooter({ text: "Edit everything on the dashboard" })
            .setURL(`${dashboardUrl}/${moduleName}`),
        ],
      });
      return;
    }

    const statuses: string[] = [];
    for (const name of MODULES as readonly ModuleName[]) {
      const data = (await client.config.get(guildId, name)) as { enabled?: boolean };
      const definition = MODULE_REGISTRY[name];
      const state = data.enabled === undefined ? "—" : data.enabled ? "🟢" : "⚪";
      statuses.push(`${state} ${definition.ui.title}`);
    }

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.brand)
          .setTitle("⚙️ Bambot configuration")
          .setDescription(statuses.join("\n"))
          .addFields({ name: "Dashboard", value: `[Open the dashboard](${dashboardUrl})` })
          .setFooter({ text: "🟢 on · ⚪ off · — always available" }),
      ],
    });
  },
};

export const sayCommand: BotCommand = {
  permission: "admin",
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName("say")
    .setDescription("Send a message as Bambot")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) => o.setName("message").setDescription("What to say").setRequired(true).setMaxLength(2000))
    .addChannelOption((o) => o.setName("channel").setDescription("Where (defaults to here)")),

  async execute(interaction) {
    const chosen = interaction.options.getChannel("channel");
    const channel = chosen ? interaction.guild?.channels.cache.get(chosen.id) : interaction.channel;
    if (!channel?.isTextBased() || !("send" in channel)) {
      await interaction.editReply({ embeds: [errorEmbed("Pick a text channel.")] });
      return;
    }
    await channel.send({
      content: interaction.options.getString("message", true),
      allowedMentions: { parse: ["users"] },
    });
    await interaction.editReply({ embeds: [successEmbed(`Sent to <#${channel.id}>.`)] });
  },
};

export default [panelCommand, ticketAdminCommand, modmailCommand, giveawayCommand, configCommand, sayCommand];
