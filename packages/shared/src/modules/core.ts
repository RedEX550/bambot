import { z } from "zod";
import { hexColor } from "../embed";
import { LOCALES } from "../constants";
import type { ModuleDefinition } from "./types";

export const coreSchema = z.object({
  locale: z.enum(LOCALES).default("en-US"),
  timezone: z.string().default("UTC"),
  embedColor: hexColor.default("#00AE42"),
  /** Roles that may use moderation commands. */
  modRoles: z.array(z.string()).default([]),
  /** Roles treated as staff for tickets, modmail and internal tooling. */
  staffRoles: z.array(z.string()).default([]),
  /** Roles with full dashboard write access besides server admins. */
  adminRoles: z.array(z.string()).default([]),
  /** Members with these roles are exempt from automod and raid checks. */
  exemptRoles: z.array(z.string()).default([]),
  /** Channels the bot ignores entirely (no XP, no automod, no logging). */
  ignoredChannels: z.array(z.string()).default([]),
  /** Where the bot reports its own errors and rate limits. */
  botLogChannel: z.string().default(""),
  deleteCommandReplies: z.boolean().default(false),
  ephemeralByDefault: z.boolean().default(true),
  /** Disabled slash commands (by name). */
  disabledCommands: z.array(z.string()).default([]),
});

export type CoreConfig = z.infer<typeof coreSchema>;

export const coreModule: ModuleDefinition<typeof coreSchema> = {
  name: "core",
  schema: coreSchema,
  ui: {
    title: "General",
    description: "Server-wide defaults: staff roles, language, colours and command behaviour.",
    icon: "settings",
    group: "General",
    sections: [
      {
        id: "identity",
        title: "Identity & locale",
        description: "How the bot presents itself in this server.",
        fields: [
          {
            path: "locale",
            label: "Language",
            kind: "select",
            width: "half",
            description: "Used for command responses and dashboard-generated messages.",
            options: [
              { value: "en-US", label: "English" },
              { value: "de", label: "Deutsch" },
              { value: "fr", label: "Français" },
              { value: "es-ES", label: "Español" },
              { value: "zh-CN", label: "简体中文" },
              { value: "ja", label: "日本語" },
              { value: "ko", label: "한국어" },
              { value: "pt-BR", label: "Português (BR)" },
            ],
          },
          {
            path: "timezone",
            label: "Timezone",
            kind: "text",
            width: "half",
            placeholder: "Europe/Berlin",
            description: "IANA timezone used for schedules and analytics day boundaries.",
          },
          {
            path: "embedColor",
            label: "Accent colour",
            kind: "color",
            width: "half",
            description: "Default colour for every embed the bot sends.",
          },
        ],
      },
      {
        id: "roles",
        title: "Permission roles",
        description: "Bambot checks these in addition to native Discord permissions.",
        fields: [
          { path: "adminRoles", label: "Admin roles", kind: "roles", description: "Full dashboard and bot access." },
          { path: "modRoles", label: "Moderator roles", kind: "roles", description: "May use ban, kick, timeout, warn, purge." },
          { path: "staffRoles", label: "Support staff roles", kind: "roles", description: "May claim tickets and answer modmail." },
          { path: "exemptRoles", label: "Automod-exempt roles", kind: "roles", description: "Never filtered, never rate limited." },
        ],
      },
      {
        id: "behaviour",
        title: "Command behaviour",
        fields: [
          {
            path: "ignoredChannels",
            label: "Ignored channels",
            kind: "channels",
            description: "No XP, automod, logging or auto-responders here.",
          },
          { path: "botLogChannel", label: "Bot error log", kind: "channel", width: "half" },
          {
            path: "ephemeralByDefault",
            label: "Private command replies",
            kind: "toggle",
            description: "Utility command replies are only visible to the person who ran them.",
          },
          {
            path: "deleteCommandReplies",
            label: "Auto-clean replies",
            kind: "toggle",
            description: "Remove non-ephemeral bot replies after 30 seconds.",
          },
          {
            path: "disabledCommands",
            label: "Disabled commands",
            kind: "stringlist",
            placeholder: "e.g. level",
            description: "Command names that should not respond in this server.",
          },
        ],
      },
    ],
  },
};
