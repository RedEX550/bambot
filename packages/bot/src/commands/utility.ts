import { EmbedBuilder, SlashCommandBuilder, version as djsVersion } from "discord.js";
import { COLORS, EMOJI } from "@bambot/shared";
import type { BotCommand } from "../core/types";
import { prisma } from "../core/db";
import { clamp, errorEmbed, successEmbed } from "../lib/embeds";
import { formatDuration, parseDuration, timestamp } from "../lib/time";
import { resolveTier } from "../lib/permissions";

/** Commands grouped for /help, so the list stays readable as it grows. */
const HELP_GROUPS: { name: string; emoji: string; commands: string[] }[] = [
  { name: "Bambu Lab", emoji: "🖨️", commands: ["hms", "printer", "filament", "cost"] },
  { name: "Support", emoji: "🎫", commands: ["ticket", "kb", "tag"] },
  { name: "Community", emoji: "✨", commands: ["level", "leaderboard", "suggest", "giveaway", "poll"] },
  { name: "You", emoji: "👤", commands: ["remind", "afk", "highlight", "userinfo", "avatar"] },
  { name: "Moderation", emoji: "🛡️", commands: ["warn", "timeout", "kick", "ban", "purge", "case", "history", "note", "slowmode", "lock", "unlock", "lockdown"] },
  { name: "Admin", emoji: "⚙️", commands: ["panel", "config", "say", "modmail"] },
];

export const helpCommand: BotCommand = {
  cooldown: 3,
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("What Bambot can do")
    .addStringOption((o) => o.setName("command").setDescription("Details for one command").setAutocomplete(true)),

  async autocomplete(interaction, client) {
    const focused = interaction.options.getFocused().toLowerCase();
    const names = [...client.commands.keys()].filter((n) => n.includes(focused)).slice(0, 25);
    await interaction.respond(names.map((n) => ({ name: `/${n}`, value: n })));
  },

  async execute(interaction, client) {
    const requested = interaction.options.getString("command");

    if (requested) {
      const command = client.commands.get(requested);
      if (!command) {
        await interaction.editReply({ embeds: [errorEmbed(`There is no \`/${requested}\` command.`)] });
        return;
      }
      const json = command.data.toJSON();
      const embed = new EmbedBuilder()
        .setColor(COLORS.brand)
        .setTitle(`/${json.name}`)
        .setDescription(json.description ?? "No description");

      const options = (json.options ?? []) as { name: string; description: string; required?: boolean; type: number }[];
      if (options.length) {
        embed.addFields({
          name: "Options",
          value: options
            .map((o) => `\`${o.name}\`${o.required ? " *(required)*" : ""} — ${o.description}`)
            .join("\n")
            .slice(0, 1024),
        });
      }
      if (command.permission && command.permission !== "everyone") {
        embed.addFields({ name: "Who can use it", value: command.permission, inline: true });
      }
      if (command.cooldown) embed.addFields({ name: "Cooldown", value: `${command.cooldown}s`, inline: true });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Only show groups the caller can actually use.
    const core = interaction.guildId ? await client.config.get(interaction.guildId, "core") : null;
    const member = interaction.guild && interaction.member ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null;
    const tier = member && core ? resolveTier(member, core) : "everyone";
    const isStaff = tier !== "everyone";

    const embed = new EmbedBuilder()
      .setColor(COLORS.brand)
      .setTitle(`${EMOJI.printer} Bambot`)
      .setDescription(
        "Community tooling for the Bambu Lab Discord — support tickets, printer help, moderation and levels.\n" +
          "Use `/help command:<name>` for details on any one command.",
      );

    for (const group of HELP_GROUPS) {
      const restricted = group.name === "Moderation" || group.name === "Admin";
      if (restricted && !isStaff) continue;

      const available = group.commands.filter((name) => client.commands.has(name) && !core?.disabledCommands.includes(name));
      if (!available.length) continue;

      embed.addFields({
        name: `${group.emoji} ${group.name}`,
        value: available.map((c) => `\`/${c}\``).join(" "),
      });
    }

    embed.setFooter({ text: `${client.commands.size} commands • discord.js ${djsVersion}` });
    await interaction.editReply({ embeds: [embed] });
  },
};

export const pingCommand: BotCommand = {
  cooldown: 5,
  ephemeral: true,
  data: new SlashCommandBuilder().setName("ping").setDescription("Check that Bambot is responsive"),
  async execute(interaction, client) {
    const roundTrip = Date.now() - interaction.createdTimestamp;
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.brand)
          .setTitle("🏓 Pong")
          .addFields(
            { name: "Gateway", value: `${Math.round(client.ws.ping)} ms`, inline: true },
            { name: "Round trip", value: `${roundTrip} ms`, inline: true },
            { name: "Uptime", value: formatDuration(client.uptime ?? 0), inline: true },
          ),
      ],
    });
  },
};

export const userinfoCommand: BotCommand = {
  cooldown: 3,
  data: new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Details about a member")
    .addUserOption((o) => o.setName("user").setDescription("Defaults to you")),

  async execute(interaction) {
    const user = interaction.options.getUser("user") ?? interaction.user;
    const member = await interaction.guild?.members.fetch(user.id).catch(() => null);

    const embed = new EmbedBuilder()
      .setColor(member?.displayColor || COLORS.brand)
      .setAuthor({ name: user.username, iconURL: user.displayAvatarURL({ size: 64 }) })
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: "User", value: `<@${user.id}>`, inline: true },
        { name: "ID", value: user.id, inline: true },
        { name: "Account created", value: timestamp(user.createdAt, "R"), inline: true },
      );

    if (member) {
      embed.addFields({
        name: "Joined server",
        value: member.joinedAt ? timestamp(member.joinedAt, "R") : "unknown",
        inline: true,
      });

      const roles = [...member.roles.cache.values()].filter((r) => r.id !== interaction.guildId).sort((a, b) => b.position - a.position);
      if (roles.length) {
        embed.addFields({
          name: `Roles (${roles.length})`,
          value: clamp(roles.slice(0, 20).map((r) => `<@&${r.id}>`).join(" "), 1024),
        });
      }
      if (member.isCommunicationDisabled()) {
        embed.addFields({ name: "Timed out until", value: timestamp(member.communicationDisabledUntil!, "R"), inline: true });
      }
    }

    if (interaction.guildId) {
      const [cases, level] = await Promise.all([
        prisma.case.count({ where: { guildId: interaction.guildId, targetId: user.id, pardoned: false } }),
        prisma.level.findUnique({ where: { guildId_userId: { guildId: interaction.guildId, userId: user.id } } }),
      ]);
      if (level) embed.addFields({ name: "Level", value: `${level.level} (${level.xp.toLocaleString("en-US")} XP)`, inline: true });
      if (cases) embed.addFields({ name: "Cases on record", value: String(cases), inline: true });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};

export const serverinfoCommand: BotCommand = {
  cooldown: 5,
  data: new SlashCommandBuilder().setName("serverinfo").setDescription("Details about this server"),
  async execute(interaction) {
    const guild = interaction.guild!;
    const [openTickets, totalCases] = await Promise.all([
      prisma.ticket.count({ where: { guildId: guild.id, status: { not: "CLOSED" } } }),
      prisma.case.count({ where: { guildId: guild.id } }),
    ]);

    const embed = new EmbedBuilder()
      .setColor(COLORS.brand)
      .setTitle(guild.name)
      .setThumbnail(guild.iconURL({ size: 256 }))
      .addFields(
        { name: "Members", value: guild.memberCount.toLocaleString("en-US"), inline: true },
        { name: "Channels", value: String(guild.channels.cache.size), inline: true },
        { name: "Roles", value: String(guild.roles.cache.size), inline: true },
        { name: "Boosts", value: `${guild.premiumSubscriptionCount ?? 0} (tier ${guild.premiumTier})`, inline: true },
        { name: "Created", value: timestamp(guild.createdAt, "R"), inline: true },
        { name: "Owner", value: `<@${guild.ownerId}>`, inline: true },
        { name: "Open tickets", value: String(openTickets), inline: true },
        { name: "Moderation cases", value: String(totalCases), inline: true },
      );

    if (guild.description) embed.setDescription(guild.description);
    await interaction.editReply({ embeds: [embed] });
  },
};

export const avatarCommand: BotCommand = {
  cooldown: 3,
  data: new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Show someone's avatar in full size")
    .addUserOption((o) => o.setName("user").setDescription("Defaults to you")),

  async execute(interaction) {
    const user = interaction.options.getUser("user") ?? interaction.user;
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.brand)
          .setTitle(user.username)
          .setImage(user.displayAvatarURL({ size: 1024 }))
          .setURL(user.displayAvatarURL({ size: 1024 })),
      ],
    });
  },
};

export const remindCommand: BotCommand = {
  module: "content",
  cooldown: 3,
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName("remind")
    .setDescription("Have Bambot remind you about something")
    .addSubcommand((s) =>
      s
        .setName("me")
        .setDescription("Set a reminder")
        .addStringOption((o) => o.setName("when").setDescription("e.g. 30m, 2h, 3d").setRequired(true))
        .addStringOption((o) => o.setName("what").setDescription("What to remind you about").setRequired(true).setMaxLength(500)),
    )
    .addSubcommand((s) => s.setName("list").setDescription("Your pending reminders"))
    .addSubcommand((s) =>
      s
        .setName("cancel")
        .setDescription("Cancel a reminder")
        .addIntegerOption((o) => o.setName("number").setDescription("From /remind list").setRequired(true).setMinValue(1)),
    ),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();
    const content = await client.config.get(interaction.guildId!, "content");

    if (sub === "me") {
      const pending = await prisma.reminder.count({ where: { userId: interaction.user.id, fired: false } });
      if (pending >= content.maxRemindersPerUser) {
        await interaction.editReply({
          embeds: [errorEmbed(`You already have ${pending} reminders pending. Cancel one first.`)],
        });
        return;
      }

      const whenRaw = interaction.options.getString("when", true);
      const ms = parseDuration(whenRaw);
      if (!ms || ms < 30_000) {
        await interaction.editReply({ embeds: [errorEmbed("Give me at least 30 seconds — try `30m`, `2h` or `3d`.")] });
        return;
      }
      if (ms > 365 * 86_400_000) {
        await interaction.editReply({ embeds: [errorEmbed("A year is the longest I will hold a reminder.")] });
        return;
      }

      const remindAt = new Date(Date.now() + ms);
      await prisma.reminder.create({
        data: {
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          userId: interaction.user.id,
          content: interaction.options.getString("what", true),
          remindAt,
        },
      });

      await interaction.editReply({
        embeds: [successEmbed(`I will remind you ${timestamp(remindAt, "R")} (${timestamp(remindAt, "F")}).`)],
      });
      return;
    }

    const reminders = await prisma.reminder.findMany({
      where: { userId: interaction.user.id, fired: false },
      orderBy: { remindAt: "asc" },
      take: 25,
    });

    if (sub === "list") {
      if (!reminders.length) {
        await interaction.editReply({ embeds: [successEmbed("You have no pending reminders.")] });
        return;
      }
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.info)
            .setTitle("⏰ Your reminders")
            .setDescription(
              reminders
                .map((r, i) => `\`${i + 1}.\` ${timestamp(r.remindAt, "R")} — ${clamp(r.content, 80)}`)
                .join("\n"),
            ),
        ],
      });
      return;
    }

    const index = interaction.options.getInteger("number", true) - 1;
    const target = reminders[index];
    if (!target) {
      await interaction.editReply({ embeds: [errorEmbed("No reminder with that number. Check `/remind list`.")] });
      return;
    }
    await prisma.reminder.delete({ where: { id: target.id } });
    await interaction.editReply({ embeds: [successEmbed(`Cancelled: ${clamp(target.content, 100)}`)] });
  },
};

export const afkCommand: BotCommand = {
  module: "content",
  cooldown: 5,
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName("afk")
    .setDescription("Let people know you are away")
    .addStringOption((o) => o.setName("message").setDescription("Optional note").setMaxLength(200)),

  async execute(interaction) {
    const message = interaction.options.getString("message") ?? "AFK";
    await prisma.afk.upsert({
      where: { guildId_userId: { guildId: interaction.guildId!, userId: interaction.user.id } },
      create: { guildId: interaction.guildId!, userId: interaction.user.id, message },
      update: { message, since: new Date() },
    });
    await interaction.editReply({
      embeds: [successEmbed(`You are now AFK: ${message}\nI will clear it when you next speak.`)],
    });
  },
};

export const highlightCommand: BotCommand = {
  module: "content",
  cooldown: 3,
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName("highlight")
    .setDescription("Get a DM when a keyword is mentioned")
    .addSubcommand((s) =>
      s
        .setName("add")
        .setDescription("Watch a word")
        .addStringOption((o) => o.setName("word").setDescription("The keyword").setRequired(true).setMaxLength(50)),
    )
    .addSubcommand((s) =>
      s
        .setName("remove")
        .setDescription("Stop watching a word")
        .addStringOption((o) => o.setName("word").setDescription("The keyword").setRequired(true).setMaxLength(50)),
    )
    .addSubcommand((s) => s.setName("list").setDescription("Words you are watching")),

  async execute(interaction, client) {
    const guildId = interaction.guildId!;
    const sub = interaction.options.getSubcommand();
    const content = await client.config.get(guildId, "content");

    if (sub === "list") {
      const words = await prisma.highlight.findMany({ where: { guildId, userId: interaction.user.id } });
      await interaction.editReply({
        embeds: [
          words.length
            ? successEmbed(`You are watching: ${words.map((w) => `\`${w.word}\``).join(", ")}`)
            : successEmbed("You are not watching any words yet. Add one with `/highlight add`."),
        ],
      });
      return;
    }

    const word = interaction.options.getString("word", true).trim().toLowerCase();

    if (sub === "add") {
      if (word.length < 3) {
        await interaction.editReply({ embeds: [errorEmbed("Use at least three characters — shorter words fire constantly.")] });
        return;
      }
      const count = await prisma.highlight.count({ where: { guildId, userId: interaction.user.id } });
      if (count >= content.maxHighlightsPerUser) {
        await interaction.editReply({ embeds: [errorEmbed(`You can watch at most ${content.maxHighlightsPerUser} words.`)] });
        return;
      }
      await prisma.highlight
        .create({ data: { guildId, userId: interaction.user.id, word } })
        .catch(() => undefined);
      await interaction.editReply({ embeds: [successEmbed(`Watching \`${word}\`. Make sure your DMs are open.`)] });
      return;
    }

    await prisma.highlight.deleteMany({ where: { guildId, userId: interaction.user.id, word } });
    await interaction.editReply({ embeds: [successEmbed(`No longer watching \`${word}\`.`)] });
  },
};

export default [
  helpCommand,
  pingCommand,
  userinfoCommand,
  serverinfoCommand,
  avatarCommand,
  remindCommand,
  afkCommand,
  highlightCommand,
];
