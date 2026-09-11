import { z } from "zod";
import { hexColor } from "../embed";
import type { ModuleDefinition } from "./types";

export const giveawaysSchema = z.object({
  enabled: z.boolean().default(false),
  hostRoles: z.array(z.string()).default([]),
  logChannelId: z.string().default(""),
  color: hexColor.default("#00AE42"),
  buttonLabel: z.string().max(80).default("Enter giveaway"),
  /** Defaults applied to every new giveaway; each can be overridden at creation. */
  defaultRequirements: z
    .object({
      minAccountAgeDays: z.number().int().min(0).max(3650).default(7),
      minServerDays: z.number().int().min(0).max(3650).default(1),
      minLevel: z.number().int().min(0).max(1000).default(0),
      requiredRoles: z.array(z.string()).default([]),
      blockedRoles: z.array(z.string()).default([]),
    })
    .default({}),
  /** Extra entries for boosters and specific roles. */
  bonusEntries: z.array(z.object({ roleId: z.string(), entries: z.number().int().min(1).max(10) })).default([]),
  dmWinners: z.boolean().default(true),
  /** Winners must claim within this many hours or get rerolled. 0 = off. */
  claimHours: z.number().int().min(0).max(168).default(24),
  requireCaptchaEntry: z.boolean().default(false),
});

export type GiveawaysConfig = z.infer<typeof giveawaysSchema>;

export const giveawaysModule: ModuleDefinition<typeof giveawaysSchema> = {
  name: "giveaways",
  schema: giveawaysSchema,
  ui: {
    title: "Giveaways",
    description: "Button-entry giveaways with eligibility rules, bonus entries and automatic rerolls.",
    icon: "gift",
    group: "Community",
    sections: [
      {
        id: "general",
        title: "General",
        fields: [
          { path: "enabled", label: "Enable giveaways", kind: "toggle" },
          { path: "hostRoles", label: "Roles that can host", kind: "roles" },
          { path: "logChannelId", label: "Log channel", kind: "channel", width: "half" },
          { path: "color", label: "Embed colour", kind: "color", width: "half" },
          { path: "buttonLabel", label: "Entry button label", kind: "text", width: "half" },
        ],
      },
      {
        id: "eligibility",
        title: "Default eligibility",
        description: "Anti-farming defaults. Alt accounts are the main problem with hardware giveaways.",
        fields: [
          { path: "defaultRequirements.minAccountAgeDays", label: "Minimum account age (days)", kind: "number", min: 0, max: 3650, width: "half" },
          { path: "defaultRequirements.minServerDays", label: "Minimum time in server (days)", kind: "number", min: 0, max: 3650, width: "half" },
          { path: "defaultRequirements.minLevel", label: "Minimum level", kind: "number", min: 0, max: 1000, width: "half" },
          { path: "defaultRequirements.requiredRoles", label: "Required roles", kind: "roles" },
          { path: "defaultRequirements.blockedRoles", label: "Blocked roles", kind: "roles" },
          { path: "bonusEntries", label: "Bonus entries", kind: "custom", component: "BonusEntryEditor" },
        ],
      },
      {
        id: "winners",
        title: "Winners",
        fields: [
          { path: "dmWinners", label: "DM winners", kind: "toggle" },
          { path: "claimHours", label: "Claim window (hours)", kind: "number", min: 0, max: 168, width: "half", description: "Unclaimed prizes reroll automatically. 0 disables." },
          { path: "requireCaptchaEntry", label: "Require a click-through confirm", kind: "toggle" },
        ],
      },
    ],
  },
};
