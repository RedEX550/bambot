import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type APIEmbed,
  type AttachmentBuilder,
} from "discord.js";
import type { ButtonTemplate, EmbedTemplate, MessagePayload } from "@bambot/shared";
import { COLORS } from "@bambot/shared";
import { applyValues, buildValues, type PlaceholderContext, type PlaceholderValues } from "./placeholders";

const BUTTON_STYLES: Record<ButtonTemplate["style"], ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
  link: ButtonStyle.Link,
};

const parseColor = (hex?: string): number => {
  if (!hex) return COLORS.brand;
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean, 16);
  return Number.isNaN(value) ? COLORS.brand : value;
};

const trim = (value: string | undefined, max: number): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
};

/** A URL is only usable by Discord if it is http(s) or attachment://. */
const usableUrl = (value?: string): string | undefined => {
  if (!value) return undefined;
  const v = value.trim();
  if (!v) return undefined;
  return /^(https?:\/\/|attachment:\/\/)/i.test(v) ? v : undefined;
};

export const buildEmbed = (template: EmbedTemplate, values: PlaceholderValues): EmbedBuilder | null => {
  const embed = new EmbedBuilder().setColor(parseColor(template.color));
  let hasContent = false;

  const title = trim(template.title ? applyValues(template.title, values) : undefined, 256);
  if (title) {
    embed.setTitle(title);
    hasContent = true;
  }

  const description = trim(template.description ? applyValues(template.description, values) : undefined, 4096);
  if (description) {
    embed.setDescription(description);
    hasContent = true;
  }

  const url = usableUrl(template.url ? applyValues(template.url, values) : undefined);
  if (url && title) embed.setURL(url);

  if (template.author?.name) {
    const name = trim(applyValues(template.author.name, values), 256);
    if (name) {
      embed.setAuthor({
        name,
        iconURL: usableUrl(applyValues(template.author.iconUrl ?? "", values)),
        url: usableUrl(applyValues(template.author.url ?? "", values)),
      });
      hasContent = true;
    }
  }

  if (template.footer?.text) {
    const text = trim(applyValues(template.footer.text, values), 2048);
    if (text) {
      embed.setFooter({ text, iconURL: usableUrl(applyValues(template.footer.iconUrl ?? "", values)) });
      hasContent = true;
    }
  }

  const thumbnail = usableUrl(applyValues(template.thumbnail ?? "", values));
  if (thumbnail) {
    embed.setThumbnail(thumbnail);
    hasContent = true;
  }

  const image = usableUrl(applyValues(template.image ?? "", values));
  if (image) {
    embed.setImage(image);
    hasContent = true;
  }

  if (template.timestamp) embed.setTimestamp(new Date());

  for (const field of template.fields ?? []) {
    const name = trim(applyValues(field.name, values), 256);
    const value = trim(applyValues(field.value, values), 1024);
    if (!name || !value) continue;
    embed.addFields({ name, value, inline: field.inline });
    hasContent = true;
  }

  return hasContent ? embed : null;
};

export const buildButtons = (buttons: ButtonTemplate[], values: PlaceholderValues): ActionRowBuilder<ButtonBuilder>[] => {
  const built: ButtonBuilder[] = [];
  for (const button of buttons ?? []) {
    const label = trim(applyValues(button.label, values), 80);
    if (!label) continue;
    const builder = new ButtonBuilder().setLabel(label).setStyle(BUTTON_STYLES[button.style] ?? ButtonStyle.Secondary);
    if (button.emoji) {
      try {
        builder.setEmoji(button.emoji);
      } catch {
        // An emoji the bot cannot use must not break the whole message.
      }
    }
    if (button.style === "link") {
      const url = usableUrl(applyValues(button.url ?? "", values));
      if (!url) continue;
      builder.setURL(url);
    } else {
      builder.setCustomId(button.customId || `noop:${built.length}`);
    }
    built.push(builder);
  }

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < built.length; i += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(built.slice(i, i + 5)));
  }
  return rows;
};

export interface BuiltMessage {
  content: string;
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
  files: AttachmentBuilder[];
  /** Seconds after which the sender should delete the message. 0 = keep. */
  deleteAfter: number;
}

/**
 * Turns a dashboard-authored payload into something discord.js can send.
 * Guarantees a non-empty message: an entirely blank template falls back to a
 * zero-width space rather than throwing at the API boundary.
 */
export const buildMessage = (
  payload: MessagePayload,
  ctx: PlaceholderContext,
  extras?: { files?: AttachmentBuilder[]; extraEmbeds?: APIEmbed[] },
): BuiltMessage => {
  const values = buildValues(ctx);
  const content = applyValues(payload.content ?? "", values).slice(0, 2000);
  const embeds = (payload.embeds ?? []).map((e) => buildEmbed(e, values)).filter((e): e is EmbedBuilder => e !== null);
  const components = buildButtons(payload.buttons ?? [], values);
  const files = extras?.files ?? [];

  const hasSomething = content.trim().length > 0 || embeds.length > 0 || files.length > 0;

  return {
    content: hasSomething ? content : "​",
    embeds,
    components,
    files,
    deleteAfter: payload.deleteAfter ?? 0,
  };
};
