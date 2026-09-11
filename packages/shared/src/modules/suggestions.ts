import { z } from "zod";
import type { ModuleDefinition } from "./types";

export const suggestionsSchema = z.object({
  enabled: z.boolean().default(false),
  channelId: z.string().default(""),
  /** Approved or implemented suggestions are reposted here. */
  archiveChannelId: z.string().default(""),
  reviewChannelId: z.string().default(""),
  mode: z.enum(["direct", "review"]).default("direct"),
  upvoteEmoji: z.string().max(64).default("👍"),
  downvoteEmoji: z.string().max(64).default("👎"),
  allowVoteChange: z.boolean().default(true),
  createThread: z.boolean().default(true),
  threadAutoArchiveHours: z.number().int().min(1).max(10080).default(1440),
  cooldownMinutes: z.number().int().min(0).max(10080).default(10),
  minAccountAgeHours: z.number().int().min(0).max(8760).default(24),
  requiredRoles: z.array(z.string()).default([]),
  blockedRoles: z.array(z.string()).default([]),
  dmOnStatusChange: z.boolean().default(true),
  /** Auto-deny when a suggestion drops this far below zero. 0 = off. */
  autoDenyScore: z.number().int().min(-1000).max(0).default(0),
  anonymousAllowed: z.boolean().default(false),
});

export type SuggestionsConfig = z.infer<typeof suggestionsSchema>;

export const suggestionsModule: ModuleDefinition<typeof suggestionsSchema> = {
  name: "suggestions",
  schema: suggestionsSchema,
  ui: {
    title: "Suggestions",
    description: "Collect feature ideas with voting, threads, staff review and status tracking.",
    icon: "lightbulb",
    group: "Community",
    sections: [
      {
        id: "general",
        title: "Setup",
        fields: [
          { path: "enabled", label: "Enable suggestions", kind: "toggle" },
          {
            path: "mode",
            label: "Submission flow",
            kind: "select",
            width: "half",
            options: [
              { value: "direct", label: "Post immediately" },
              { value: "review", label: "Staff approve first" },
            ],
          },
          { path: "channelId", label: "Suggestions channel", kind: "channel", width: "half" },
          { path: "reviewChannelId", label: "Review queue channel", kind: "channel", width: "half", showIf: { path: "mode", equals: "review" } },
          { path: "archiveChannelId", label: "Accepted archive", kind: "channel", width: "half" },
          { path: "createThread", label: "Open a discussion thread", kind: "toggle" },
          { path: "anonymousAllowed", label: "Allow anonymous suggestions", kind: "toggle" },
        ],
      },
      {
        id: "voting",
        title: "Voting",
        fields: [
          { path: "upvoteEmoji", label: "Upvote emoji", kind: "text", width: "half" },
          { path: "downvoteEmoji", label: "Downvote emoji", kind: "text", width: "half" },
          { path: "allowVoteChange", label: "Members can change their vote", kind: "toggle" },
          { path: "autoDenyScore", label: "Auto-deny at score", kind: "number", min: -1000, max: 0, width: "half", description: "0 disables it." },
        ],
      },
      {
        id: "limits",
        title: "Who can suggest",
        fields: [
          { path: "cooldownMinutes", label: "Cooldown per member (minutes)", kind: "number", min: 0, max: 10080, width: "half" },
          { path: "minAccountAgeHours", label: "Minimum account age (hours)", kind: "number", min: 0, max: 8760, width: "half" },
          { path: "requiredRoles", label: "Required roles", kind: "roles" },
          { path: "blockedRoles", label: "Blocked roles", kind: "roles" },
          { path: "dmOnStatusChange", label: "DM the author on status change", kind: "toggle" },
        ],
      },
    ],
  },
};
