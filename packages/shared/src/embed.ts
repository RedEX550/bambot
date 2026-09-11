import { z } from "zod";
import { LIMITS } from "./constants";

/**
 * A Discord message payload that a human edits in the dashboard.
 * Everything here is template text: `{user}`, `{server}`, ... are substituted
 * at send time by the bot placeholder engine.
 */

export const hexColor = z
  .string()
  .regex(/^#?[0-9a-fA-F]{6}$/, "Must be a hex colour like #00AE42")
  .transform((v) => (v.startsWith("#") ? v : `#${v}`));

export const embedFieldSchema = z.object({
  name: z.string().min(1).max(LIMITS.embedFieldName),
  value: z.string().min(1).max(LIMITS.embedFieldValue),
  inline: z.boolean().default(false),
});

export const embedSchema = z.object({
  title: z.string().max(LIMITS.embedTitle).optional(),
  url: z.string().url().optional().or(z.literal("")),
  description: z.string().max(LIMITS.embedDescription).optional(),
  color: hexColor.optional(),
  author: z
    .object({
      name: z.string().max(LIMITS.embedAuthor),
      iconUrl: z.string().optional(),
      url: z.string().optional(),
    })
    .optional(),
  thumbnail: z.string().optional(),
  image: z.string().optional(),
  footer: z
    .object({
      text: z.string().max(LIMITS.embedFooter),
      iconUrl: z.string().optional(),
    })
    .optional(),
  timestamp: z.boolean().default(false),
  fields: z.array(embedFieldSchema).max(LIMITS.embedFields).default([]),
});

export type EmbedTemplate = z.infer<typeof embedSchema>;

export const buttonSchema = z.object({
  label: z.string().min(1).max(80),
  style: z.enum(["primary", "secondary", "success", "danger", "link"]).default("secondary"),
  emoji: z.string().max(64).optional(),
  url: z.string().optional(),
  customId: z.string().max(100).optional(),
});

export type ButtonTemplate = z.infer<typeof buttonSchema>;

/** The unit every "send a message" feature in Bambot is configured with. */
export const messagePayloadSchema = z.object({
  content: z.string().max(2000).default(""),
  embeds: z.array(embedSchema).max(10).default([]),
  buttons: z.array(buttonSchema).max(5).default([]),
  /** Ping these in the message body so the mention actually fires, then delete it. */
  ghostPing: z.boolean().default(false),
  /** Delete the message after N seconds. 0 = never. */
  deleteAfter: z.number().int().min(0).max(86400).default(0),
});

export type MessagePayload = z.infer<typeof messagePayloadSchema>;

export const emptyPayload = (): MessagePayload => ({
  content: "",
  embeds: [],
  buttons: [],
  ghostPing: false,
  deleteAfter: 0,
});
