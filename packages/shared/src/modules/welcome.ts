import { z } from "zod";
import { messagePayloadSchema } from "../embed";
import { hexColor } from "../embed";
import type { ModuleDefinition } from "./types";

export const welcomeImageSchema = z.object({
  enabled: z.boolean().default(true),
  template: z.enum(["blueprint", "spotlight", "classic", "minimal"]).default("blueprint"),
  backgroundUrl: z.string().default(""),
  backgroundColor: hexColor.default("#0B1120"),
  accentColor: hexColor.default("#00AE42"),
  textColor: hexColor.default("#FFFFFF"),
  title: z.string().max(60).default("WELCOME {user.display}"),
  subtitle: z.string().max(80).default("Member #{server.members} of {server}"),
  showAvatar: z.boolean().default(true),
  avatarShape: z.enum(["circle", "rounded", "square"]).default("circle"),
  showGrid: z.boolean().default(true),
});

export const welcomeSchema = z.object({
  enabled: z.boolean().default(false),
  channelId: z.string().default(""),
  message: messagePayloadSchema.default({
    content: "{user}",
    embeds: [
      {
        title: "Welcome to {server}, {user.display}!",
        description:
          "You are member **#{server.members}** — glad you made it.\n\n" +
          "**Start here**\n" +
          "• Read the rules and grab your printer roles so the right channels unlock\n" +
          "• Ask printing questions in the channel for your machine\n" +
          "• Need a hand from staff? Open a ticket and we will pick it up\n\n" +
          "Try `/hms` to decode an error code, `/filament` for temperature profiles, " +
          "or `/kb` to search the community knowledge base.",
        color: "#00AE42",
        timestamp: true,
        fields: [],
        footer: { text: "{server} • joined {user.created.relative} old account" },
      },
    ],
    buttons: [],
    ghostPing: false,
    deleteAfter: 0,
  }),
  image: welcomeImageSchema.default({}),
  dm: z
    .object({
      enabled: z.boolean().default(false),
      message: messagePayloadSchema.default({
        content: "",
        embeds: [
          {
            title: "Welcome to {server}",
            description:
              "Thanks for joining. A few things worth knowing:\n\n" +
              "• Staff will never DM you first about giveaways, prizes or firmware.\n" +
              "• Support requests belong in a ticket, not in DMs.\n" +
              "• You can reply to this DM to reach the moderation team.",
            color: "#00AE42",
            timestamp: false,
            fields: [],
          },
        ],
        buttons: [],
        ghostPing: false,
        deleteAfter: 0,
      }),
    })
    .default({}),
  /** Skip the welcome for accounts younger than this many hours (0 = off). */
  minAccountAgeHours: z.number().int().min(0).max(8760).default(0),
  /** Do not welcome members who leave and rejoin within this window (minutes). */
  rejoinCooldownMinutes: z.number().int().min(0).max(10080).default(0),
});

export type WelcomeConfig = z.infer<typeof welcomeSchema>;

export const welcomeModule: ModuleDefinition<typeof welcomeSchema> = {
  name: "welcome",
  schema: welcomeSchema,
  ui: {
    title: "Welcome",
    description: "Greet new members with a message, a generated banner image and an optional DM.",
    icon: "wave",
    group: "Community",
    customPage: "WelcomePage",
    sections: [
      {
        id: "general",
        title: "Welcome message",
        fields: [
          { path: "enabled", label: "Enable welcome messages", kind: "toggle" },
          {
            path: "channelId",
            label: "Welcome channel",
            kind: "channel",
            channelTypes: ["text", "announcement"],
            showIf: { path: "enabled", truthy: true },
          },
          {
            path: "message",
            label: "Message",
            kind: "message",
            scopes: ["member", "guild"],
            showIf: { path: "enabled", truthy: true },
          },
        ],
      },
      {
        id: "image",
        title: "Welcome banner",
        description: "Rendered server-side and attached to the welcome message.",
        fields: [
          { path: "image.enabled", label: "Attach a generated banner", kind: "toggle" },
          {
            path: "image.template",
            label: "Template",
            kind: "select",
            width: "half",
            options: [
              { value: "blueprint", label: "Blueprint", description: "Technical grid, Bambu green accents" },
              { value: "spotlight", label: "Spotlight", description: "Radial glow behind the avatar" },
              { value: "classic", label: "Classic", description: "Background image with a dark scrim" },
              { value: "minimal", label: "Minimal", description: "Flat colour, typography only" },
            ],
            showIf: { path: "image.enabled", truthy: true },
          },
          { path: "image.title", label: "Banner headline", kind: "text", width: "half", scopes: ["member", "guild"], showIf: { path: "image.enabled", truthy: true } },
          { path: "image.subtitle", label: "Banner subtext", kind: "text", scopes: ["member", "guild"], showIf: { path: "image.enabled", truthy: true } },
          { path: "image.backgroundUrl", label: "Background image URL", kind: "url", showIf: { path: "image.enabled", truthy: true } },
          { path: "image.backgroundColor", label: "Background colour", kind: "color", width: "half", showIf: { path: "image.enabled", truthy: true } },
          { path: "image.accentColor", label: "Accent colour", kind: "color", width: "half", showIf: { path: "image.enabled", truthy: true } },
          { path: "image.textColor", label: "Text colour", kind: "color", width: "half", showIf: { path: "image.enabled", truthy: true } },
          { path: "image.showAvatar", label: "Show avatar", kind: "toggle", showIf: { path: "image.enabled", truthy: true } },
          {
            path: "image.avatarShape",
            label: "Avatar shape",
            kind: "select",
            width: "half",
            options: [
              { value: "circle", label: "Circle" },
              { value: "rounded", label: "Rounded square" },
              { value: "square", label: "Square" },
            ],
            showIf: { path: "image.showAvatar", truthy: true },
          },
        ],
      },
      {
        id: "dm",
        title: "Welcome DM",
        description: "A private message is the best place to warn newcomers about DM scams.",
        fields: [
          { path: "dm.enabled", label: "Send a welcome DM", kind: "toggle" },
          { path: "dm.message", label: "DM content", kind: "message", scopes: ["member", "guild"], showIf: { path: "dm.enabled", truthy: true } },
        ],
      },
      {
        id: "guards",
        title: "Anti-abuse",
        description: "Stops raids from spamming your welcome channel.",
        fields: [
          {
            path: "minAccountAgeHours",
            label: "Skip accounts younger than (hours)",
            kind: "number",
            min: 0,
            max: 8760,
            width: "half",
          },
          {
            path: "rejoinCooldownMinutes",
            label: "Rejoin cooldown (minutes)",
            kind: "number",
            min: 0,
            max: 10080,
            width: "half",
            description: "A member who rejoins inside this window is not welcomed again.",
          },
        ],
      },
    ],
  },
};
