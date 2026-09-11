import { z } from "zod";
import type { ModuleDefinition } from "./types";

export const moderationSchema = z.object({
  logChannelId: z.string().default(""),
  /** Public channel for transparency posts, if the server wants them. */
  publicLogChannelId: z.string().default(""),
  dmOnAction: z.boolean().default(true),
  dmTemplate: z
    .string()
    .max(2000)
    .default(
      "You received a **{case.type}** in **{server}**.\n\n**Reason:** {case.reason}\n**Duration:** {case.duration}\n**Case:** #{case.number}",
    ),
  appealUrl: z.string().default(""),
  requireReason: z.boolean().default(false),
  /** Roles that moderation commands refuse to touch, whatever the hierarchy says. */
  protectedRoles: z.array(z.string()).default([]),
  defaultTimeoutSeconds: z.number().int().min(60).max(2419200).default(3600),
  banDeleteMessageHours: z.number().int().min(0).max(168).default(0),
  purgeMaxMessages: z.number().int().min(1).max(1000).default(200),
  /** Warns older than this stop counting toward thresholds. 0 = never expire. */
  warnExpiryDays: z.number().int().min(0).max(3650).default(90),
  warnThresholds: z
    .array(
      z.object({
        count: z.number().int().min(1).max(50),
        action: z.enum(["none", "timeout", "kick", "ban"]),
        durationSeconds: z.number().int().min(60).max(2419200).default(86400),
      }),
    )
    .default([
      { count: 3, action: "timeout", durationSeconds: 86400 },
      { count: 5, action: "kick", durationSeconds: 86400 },
      { count: 7, action: "ban", durationSeconds: 86400 },
    ]),
  /** Confirm before actions affecting more than this many members. */
  bulkConfirmThreshold: z.number().int().min(1).max(100).default(5),
});

export type ModerationConfig = z.infer<typeof moderationSchema>;

export const moderationModule: ModuleDefinition<typeof moderationSchema> = {
  name: "moderation",
  schema: moderationSchema,
  ui: {
    title: "Moderation",
    description: "Case defaults, DM notices, appeal links and automatic warn thresholds.",
    icon: "gavel",
    group: "Moderation",
    sections: [
      {
        id: "general",
        title: "Cases",
        fields: [
          { path: "logChannelId", label: "Mod log channel", kind: "channel", width: "half" },
          { path: "publicLogChannelId", label: "Public mod log", kind: "channel", width: "half", description: "Optional, no reasons or moderator names." },
          { path: "requireReason", label: "Require a reason on every action", kind: "toggle" },
          { path: "protectedRoles", label: "Protected roles", kind: "roles", description: "Commands refuse to action members with these roles." },
          { path: "bulkConfirmThreshold", label: "Confirm bulk actions above", kind: "number", min: 1, max: 100, width: "half" },
          { path: "purgeMaxMessages", label: "Purge limit", kind: "number", min: 1, max: 1000, width: "half" },
        ],
      },
      {
        id: "notices",
        title: "Member notices",
        fields: [
          { path: "dmOnAction", label: "DM the member when actioned", kind: "toggle" },
          { path: "dmTemplate", label: "DM template", kind: "textarea", scopes: ["member", "guild", "case"], showIf: { path: "dmOnAction", truthy: true } },
          { path: "appealUrl", label: "Appeal link", kind: "url", description: "Included in ban and timeout DMs." },
        ],
      },
      {
        id: "defaults",
        title: "Defaults",
        fields: [
          { path: "defaultTimeoutSeconds", label: "Default timeout length", kind: "duration", width: "half" },
          { path: "banDeleteMessageHours", label: "Delete messages on ban (hours)", kind: "number", min: 0, max: 168, width: "half" },
          { path: "warnExpiryDays", label: "Warns expire after (days)", kind: "number", min: 0, max: 3650, width: "half" },
        ],
      },
      {
        id: "thresholds",
        title: "Warn thresholds",
        description: "Automatic punishment once a member reaches a warn count.",
        fields: [{ path: "warnThresholds", label: "Thresholds", kind: "custom", component: "WarnThresholdEditor" }],
      },
    ],
  },
};
