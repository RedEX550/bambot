import { z } from "zod";
import { messagePayloadSchema } from "../embed";
import type { ModuleDefinition } from "./types";

export const verificationSchema = z.object({
  enabled: z.boolean().default(false),
  channelId: z.string().default(""),
  verifiedRoleId: z.string().default(""),
  unverifiedRoleId: z.string().default(""),
  removeUnverifiedOnPass: z.boolean().default(true),

  mode: z.enum(["button", "captcha", "rules"]).default("button"),
  /** Length of the generated code for captcha mode. */
  captchaLength: z.number().int().min(4).max(8).default(5),
  captchaAttempts: z.number().int().min(1).max(10).default(3),
  /** Kick members who never verify within this many minutes. 0 = never. */
  kickAfterMinutes: z.number().int().min(0).max(10080).default(0),
  /** Members must wait this long after joining before verifying. Defeats join-and-spam bots. */
  minWaitSeconds: z.number().int().min(0).max(3600).default(0),
  logChannelId: z.string().default(""),

  message: messagePayloadSchema.default({
    content: "",
    embeds: [
      {
        title: "🔒 Verify to unlock {server}",
        description:
          "Press the button below to confirm you are a person and open up the rest of the server.\n\n" +
          "By verifying you agree to follow the server rules and Discord Terms of Service.",
        color: "#00AE42",
        timestamp: false,
        fields: [],
      },
    ],
    buttons: [],
    ghostPing: false,
    deleteAfter: 0,
  }),
  buttonLabel: z.string().max(80).default("Verify me"),
  successMessage: z.string().max(1000).default("You are verified. Welcome to {server}!"),
});

export type VerificationConfig = z.infer<typeof verificationSchema>;

export const verificationModule: ModuleDefinition<typeof verificationSchema> = {
  name: "verification",
  schema: verificationSchema,
  ui: {
    title: "Verification",
    description: "Gate the server behind a button, a code challenge or rules acceptance.",
    icon: "lock",
    group: "Moderation",
    sections: [
      {
        id: "general",
        title: "Setup",
        fields: [
          { path: "enabled", label: "Enable verification", kind: "toggle" },
          {
            path: "mode",
            label: "Method",
            kind: "select",
            width: "half",
            options: [
              { value: "button", label: "Single button", description: "Lowest friction" },
              { value: "captcha", label: "Code challenge", description: "Type a generated code in a modal" },
              { value: "rules", label: "Rules acceptance", description: "Shows the rules, then confirm" },
            ],
          },
          { path: "channelId", label: "Verification channel", kind: "channel", width: "half" },
          { path: "verifiedRoleId", label: "Role to grant", kind: "role", width: "half" },
          { path: "unverifiedRoleId", label: "Unverified role", kind: "role", width: "half", description: "Optional gate role given on join." },
          { path: "removeUnverifiedOnPass", label: "Remove the unverified role on success", kind: "toggle" },
          { path: "logChannelId", label: "Log channel", kind: "channel", width: "half" },
        ],
      },
      {
        id: "challenge",
        title: "Challenge",
        fields: [
          { path: "captchaLength", label: "Code length", kind: "number", min: 4, max: 8, width: "half", showIf: { path: "mode", equals: "captcha" } },
          { path: "captchaAttempts", label: "Attempts allowed", kind: "number", min: 1, max: 10, width: "half", showIf: { path: "mode", equals: "captcha" } },
          { path: "minWaitSeconds", label: "Minimum wait after join (seconds)", kind: "number", min: 0, max: 3600, width: "half" },
          { path: "kickAfterMinutes", label: "Kick unverified after (minutes)", kind: "number", min: 0, max: 10080, width: "half" },
        ],
      },
      {
        id: "message",
        title: "Panel",
        fields: [
          { path: "message", label: "Verification panel", kind: "message", scopes: ["guild"] },
          { path: "buttonLabel", label: "Button label", kind: "text", width: "half" },
          { path: "successMessage", label: "Success reply", kind: "text", scopes: ["member", "guild"] },
        ],
      },
    ],
  },
};
