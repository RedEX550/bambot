import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { COLORS, EMOJI } from "@bambot/shared";
import type { BotCommand } from "../../core/types";
import { HMS_FAMILIES, WIKI_SERIES, hmsHomeUrl, hmsWikiUrl, normaliseHms } from "../../data/hms";
import { PRINTERS } from "../../data/printers";
import { errorEmbed } from "../../lib/embeds";

export const hmsCommand: BotCommand = {
  module: "bambu",
  cooldown: 3,
  data: new SlashCommandBuilder()
    .setName("hms")
    .setDescription("Decode a Bambu Lab HMS error code and link the exact wiki page")
    .addStringOption((option) =>
      option.setName("code").setDescription("For example 0300-0300-0001-0001").setRequired(true).setMaxLength(60),
    )
    .addStringOption((option) =>
      option
        .setName("printer")
        .setDescription("Your printer, so the wiki link points at the right section")
        .setRequired(false)
        .setAutocomplete(true),
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const matches = PRINTERS.filter((p) => p.name.toLowerCase().includes(focused) || p.key.includes(focused)).slice(0, 25);
    await interaction.respond(matches.map((p) => ({ name: p.name, value: p.key })));
  },

  async execute(interaction, client) {
    const raw = interaction.options.getString("code", true);
    const printerKey = interaction.options.getString("printer") ?? "";
    const cfg = interaction.guildId ? await client.config.get(interaction.guildId, "bambu") : null;
    const locale = cfg?.wikiLocale ?? "en";

    const result = normaliseHms(raw);
    if (!result.ok || !result.canonical || !result.slug) {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            `${result.error}\n\nYou can also scan the QR code shown on the printer screen or in Bambu Studio — it opens the exact page.\n\n[HMS documentation](${hmsHomeUrl(locale)})`,
          ),
        ],
      });
      return;
    }

    const series = WIKI_SERIES[printerKey] ?? "x1";
    const wikiUrl = hmsWikiUrl(result.slug, series, locale);
    const family = result.family;

    const embed = new EmbedBuilder()
      .setColor(family ? COLORS.warning : COLORS.info)
      .setTitle(`${EMOJI.wrench} HMS ${result.canonical}`)
      .setURL(wikiUrl);

    if (family) {
      embed.setDescription(`**${family.subsystem}**\n${family.summary}`);
      embed.addFields({
        name: "Try this first",
        value: family.firstSteps.map((s) => `• ${s}`).join("\n").slice(0, 1024),
      });
    } else {
      embed.setDescription(
        `I do not have notes for the \`${result.canonical.split("-")[0]}\` subsystem, but the official page below documents this exact code.`,
      );
    }

    embed.addFields({
      name: "Official page",
      value: `[Open the wiki entry for this code](${wikiUrl})\n[All HMS codes](${hmsHomeUrl(locale)})`,
    });

    if (!printerKey) {
      embed.setFooter({ text: "Tip: add the printer option so the link points at your machine's section." });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};

export default hmsCommand;
