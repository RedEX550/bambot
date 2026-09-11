import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { COLORS } from "@bambot/shared";
import type { BotCommand } from "../../core/types";

const FALLBACK = {
  currency: "EUR",
  filamentPricePerKg: 20,
  powerCostPerKwh: 0.3,
  printerWattage: 120,
  failureRatePercent: 10,
  spoolWeightGrams: 250,
};

export const costCommand: BotCommand = {
  module: "bambu",
  cooldown: 3,
  data: new SlashCommandBuilder()
    .setName("cost")
    .setDescription("Work out what a print actually costs in filament and power")
    .addNumberOption((option) =>
      option
        .setName("grams")
        .setDescription("Filament used, from the slicer")
        .setRequired(true)
        .setMinValue(0.1)
        .setMaxValue(50000),
    )
    .addNumberOption((option) =>
      option.setName("hours").setDescription("Estimated print time in hours").setRequired(true).setMinValue(0).setMaxValue(1000),
    )
    .addNumberOption((option) =>
      option
        .setName("price_per_kg")
        .setDescription("Overrides the server default")
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(1000),
    )
    .addNumberOption((option) =>
      option
        .setName("power_per_kwh")
        .setDescription("Overrides the server default")
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(10),
    )
    .addIntegerOption((option) =>
      option.setName("quantity").setDescription("How many copies").setRequired(false).setMinValue(1).setMaxValue(10000),
    ),

  async execute(interaction, client) {
    const defaults = interaction.guildId
      ? (await client.config.get(interaction.guildId, "bambu")).calculator
      : FALLBACK;

    const grams = interaction.options.getNumber("grams", true);
    const hours = interaction.options.getNumber("hours", true);
    const quantity = interaction.options.getInteger("quantity") ?? 1;
    const pricePerKg = interaction.options.getNumber("price_per_kg") ?? defaults.filamentPricePerKg;
    const powerPerKwh = interaction.options.getNumber("power_per_kwh") ?? defaults.powerCostPerKwh;

    const filamentCost = (grams / 1000) * pricePerKg;
    const powerCost = (defaults.printerWattage / 1000) * hours * powerPerKwh;
    const unitCost = filamentCost + powerCost;
    const totalCost = unitCost * quantity;
    const withFailures = totalCost * (1 + defaults.failureRatePercent / 100);

    const money = (value: number) => `${value.toFixed(2)} ${defaults.currency}`;

    const embed = new EmbedBuilder()
      .setColor(COLORS.brand)
      .setTitle("🧮 Print cost")
      .setDescription(quantity > 1 ? `**${quantity} ×** ${grams} g / ${hours} h each` : `${grams} g of filament over ${hours} hours`)
      .addFields(
        { name: "Filament", value: money(filamentCost * quantity), inline: true },
        { name: "Electricity", value: money(powerCost * quantity), inline: true },
        { name: "Total", value: `**${money(totalCost)}**`, inline: true },
      );

    if (quantity > 1) embed.addFields({ name: "Per unit", value: money(unitCost), inline: true });

    if (defaults.failureRatePercent > 0) {
      embed.addFields({
        name: `Allowing for ${defaults.failureRatePercent}% failures`,
        value: money(withFailures),
        inline: true,
      });
    }

    embed.setFooter({
      text: `Based on ${pricePerKg}/kg, ${powerPerKwh}/kWh and ${defaults.printerWattage} W average draw — staff set these on the dashboard.`,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default costCommand;
