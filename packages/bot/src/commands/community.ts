import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { COLORS, EMOJI } from "@bambot/shared";
import type { BotCommand } from "../core/types";
import { prisma } from "../core/db";
import { clamp, errorEmbed, successEmbed } from "../lib/embeds";
import { renderRankCard } from "../lib/rank-card";
import { getProgress } from "../services/leveling";
import { invalidateKbCache, searchKb, slugify } from "../services/kb";

export const levelCommand: BotCommand = {
  module: "leveling",
  cooldown: 5,
  data: new SlashCommandBuilder()
    .setName("level")
    .setDescription("Your level and progress")
    .addUserOption((o) => o.setName("user").setDescription("Defaults to you")),

  async execute(interaction, client) {
    const user = interaction.options.getUser("user") ?? interaction.user;
    const guildId = interaction.guildId!;
    const progress = await getProgress(guildId, user.id);

    if (!progress) {
      await interaction.editReply({
        embeds: [errorEmbed(user.id === interaction.user.id ? "You have not earned any XP yet. Say something!" : `**${user.username}** has not earned any XP yet.`)],
      });
      return;
    }

    const cfg = await client.config.get(guildId, "leveling");
    const row = await prisma.level.findUnique({ where: { guildId_userId: { guildId, userId: user.id } } });
    const member = await interaction.guild?.members.fetch(user.id).catch(() => null);

    const card = await renderRankCard({
      displayName: member?.displayName ?? user.username,
      avatarUrl: user.displayAvatarURL({ extension: "png", size: 256 }),
      level: progress.level,
      rank: progress.rank,
      xp: progress.xp,
      currentLevelXp: progress.currentLevelXp,
      nextLevelXp: progress.nextLevelXp,
      accentColor: (cfg.card.allowMemberCustomisation && row?.cardColor) || cfg.card.accentColor,
      backgroundColor: cfg.card.backgroundColor,
      backgroundUrl: (cfg.card.allowMemberCustomisation && row?.cardBanner) || cfg.card.backgroundUrl || undefined,
    });

    if (card) {
      await interaction.editReply({ files: [card] });
      return;
    }

    // Canvas unavailable: a text bar still answers the question.
    const filled = Math.round(progress.progress * 20);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.brand)
          .setAuthor({ name: member?.displayName ?? user.username, iconURL: user.displayAvatarURL({ size: 64 }) })
          .setDescription(
            `**Level ${progress.level}** • Rank #${progress.rank}\n` +
              `\`${"█".repeat(filled)}${"░".repeat(20 - filled)}\` ${Math.round(progress.progress * 100)}%\n` +
              `${progress.xp.toLocaleString("en-US")} XP total`,
          ),
      ],
    });
  },
};

export const leaderboardCommand: BotCommand = {
  module: "leveling",
  cooldown: 10,
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("The top members by XP")
    .addIntegerOption((o) => o.setName("page").setDescription("Page number").setMinValue(1).setMaxValue(50)),

  async execute(interaction, client) {
    const guildId = interaction.guildId!;
    const cfg = await client.config.get(guildId, "leveling");

    if (!cfg.leaderboardPublic) {
      const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
      const core = await client.config.get(guildId, "core");
      const isStaff = member && [...core.staffRoles, ...core.modRoles, ...core.adminRoles].some((r) => member.roles.cache.has(r));
      if (!isStaff) {
        await interaction.editReply({ embeds: [errorEmbed("The leaderboard is staff-only in this server.")] });
        return;
      }
    }

    const page = interaction.options.getInteger("page") ?? 1;
    const pageSize = 10;

    const [rows, total] = await Promise.all([
      prisma.level.findMany({
        where: { guildId, optedOut: false },
        orderBy: { xp: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.level.count({ where: { guildId, optedOut: false } }),
    ]);

    if (!rows.length) {
      await interaction.editReply({ embeds: [errorEmbed("Nobody is on the leaderboard yet.")] });
      return;
    }

    const medals = ["🥇", "🥈", "🥉"];
    const lines = rows.map((row, index) => {
      const position = (page - 1) * pageSize + index + 1;
      const prefix = position <= 3 && page === 1 ? medals[position - 1] : `\`#${String(position).padStart(2, " ")}\``;
      return `${prefix} <@${row.userId}> — level **${row.level}** · ${row.xp.toLocaleString("en-US")} XP`;
    });

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.brand)
          .setTitle(`🏆 ${interaction.guild?.name} leaderboard`)
          .setDescription(lines.join("\n"))
          .setFooter({ text: `Page ${page} of ${Math.max(1, Math.ceil(total / pageSize))} • ${total} ranked members` }),
      ],
      allowedMentions: { parse: [] },
    });
  },
};

export const suggestCommand: BotCommand = {
  module: "suggestions",
  cooldown: 30,
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName("suggest")
    .setDescription("Suggest an idea for the server or for Bambu Lab")
    .addStringOption((o) => o.setName("idea").setDescription("Your suggestion").setRequired(true).setMaxLength(1500)),

  async execute(interaction, client) {
    const guildId = interaction.guildId!;
    const cfg = await client.config.get(guildId, "suggestions");

    if (!cfg.channelId) {
      await interaction.editReply({ embeds: [errorEmbed("Suggestions are not set up yet. Ask an admin to pick a channel.")] });
      return;
    }

    const member = await interaction.guild!.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return;

    if (cfg.blockedRoles.some((r) => member.roles.cache.has(r))) {
      await interaction.editReply({ embeds: [errorEmbed("You are not able to post suggestions.")] });
      return;
    }
    if (cfg.requiredRoles.length && !cfg.requiredRoles.some((r) => member.roles.cache.has(r))) {
      await interaction.editReply({ embeds: [errorEmbed("You do not have the role needed to post suggestions.")] });
      return;
    }
    if (cfg.minAccountAgeHours > 0) {
      const ageHours = (Date.now() - interaction.user.createdTimestamp) / 3_600_000;
      if (ageHours < cfg.minAccountAgeHours) {
        await interaction.editReply({ embeds: [errorEmbed(`Your account must be at least ${cfg.minAccountAgeHours} hours old.`)] });
        return;
      }
    }
    if (cfg.cooldownMinutes > 0) {
      const recent = await prisma.suggestion.findFirst({
        where: { guildId, authorId: interaction.user.id, createdAt: { gte: new Date(Date.now() - cfg.cooldownMinutes * 60_000) } },
      });
      if (recent) {
        await interaction.editReply({ embeds: [errorEmbed(`You can post another suggestion in ${cfg.cooldownMinutes} minutes.`)] });
        return;
      }
    }

    const content = interaction.options.getString("idea", true);
    const highest = await prisma.suggestion.findFirst({ where: { guildId }, orderBy: { number: "desc" }, select: { number: true } });
    const number = (highest?.number ?? 0) + 1;

    const targetId = cfg.mode === "review" && cfg.reviewChannelId ? cfg.reviewChannelId : cfg.channelId;
    const channel = interaction.guild!.channels.cache.get(targetId);
    if (!channel?.isTextBased()) {
      await interaction.editReply({ embeds: [errorEmbed("I cannot post in the suggestions channel.")] });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(COLORS.info)
      .setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL({ size: 64 }) })
      .setTitle(`${EMOJI.bulb} Suggestion #${number}`)
      .setDescription(content)
      .setFooter({ text: cfg.mode === "review" ? "Awaiting staff review" : "Vote below" })
      .setTimestamp(new Date());

    const message = await channel.send({ embeds: [embed] }).catch(() => null);
    if (!message) {
      await interaction.editReply({ embeds: [errorEmbed("I could not post that. Check my permissions in the suggestions channel.")] });
      return;
    }

    if (cfg.mode !== "review") {
      await message.react(cfg.upvoteEmoji).catch(() => undefined);
      await message.react(cfg.downvoteEmoji).catch(() => undefined);
    }

    let threadId: string | null = null;
    if (cfg.createThread && "threads" in channel) {
      const thread = await message
        .startThread({ name: `Suggestion #${number}`, autoArchiveDuration: cfg.threadAutoArchiveHours as never })
        .catch(() => null);
      threadId = thread?.id ?? null;
    }

    await prisma.suggestion.create({
      data: {
        guildId,
        number,
        channelId: channel.id,
        messageId: message.id,
        threadId,
        authorId: interaction.user.id,
        authorTag: interaction.user.username,
        content,
        status: cfg.mode === "review" ? "PENDING" : "PENDING",
      },
    });

    await interaction.editReply({
      embeds: [successEmbed(`Suggestion **#${number}** posted in <#${channel.id}>.`)],
    });
  },
};

export const tagCommand: BotCommand = {
  module: "content",
  cooldown: 3,
  data: new SlashCommandBuilder()
    .setName("tag")
    .setDescription("Saved answers to common questions")
    .addSubcommand((s) =>
      s
        .setName("show")
        .setDescription("Post a tag")
        .addStringOption((o) => o.setName("name").setDescription("Tag name").setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((s) => s.setName("list").setDescription("Every tag in this server"))
    .addSubcommand((s) =>
      s
        .setName("create")
        .setDescription("Create or update a tag (staff only)")
        .addStringOption((o) => o.setName("name").setDescription("Tag name").setRequired(true).setMaxLength(40))
        .addStringOption((o) => o.setName("content").setDescription("What it says").setRequired(true).setMaxLength(2000)),
    )
    .addSubcommand((s) =>
      s
        .setName("delete")
        .setDescription("Delete a tag (staff only)")
        .addStringOption((o) => o.setName("name").setDescription("Tag name").setRequired(true).setAutocomplete(true)),
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const tags = await prisma.tag.findMany({
      where: { guildId: interaction.guildId!, name: { contains: focused, mode: "insensitive" } },
      orderBy: { uses: "desc" },
      take: 25,
    });
    await interaction.respond(tags.map((t) => ({ name: t.name, value: t.name })));
  },

  async execute(interaction, client) {
    const guildId = interaction.guildId!;
    const sub = interaction.options.getSubcommand();
    const content = await client.config.get(guildId, "content");

    if (sub === "list") {
      const tags = await prisma.tag.findMany({ where: { guildId }, orderBy: { uses: "desc" }, take: 60 });
      await interaction.editReply({
        embeds: [
          tags.length
            ? new EmbedBuilder()
                .setColor(COLORS.brand)
                .setTitle(`Tags (${tags.length})`)
                .setDescription(tags.map((t) => `\`${t.name}\``).join(" "))
            : errorEmbed("There are no tags yet."),
        ],
      });
      return;
    }

    const name = interaction.options.getString("name", true).toLowerCase().trim();

    if (sub === "show") {
      const tag = await prisma.tag.findFirst({
        where: { guildId, OR: [{ name }, { aliases: { has: name } }] },
      });
      if (!tag) {
        await interaction.editReply({ embeds: [errorEmbed(`There is no tag called \`${name}\`.`)] });
        return;
      }
      await prisma.tag.update({ where: { id: tag.id }, data: { uses: { increment: 1 } } }).catch(() => undefined);
      await interaction.editReply({ content: tag.content, allowedMentions: { parse: [] } });
      return;
    }

    // create / delete need staff.
    const member = await interaction.guild!.members.fetch(interaction.user.id).catch(() => null);
    const core = await client.config.get(guildId, "core");
    const managers = content.tagManagerRoles.length ? content.tagManagerRoles : [...core.staffRoles, ...core.modRoles, ...core.adminRoles];
    const allowed = member?.permissions.has("ManageGuild") || managers.some((r) => member?.roles.cache.has(r));
    if (!allowed) {
      await interaction.editReply({ embeds: [errorEmbed("Only staff can manage tags.")] });
      return;
    }

    if (sub === "create") {
      const body = interaction.options.getString("content", true);
      await prisma.tag.upsert({
        where: { guildId_name: { guildId, name } },
        create: { guildId, name, content: body, createdBy: interaction.user.id },
        update: { content: body, updatedBy: interaction.user.id },
      });
      await interaction.editReply({ embeds: [successEmbed(`Tag \`${name}\` saved.`)] });
      return;
    }

    const deleted = await prisma.tag.deleteMany({ where: { guildId, name } });
    await interaction.editReply({
      embeds: [deleted.count ? successEmbed(`Tag \`${name}\` deleted.`) : errorEmbed(`There is no tag called \`${name}\`.`)],
    });
  },
};

export const kbCommand: BotCommand = {
  module: "content",
  cooldown: 3,
  data: new SlashCommandBuilder()
    .setName("kb")
    .setDescription("Search the community knowledge base")
    .addSubcommand((s) =>
      s
        .setName("search")
        .setDescription("Find an article")
        .addStringOption((o) => o.setName("query").setDescription("What are you stuck on?").setRequired(true).setMaxLength(200))
        .addBooleanOption((o) => o.setName("public").setDescription("Post the answer for everyone")),
    )
    .addSubcommand((s) =>
      s
        .setName("add")
        .setDescription("Add an article (staff only)")
        .addStringOption((o) => o.setName("title").setDescription("Article title").setRequired(true).setMaxLength(120))
        .addStringOption((o) => o.setName("content").setDescription("The answer").setRequired(true).setMaxLength(3000))
        .addStringOption((o) => o.setName("keywords").setDescription("Comma separated search terms").setMaxLength(300))
        .addStringOption((o) => o.setName("category").setDescription("e.g. printing, ams, software").setMaxLength(40)),
    ),

  async execute(interaction, client) {
    const guildId = interaction.guildId!;
    const sub = interaction.options.getSubcommand();
    const cfg = await client.config.get(guildId, "content");

    if (sub === "search") {
      const query = interaction.options.getString("query", true);
      const results = await searchKb(guildId, query, 5);

      if (!results.length) {
        await interaction.editReply({
          embeds: [errorEmbed(`Nothing matched "${clamp(query, 80)}". Try different words, or open a ticket and staff will help.`)],
        });
        return;
      }

      const best = results[0];
      const embed = new EmbedBuilder()
        .setColor(COLORS.brand)
        .setTitle(`${EMOJI.bulb} ${best.article.title}`)
        .setDescription(clamp(best.article.content, 3000))
        .setFooter({ text: `${best.confidence}% match • ${best.article.category}` });

      if (best.article.linkUrl) embed.setURL(best.article.linkUrl);
      if (best.article.imageUrl) embed.setImage(best.article.imageUrl);

      if (results.length > 1) {
        embed.addFields({
          name: "Related",
          value: results.slice(1).map((r) => `• ${r.article.title}`).join("\n").slice(0, 1024),
        });
      }

      await prisma.kbArticle.update({ where: { id: best.article.id }, data: { views: { increment: 1 } } }).catch(() => undefined);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const member = await interaction.guild!.members.fetch(interaction.user.id).catch(() => null);
    const core = await client.config.get(guildId, "core");
    const managers = cfg.kbManagerRoles.length ? cfg.kbManagerRoles : [...core.staffRoles, ...core.modRoles, ...core.adminRoles];
    const allowed = member?.permissions.has("ManageGuild") || managers.some((r) => member?.roles.cache.has(r));
    if (!allowed) {
      await interaction.editReply({ embeds: [errorEmbed("Only staff can add knowledge base articles.")] });
      return;
    }

    const title = interaction.options.getString("title", true);
    const body = interaction.options.getString("content", true);
    const keywords = (interaction.options.getString("keywords") ?? "")
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);

    const slug = slugify(title);
    await prisma.kbArticle.upsert({
      where: { guildId_slug: { guildId, slug } },
      create: {
        guildId,
        slug,
        title,
        content: body,
        summary: clamp(body, 200),
        keywords,
        category: interaction.options.getString("category") ?? "general",
        createdBy: interaction.user.id,
      },
      update: { title, content: body, summary: clamp(body, 200), keywords },
    });

    invalidateKbCache(guildId);
    await interaction.editReply({ embeds: [successEmbed(`Article **${title}** saved as \`${slug}\`.`)] });
  },
};

export default [levelCommand, leaderboardCommand, suggestCommand, tagCommand, kbCommand];
