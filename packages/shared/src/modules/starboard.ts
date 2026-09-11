import { z } from "zod";
import { hexColor } from "../embed";
import type { ModuleDefinition } from "./types";

export const starboardSchema = z.object({
  enabled: z.boolean().default(false),
  channelId: z.string().default(""),
  emoji: z.string().max(64).default("⭐"),
  threshold: z.number().int().min(1).max(100).default(5),
  color: hexColor.default("#FACC15"),
  /** Let people star their own posts. Usually a bad idea. */
  allowSelfStar: z.boolean().default(false),
  allowBotMessages: z.boolean().default(false),
  ignoredChannels: z.array(z.string()).default([]),
  /** Only accept stars from members with one of these roles (empty = anyone). */
  requiredRoles: z.array(z.string()).default([]),
  /** Remove the starboard post if the count falls back below the threshold. */
  removeWhenUnstarred: z.boolean().default(true),
  /** Show the star count live in the starboard message. */
  showCount: z.boolean().default(true),
  /** Ideal for a #showcase channel: auto-star anything with an image. */
  nsfwAllowed: z.boolean().default(false),
});

export type StarboardConfig = z.infer<typeof starboardSchema>;

export const starboardModule: ModuleDefinition<typeof starboardSchema> = {
  name: "starboard",
  schema: starboardSchema,
  ui: {
    title: "Starboard",
    description: "Promote the best prints and posts into a highlight channel.",
    icon: "star",
    group: "Community",
    sections: [
      {
        id: "general",
        title: "Starboard",
        fields: [
          { path: "enabled", label: "Enable starboard", kind: "toggle" },
          { path: "channelId", label: "Starboard channel", kind: "channel", width: "half" },
          { path: "emoji", label: "Emoji", kind: "text", width: "half" },
          { path: "threshold", label: "Reactions needed", kind: "number", min: 1, max: 100, width: "half" },
          { path: "color", label: "Embed colour", kind: "color", width: "half" },
          { path: "ignoredChannels", label: "Ignored channels", kind: "channels" },
          { path: "requiredRoles", label: "Only count stars from", kind: "roles" },
          { path: "allowSelfStar", label: "Allow self-starring", kind: "toggle" },
          { path: "allowBotMessages", label: "Allow bot messages", kind: "toggle" },
          { path: "removeWhenUnstarred", label: "Remove when stars drop below the threshold", kind: "toggle" },
          { path: "showCount", label: "Show live star count", kind: "toggle" },
          { path: "nsfwAllowed", label: "Allow posts from age-restricted channels", kind: "toggle" },
        ],
      },
    ],
  },
};
