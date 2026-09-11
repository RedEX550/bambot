import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { COLORS, EMOJI } from "@bambot/shared";
import type { BotCommand } from "../../core/types";
import { PRINTERS, currentPrinters, findPrinter } from "../../data/printers";
import { errorEmbed } from "../../lib/embeds";

const SERIES_BLURB: Record<string, string> = {
  A: "Open-frame bedslingers. Easiest to live with, not suited to ABS/ASA.",
  P: "CoreXY workhorses. The enclosed all-rounders.",
  X: "Flagship compact machines with the full sensor package.",
  H: "Large format and production. Dual nozzles or a tool-changer.",
};

export const printerCommand: BotCommand = {
  module: "bambu",
  cooldown: 3,
  data: new SlashCommandBuilder()
    .setName("printer")
    .setDescription("Look up a Bambu Lab printer, or see the current line-up")
    .addSubcommand((sub) =>
      sub
        .setName("info")
        .setDescription("Details for one printer")
        .addStringOption((option) =>
          option.setName("model").setDescription("H2D, X2D, P1S, A1 mini ...").setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) => sub.setName("lineup").setDescription("Every printer currently sold, grouped by series")),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const matches = PRINTERS.filter(
      (p) => p.name.toLowerCase().includes(focused) || p.aliases.some((a) => a.includes(focused)),
    ).slice(0, 25);
    await interaction.respond(
      matches.map((p) => ({ name: `${p.name}${p.status === "legacy" ? " (legacy)" : ""}`, value: p.key })),
    );
  },

  async execute(interaction) {
    if (interaction.options.getSubcommand() === "lineup") {
      const embed = new EmbedBuilder()
        .setColor(COLORS.brand)
        .setTitle(`${EMOJI.printer} Current Bambu Lab line-up`)
        .setDescription("Use `/printer info` for the details of any single machine.");

      for (const series of ["A", "P", "X", "H"] as const) {
        const models = currentPrinters().filter((p) => p.series === series);
        if (!models.length) continue;
        embed.addFields({
          name: `${series} series`,
          value: `_${SERIES_BLURB[series]}_\n${models.map((m) => `**${m.name}** — ${m.tagline}`).join("\n")}`.slice(0, 1024),
        });
      }
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const query = interaction.options.getString("model", true);
    const printer = findPrinter(query);
    if (!printer) {
      await interaction.editReply({
        embeds: [errorEmbed(`I do not know a printer called **${query}**. Try \`/printer lineup\`.`)],
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(printer.status === "current" ? COLORS.brand : COLORS.neutral)
      .setTitle(`${EMOJI.printer} ${printer.name}`)
      .setURL(printer.productUrl)
      .setDescription(printer.tagline);

    if (printer.status === "legacy") {
      embed.addFields({ name: "Status", value: "Legacy model — still supported, no longer the current line-up." });
    }

    const fields: { name: string; value: string; inline: boolean }[] = [];
    if (printer.buildVolume) fields.push({ name: "Build volume", value: printer.buildVolume, inline: true });
    fields.push({ name: "Enclosed", value: printer.enclosed ? "Yes" : "No", inline: true });
    if (printer.chamberHeated !== undefined) {
      fields.push({ name: "Heated chamber", value: printer.chamberHeated ? "Yes" : "No", inline: true });
    }
    if (printer.hotendMaxC) fields.push({ name: "Max nozzle", value: `${printer.hotendMaxC} °C`, inline: true });
    if (printer.bedMaxC) fields.push({ name: "Max bed", value: `${printer.bedMaxC} °C`, inline: true });
    if (printer.camera) fields.push({ name: "Camera", value: printer.camera, inline: true });
    embed.addFields(fields);

    embed.addFields(
      { name: "Multi-material", value: printer.multiMaterial },
      { name: "Highlights", value: printer.notableFeatures.map((f) => `• ${f}`).join("\n").slice(0, 1024) },
      { name: "Best for", value: printer.goodFor },
      {
        name: "Links",
        value: `[Product page](${printer.productUrl}) • [Wiki](https://wiki.bambulab.com/en/${printer.wikiSlug})`,
      },
    );

    embed.setFooter({ text: `Specs checked ${printer.specsVerified}. Confirm on the official page before buying.` });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default printerCommand;
