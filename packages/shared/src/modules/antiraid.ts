import { z } from "zod";
import type { ModuleDefinition } from "./types";

export const antiraidSchema = z.object({
  enabled: z.boolean().default(false),
  alertChannelId: z.string().default(""),
  alertRoleId: z.string().default(""),

  /** Join-rate trigger: N joins within M seconds flips the server into raid mode. */
  joinThreshold: z.number().int().min(2).max(200).default(10),
  joinWindowSeconds: z.number().int().min(5).max(600).default(30),

  /** What happens to members caught in the raid window. */
  action: z.enum(["alert", "quarantine", "kick", "ban"]).default("quarantine"),
  quarantineRoleId: z.string().default(""),

  /** Automatic lockdown of these channels while raid mode is on. */
  lockdownChannels: z.array(z.string()).default([]),
  lockdownAll: z.boolean().default(false),
  raidModeMinutes: z.number().int().min(1).max(1440).default(15),

  /** Gate suspicious joins even outside raid mode. */
  minAccountAgeHours: z.number().int().min(0).max(8760).default(0),
  minAccountAgeAction: z.enum(["none", "alert", "quarantine", "kick"]).default("alert"),
  noAvatarSuspicion: z.boolean().default(true),
  /** Flag joins whose usernames are near-identical to each other. */
  similarNameDetection: z.boolean().default(true),

  /** Also watch for a burst of identical messages across many members. */
  messageRaidEnabled: z.boolean().default(true),
  messageRaidUsers: z.number().int().min(2).max(100).default(5),
  messageRaidWindowSeconds: z.number().int().min(5).max(300).default(20),
});

export type AntiraidConfig = z.infer<typeof antiraidSchema>;

export const antiraidModule: ModuleDefinition<typeof antiraidSchema> = {
  name: "antiraid",
  schema: antiraidSchema,
  ui: {
    title: "Anti-raid",
    description: "Detects join floods and coordinated message bursts, then locks the server down automatically.",
    icon: "siren",
    group: "Moderation",
    sections: [
      {
        id: "detection",
        title: "Detection",
        fields: [
          { path: "enabled", label: "Enable anti-raid", kind: "toggle" },
          { path: "joinThreshold", label: "Joins", kind: "number", min: 2, max: 200, width: "half" },
          { path: "joinWindowSeconds", label: "Within (seconds)", kind: "number", min: 5, max: 600, width: "half" },
          { path: "similarNameDetection", label: "Flag near-identical usernames", kind: "toggle" },
          { path: "noAvatarSuspicion", label: "Treat default avatars as suspicious", kind: "toggle" },
        ],
      },
      {
        id: "response",
        title: "Response",
        fields: [
          {
            path: "action",
            label: "Action for raiders",
            kind: "select",
            width: "half",
            options: [
              { value: "alert", label: "Alert staff only" },
              { value: "quarantine", label: "Quarantine role" },
              { value: "kick", label: "Kick" },
              { value: "ban", label: "Ban" },
            ],
          },
          { path: "quarantineRoleId", label: "Quarantine role", kind: "role", width: "half", showIf: { path: "action", equals: "quarantine" } },
          { path: "raidModeMinutes", label: "Raid mode duration (minutes)", kind: "number", min: 1, max: 1440, width: "half" },
          { path: "lockdownAll", label: "Lock every text channel", kind: "toggle" },
          { path: "lockdownChannels", label: "Channels to lock", kind: "channels", showIf: { path: "lockdownAll", equals: false } },
          { path: "alertChannelId", label: "Alert channel", kind: "channel", width: "half" },
          { path: "alertRoleId", label: "Role to ping", kind: "role", width: "half" },
        ],
      },
      {
        id: "gate",
        title: "Join gate",
        fields: [
          { path: "minAccountAgeHours", label: "Minimum account age (hours)", kind: "number", min: 0, max: 8760, width: "half" },
          {
            path: "minAccountAgeAction",
            label: "If too young",
            kind: "select",
            width: "half",
            options: [
              { value: "none", label: "Allow" },
              { value: "alert", label: "Allow and alert" },
              { value: "quarantine", label: "Quarantine" },
              { value: "kick", label: "Kick" },
            ],
          },
        ],
      },
      {
        id: "messages",
        title: "Coordinated messages",
        fields: [
          { path: "messageRaidEnabled", label: "Detect identical messages from many members", kind: "toggle" },
          { path: "messageRaidUsers", label: "Distinct members", kind: "number", min: 2, max: 100, width: "half", showIf: { path: "messageRaidEnabled", truthy: true } },
          { path: "messageRaidWindowSeconds", label: "Within (seconds)", kind: "number", min: 5, max: 300, width: "half", showIf: { path: "messageRaidEnabled", truthy: true } },
        ],
      },
    ],
  },
};
