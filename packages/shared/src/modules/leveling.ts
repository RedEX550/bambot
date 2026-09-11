import { z } from "zod";
import { hexColor, messagePayloadSchema } from "../embed";
import type { ModuleDefinition } from "./types";

export const levelingSchema = z.object({
  enabled: z.boolean().default(false),
  xpPerMessage: z.tuple([z.number().int().min(0), z.number().int().min(0)]).default([15, 25]),
  cooldownSeconds: z.number().int().min(0).max(3600).default(60),
  /** XP awarded per minute in a voice channel with at least one other human. */
  voiceXpPerMinute: z.number().int().min(0).max(100).default(5),
  /** Curve: xp needed for level n = base * n^exponent. */
  curveBase: z.number().int().min(10).max(1000).default(100),
  curveExponent: z.number().min(1).max(3).default(1.6),

  announce: z.enum(["off", "channel", "dm", "reply"]).default("reply"),
  announceChannelId: z.string().default(""),
  announceMessage: messagePayloadSchema.default({
    content: "",
    embeds: [
      {
        title: "Level {level}",
        description: "{user} just reached **level {level}** — {level.rank} on the leaderboard.",
        color: "#00AE42",
        timestamp: false,
        fields: [],
      },
    ],
    buttons: [],
    ghostPing: false,
    deleteAfter: 30,
  }),
  /** Only announce every N levels, to keep busy servers quiet. */
  announceEvery: z.number().int().min(1).max(50).default(1),

  noXpChannels: z.array(z.string()).default([]),
  noXpRoles: z.array(z.string()).default([]),
  /** Multipliers applied to specific roles or channels. */
  multipliers: z
    .array(z.object({ type: z.enum(["role", "channel"]), id: z.string(), factor: z.number().min(0).max(10) }))
    .default([]),

  card: z
    .object({
      accentColor: hexColor.default("#00AE42"),
      backgroundColor: hexColor.default("#0B1120"),
      backgroundUrl: z.string().default(""),
      allowMemberCustomisation: z.boolean().default(true),
    })
    .default({}),

  leaderboardPublic: z.boolean().default(true),
  /** Wipe XP when a member leaves. */
  resetOnLeave: z.boolean().default(false),
});

export type LevelingConfig = z.infer<typeof levelingSchema>;

export const levelingModule: ModuleDefinition<typeof levelingSchema> = {
  name: "leveling",
  schema: levelingSchema,
  ui: {
    title: "Levels & XP",
    description: "Message and voice XP, a rendered rank card, role rewards and a public leaderboard.",
    icon: "trending-up",
    group: "Community",
    sections: [
      {
        id: "general",
        title: "Earning XP",
        fields: [
          { path: "enabled", label: "Enable levelling", kind: "toggle" },
          { path: "xpPerMessage", label: "XP per message (min/max)", kind: "custom", component: "RangeEditor", width: "half" },
          { path: "cooldownSeconds", label: "XP cooldown (seconds)", kind: "number", min: 0, max: 3600, width: "half" },
          { path: "voiceXpPerMinute", label: "Voice XP per minute", kind: "number", min: 0, max: 100, width: "half" },
          { path: "curveBase", label: "Curve base", kind: "number", min: 10, max: 1000, width: "half", description: "XP for level 1." },
          { path: "curveExponent", label: "Curve exponent", kind: "slider", min: 1, max: 3, step: 0.1, width: "half" },
          { path: "noXpChannels", label: "No-XP channels", kind: "channels" },
          { path: "noXpRoles", label: "No-XP roles", kind: "roles" },
          { path: "multipliers", label: "Multipliers", kind: "custom", component: "MultiplierEditor" },
        ],
      },
      {
        id: "announce",
        title: "Level-up announcements",
        fields: [
          {
            path: "announce",
            label: "Where to announce",
            kind: "select",
            width: "half",
            options: [
              { value: "off", label: "Do not announce" },
              { value: "reply", label: "Reply in the same channel" },
              { value: "channel", label: "A dedicated channel" },
              { value: "dm", label: "Direct message" },
            ],
          },
          { path: "announceChannelId", label: "Announcement channel", kind: "channel", width: "half", showIf: { path: "announce", equals: "channel" } },
          { path: "announceEvery", label: "Announce every N levels", kind: "number", min: 1, max: 50, width: "half" },
          { path: "announceMessage", label: "Announcement", kind: "message", scopes: ["member", "guild", "level"] },
        ],
      },
      {
        id: "card",
        title: "Rank card",
        fields: [
          { path: "card.accentColor", label: "Accent colour", kind: "color", width: "half" },
          { path: "card.backgroundColor", label: "Background colour", kind: "color", width: "half" },
          { path: "card.backgroundUrl", label: "Background image URL", kind: "url" },
          { path: "card.allowMemberCustomisation", label: "Let members set their own card colour", kind: "toggle" },
        ],
      },
      {
        id: "misc",
        title: "Leaderboard",
        fields: [
          { path: "leaderboardPublic", label: "Anyone can view the leaderboard", kind: "toggle" },
          { path: "resetOnLeave", label: "Reset XP when a member leaves", kind: "toggle" },
        ],
      },
    ],
  },
};
