import { z } from "zod";
import type { ModuleDefinition } from "./types";

/**
 * Tags, auto-responders, sticky messages and scheduled posts all store their
 * records in dedicated tables. This module holds the shared permissions and
 * limits for that content.
 */
export const contentSchema = z.object({
  tagsEnabled: z.boolean().default(true),
  tagManagerRoles: z.array(z.string()).default([]),
  tagCooldownSeconds: z.number().int().min(0).max(600).default(3),

  kbEnabled: z.boolean().default(true),
  kbManagerRoles: z.array(z.string()).default([]),
  /** Show a helpful / not helpful prompt under KB answers to measure quality. */
  kbFeedback: z.boolean().default(true),

  autoRespondersEnabled: z.boolean().default(true),
  autoResponderIgnoredChannels: z.array(z.string()).default([]),

  stickyEnabled: z.boolean().default(true),
  scheduledEnabled: z.boolean().default(true),
  scheduledManagerRoles: z.array(z.string()).default([]),

  remindersEnabled: z.boolean().default(true),
  maxRemindersPerUser: z.number().int().min(1).max(100).default(15),
  highlightsEnabled: z.boolean().default(true),
  maxHighlightsPerUser: z.number().int().min(1).max(50).default(10),
  afkEnabled: z.boolean().default(true),
  pollsEnabled: z.boolean().default(true),
});

export type ContentConfig = z.infer<typeof contentSchema>;

export const contentModule: ModuleDefinition<typeof contentSchema> = {
  name: "content",
  schema: contentSchema,
  ui: {
    title: "Content & utilities",
    description: "Tags, knowledge base, auto-responders, sticky messages, schedules, reminders and highlights.",
    icon: "book",
    group: "Support",
    customPage: "ContentPage",
    sections: [
      {
        id: "tags",
        title: "Tags",
        fields: [
          { path: "tagsEnabled", label: "Enable tags", kind: "toggle" },
          { path: "tagManagerRoles", label: "Who can manage tags", kind: "roles" },
          { path: "tagCooldownSeconds", label: "Cooldown (seconds)", kind: "number", min: 0, max: 600, width: "half" },
        ],
      },
      {
        id: "kb",
        title: "Knowledge base",
        fields: [
          { path: "kbEnabled", label: "Enable the knowledge base", kind: "toggle" },
          { path: "kbManagerRoles", label: "Who can edit articles", kind: "roles" },
          { path: "kbFeedback", label: "Ask if the answer helped", kind: "toggle", description: "Feeds the article quality report." },
        ],
      },
      {
        id: "responders",
        title: "Auto-responders & sticky",
        fields: [
          { path: "autoRespondersEnabled", label: "Enable auto-responders", kind: "toggle" },
          { path: "autoResponderIgnoredChannels", label: "Ignored channels", kind: "channels" },
          { path: "stickyEnabled", label: "Enable sticky messages", kind: "toggle" },
        ],
      },
      {
        id: "scheduled",
        title: "Scheduled posts",
        fields: [
          { path: "scheduledEnabled", label: "Enable scheduled messages", kind: "toggle" },
          { path: "scheduledManagerRoles", label: "Who can schedule", kind: "roles" },
        ],
      },
      {
        id: "utility",
        title: "Member utilities",
        fields: [
          { path: "remindersEnabled", label: "Reminders", kind: "toggle" },
          { path: "maxRemindersPerUser", label: "Max reminders per member", kind: "number", min: 1, max: 100, width: "half" },
          { path: "highlightsEnabled", label: "Keyword highlights", kind: "toggle" },
          { path: "maxHighlightsPerUser", label: "Max highlights per member", kind: "number", min: 1, max: 50, width: "half" },
          { path: "afkEnabled", label: "AFK status", kind: "toggle" },
          { path: "pollsEnabled", label: "Polls", kind: "toggle" },
        ],
      },
    ],
  },
};
