import { EmbedBuilder } from "discord.js";
import { COLORS, EMOJI } from "@bambot/shared";

const base = (color: number, emoji: string, message: string, title?: string) => {
  const embed = new EmbedBuilder().setColor(color).setDescription(`${emoji} ${message}`);
  if (title) embed.setTitle(title);
  return embed;
};

export const successEmbed = (message: string, title?: string) => base(COLORS.success, EMOJI.success, message, title);
export const errorEmbed = (message: string, title?: string) => base(COLORS.danger, EMOJI.error, message, title);
export const warningEmbed = (message: string, title?: string) => base(COLORS.warning, EMOJI.warning, message, title);
export const infoEmbed = (message: string, title?: string) => base(COLORS.info, EMOJI.info, message, title);

export const brandEmbed = () => new EmbedBuilder().setColor(COLORS.brand);

/** Discord truncates silently; doing it ourselves keeps the ellipsis honest. */
export const clamp = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/** Escapes markdown so user-supplied text cannot break embed formatting. */
export const escapeMd = (text: string): string => text.replace(/([\`*_~|>])/g, "\$1");

/** A code block that is safe even if the content contains backticks. */
export const codeBlock = (content: string, lang = ""): string => {
  const safe = content.replace(/```/g, "`​``");
  return `\`\`\`${lang}\n${clamp(safe, 1900)}\n\`\`\``;
};
