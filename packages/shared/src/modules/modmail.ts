import { z } from "zod";
import { messagePayloadSchema } from "../embed";
import type { ModuleDefinition } from "./types";

export const modmailSchema = z.object({
  enabled: z.boolean().default(false),
  categoryId: z.string().default(""),
  logChannelId: z.string().default(""),
  staffRoles: z.array(z.string()).default([]),
  pingRoles: z.array(z.string()).default([]),
  /** Staff replies show the server name instead of the responder. */
  anonymousStaff: z.boolean().default(true),
  /** Members must have been in the server this long before using modmail. */
  minServerMinutes: z.number().int().min(0).max(43200).default(10),
  cooldownSeconds: z.number().int().min(0).max(3600).default(30),
  autoCloseHours: z.number().int().min(0).max(720).default(72),
  saveTranscripts: z.boolean().default(true),
  blockedUsers: z.array(z.string()).default([]),
  greeting: messagePayloadSchema.default({
    content: "",
    embeds: [
      {
        title: "Message received",
        description:
          "Thanks — the moderation team can see this thread now and will reply here. " +
          "Anything you send in this DM is forwarded to staff.\n\n" +
          "For printer or order help, please use the ticket panel in the server instead: it reaches the support team directly.",
        color: "#00AE42",
        timestamp: false,
        fields: [],
      },
    ],
    buttons: [],
    ghostPing: false,
    deleteAfter: 0,
  }),
  closingMessage: z.string().max(2000).default("This modmail thread has been closed. Reply again if you need anything else."),
});

export type ModmailConfig = z.infer<typeof modmailSchema>;

export const modmailModule: ModuleDefinition<typeof modmailSchema> = {
  name: "modmail",
  schema: modmailSchema,
  ui: {
    title: "Modmail",
    description: "Members DM the bot; staff answer from a private channel. Ideal for reports and appeals.",
    icon: "mail",
    group: "Support",
    sections: [
      {
        id: "general",
        title: "Setup",
        fields: [
          { path: "enabled", label: "Enable modmail", kind: "toggle" },
          { path: "categoryId", label: "Thread category", kind: "channel", channelTypes: ["category"], width: "half" },
          { path: "logChannelId", label: "Log channel", kind: "channel", width: "half" },
          { path: "staffRoles", label: "Staff roles", kind: "roles" },
          { path: "pingRoles", label: "Ping on new thread", kind: "roles" },
          { path: "anonymousStaff", label: "Hide which staff member replied", kind: "toggle" },
        ],
      },
      {
        id: "limits",
        title: "Limits",
        fields: [
          { path: "minServerMinutes", label: "Minimum time in server (minutes)", kind: "number", min: 0, max: 43200, width: "half" },
          { path: "cooldownSeconds", label: "Message cooldown (seconds)", kind: "number", min: 0, max: 3600, width: "half" },
          { path: "autoCloseHours", label: "Auto-close after inactivity (hours)", kind: "number", min: 0, max: 720, width: "half" },
          { path: "saveTranscripts", label: "Save transcripts", kind: "toggle" },
          { path: "blockedUsers", label: "Blocked user IDs", kind: "stringlist" },
        ],
      },
      {
        id: "messages",
        title: "Messages",
        fields: [
          { path: "greeting", label: "Auto-reply on first message", kind: "message", scopes: ["member", "guild"] },
          { path: "closingMessage", label: "Closing message", kind: "textarea", scopes: ["member", "guild"] },
        ],
      },
    ],
  },
};
