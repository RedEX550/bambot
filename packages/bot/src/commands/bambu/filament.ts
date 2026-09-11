import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { COLORS, EMOJI } from "@bambot/shared";
import type { BotCommand } from "../../core/types";
import { FILAMENTS, findFilament } from "../../data/filaments";
import { errorEmbed } from "../../lib/embeds";

const AMS_LABEL = { yes: "Yes", "with care": "With care", no: "No — use the external spool holder" };

export const filamentCommand: BotCommand = {
  module: "bambu",
  cooldown: 3,
  data: new SlashCommandBuilder()
    .setName("filament")
    .setDescription("Temperatures, drying and handling notes for a filament")
    .addStringOption((option) =>
      option.setName("material").setDescription("PLA, PETG, ABS, TPU, PA-CF ...").setRequired(true).setAutocomplete(true),
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const matches = FILAMENTS.filter(
      (f) => f.name.toLowerCase().includes(focused) || f.aliases.some((a) => a.includes(focused)),
    ).slice(0, 25);
    await interaction.respond(matches.map((f) => ({ name: f.name, value: f.key })));
  },

  async execute(interaction) {
    const query = interaction.options.getString("material", true);
    const filament = findFilament(query);

    if (!filament) {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            `I do not have a profile for **${query}**.\n\nI know about: ${FILAMENTS.map((f) => f.name).join(", ")}.`,
          ),
        ],
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(COLORS.brand)
      .setTitle(`${EMOJI.spool} ${filament.name}`)
      .addFields(
        { name: "Nozzle", value: `${filament.nozzleC[0]}–${filament.nozzleC[1]} °C`, inline: true },
        { name: "Bed", value: `${filament.bedC[0]}–${filament.bedC[1]} °C`, inline: true },
        { name: "Part cooling", value: filament.partCooling, inline: false },
        { name: "Enclosure", value: filament.enclosureRequired ? "Required" : "Not needed", inline: true },
        { name: "Hardened nozzle", value: filament.hardenedNozzle ? "Required" : "Not needed", inline: true },
        { name: "AMS", value: AMS_LABEL[filament.amsSafe], inline: true },
      );

    if (filament.drying) {
      embed.addFields({
        name: "Drying",
        value: `${filament.drying.celsius} °C for ${filament.drying.hours} hours`,
        inline: true,
      });
    }
    if (filament.chamber) embed.addFields({ name: "Chamber", value: filament.chamber, inline: false });
    embed.addFields(
      { name: "Shrinkage", value: filament.shrinkage, inline: true },
      { name: "Notes", value: filament.tips.map((t) => `• ${t}`).join("\n").slice(0, 1024) },
    );

    embed.setFooter({ text: "Ranges are typical. The profile for your exact spool in Bambu Studio wins." });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default filamentCommand;
