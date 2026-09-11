import { z } from "zod";
import { messagePayloadSchema } from "../embed";
import { TICKET_PRIORITIES } from "../constants";
import type { ModuleDefinition } from "./types";

/** One field in the modal a user fills in before the ticket channel is created. */
export const ticketFormFieldSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(45),
  placeholder: z.string().max(100).default(""),
  style: z.enum(["short", "paragraph"]).default("short"),
  required: z.boolean().default(true),
  minLength: z.number().int().min(0).max(4000).default(0),
  maxLength: z.number().int().min(1).max(4000).default(1000),
});

export const ticketCategorySchema = z.object({
  key: z.string().min(1).max(40),
  label: z.string().min(1).max(80),
  emoji: z.string().max(64).default("🎫"),
  description: z.string().max(100).default(""),
  enabled: z.boolean().default(true),

  /** Where the conversation happens. Threads keep the channel list clean. */
  openMode: z.enum(["channel", "privateThread"]).default("channel"),
  parentCategoryId: z.string().default(""),
  /** Supports {number}, {user}, {user.id}, {category}. */
  naming: z.string().max(80).default("ticket-{number}"),

  supportRoles: z.array(z.string()).default([]),
  pingRoles: z.array(z.string()).default([]),
  requiredRoles: z.array(z.string()).default([]),
  blockedRoles: z.array(z.string()).default([]),

  defaultPriority: z.enum(TICKET_PRIORITIES).default("NORMAL"),
  maxOpenPerUser: z.number().int().min(1).max(10).default(1),
  /** Close automatically after this many hours with no messages. 0 = never. */
  autoCloseHours: z.number().int().min(0).max(720).default(72),
  /** Warn in-channel before auto-closing. */
  inactivityWarningHours: z.number().int().min(0).max(720).default(48),

  form: z.array(ticketFormFieldSchema).max(5).default([]),
  openingMessage: messagePayloadSchema.default({
    content: "{ticket.opener}",
    embeds: [
      {
        title: "Ticket #{ticket.number} — {ticket.category}",
        description:
          "Thanks for reaching out. A staff member will be with you shortly.\n\n" +
          "While you wait, please add anything that helps us: photos of the print or the part, " +
          "your printer model and firmware version, the slicer profile you used, and the exact error text.",
        color: "#00AE42",
        timestamp: true,
        fields: [],
      },
    ],
    buttons: [],
    ghostPing: false,
    deleteAfter: 0,
  }),
});

export type TicketCategory = z.infer<typeof ticketCategorySchema>;

export const ticketPanelSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  channelId: z.string().default(""),
  style: z.enum(["buttons", "select"]).default("buttons"),
  selectPlaceholder: z.string().max(150).default("Choose what you need help with"),
  categoryKeys: z.array(z.string()).default([]),
  message: messagePayloadSchema.default({
    content: "",
    embeds: [
      {
        title: "🎫 Contact the team",
        description:
          "Pick the option that matches your problem and a private ticket will open for you.\n\n" +
          "**Before you open a ticket**\n" +
          "• Search `/kb` and `/hms` first — most printer errors are answered instantly\n" +
          "• Community channels are usually faster for print-quality questions\n" +
          "• One ticket per issue, please\n\n" +
          "_Staff will never DM you first or ask for your password._",
        color: "#00AE42",
        timestamp: false,
        fields: [],
        footer: { text: "{server} • average first response under 30 minutes" },
      },
    ],
    buttons: [],
    ghostPing: false,
    deleteAfter: 0,
  }),
});

export type TicketPanel = z.infer<typeof ticketPanelSchema>;

const defaultCategories: unknown[] = [
  {
    key: "printer-support",
    label: "Printer Support",
    emoji: "🖨️",
    description: "Hardware faults, HMS errors, print quality",
    naming: "printer-{number}",
    defaultPriority: "NORMAL",
    form: [
      { id: "model", label: "Which printer?", placeholder: "H2D / X2D / P1S / A1 mini ...", style: "short", required: true, maxLength: 60 },
      { id: "firmware", label: "Firmware version", placeholder: "Settings > Device > Firmware", style: "short", required: false, maxLength: 40 },
      { id: "hms", label: "Error / HMS code (if any)", placeholder: "0300-0300-0001-0001", style: "short", required: false, maxLength: 40 },
      { id: "issue", label: "Describe the problem", placeholder: "What happens, when it started, what you tried", style: "paragraph", required: true, maxLength: 1500 },
    ],
  },
  {
    key: "order-shipping",
    label: "Order & Shipping",
    emoji: "📦",
    description: "Order status, delivery, missing parts",
    naming: "order-{number}",
    form: [
      { id: "order", label: "Order number", placeholder: "BL-XXXXXXXX", style: "short", required: true, maxLength: 40 },
      { id: "region", label: "Store region", placeholder: "EU / US / global", style: "short", required: true, maxLength: 30 },
      { id: "issue", label: "What do you need?", style: "paragraph", required: true, maxLength: 1500 },
    ],
  },
  {
    key: "warranty",
    label: "Warranty & RMA",
    emoji: "🛠️",
    description: "Replacement parts and returns",
    naming: "rma-{number}",
    defaultPriority: "HIGH",
    form: [
      { id: "serial", label: "Printer serial number", style: "short", required: true, maxLength: 40 },
      { id: "purchase", label: "Where and when did you buy it?", style: "short", required: true, maxLength: 100 },
      { id: "fault", label: "Describe the fault", style: "paragraph", required: true, maxLength: 1500 },
    ],
  },
  {
    key: "account",
    label: "Account & Billing",
    emoji: "💳",
    description: "Bambu account, MakerWorld points, payments",
    naming: "account-{number}",
    form: [
      { id: "topic", label: "What is this about?", placeholder: "Login, points, refund ...", style: "short", required: true, maxLength: 80 },
      { id: "detail", label: "Details", style: "paragraph", required: true, maxLength: 1500 },
    ],
  },
  {
    key: "report",
    label: "Report a member",
    emoji: "🚩",
    description: "Scams, harassment, rule breaking",
    naming: "report-{number}",
    defaultPriority: "HIGH",
    maxOpenPerUser: 3,
    form: [
      { id: "who", label: "Who are you reporting?", placeholder: "Username or user ID", style: "short", required: true, maxLength: 80 },
      { id: "what", label: "What happened?", style: "paragraph", required: true, maxLength: 1500 },
      { id: "where", label: "Where? (channel or DM)", style: "short", required: false, maxLength: 100 },
    ],
  },
  {
    key: "makerworld",
    label: "MakerWorld & Contests",
    emoji: "🌐",
    description: "Model uploads, licensing, contest entries",
    naming: "mw-{number}",
    form: [
      { id: "link", label: "Model or contest link", style: "short", required: false, maxLength: 200 },
      { id: "detail", label: "How can we help?", style: "paragraph", required: true, maxLength: 1500 },
    ],
  },
  {
    key: "other",
    label: "Something else",
    emoji: "💬",
    description: "Anything that does not fit above",
    naming: "ticket-{number}",
    form: [{ id: "detail", label: "How can we help?", style: "paragraph", required: true, maxLength: 1500 }],
  },
];

const defaultPanels: unknown[] = [
  {
    id: "main",
    name: "Main support panel",
    channelId: "",
    style: "select",
    selectPlaceholder: "Choose what you need help with",
    categoryKeys: ["printer-support", "order-shipping", "warranty", "account", "report", "makerworld", "other"],
  },
];

export const ticketsSchema = z.object({
  enabled: z.boolean().default(false),
  categories: z.array(ticketCategorySchema).max(25).default(defaultCategories as never),
  panels: z.array(ticketPanelSchema).max(10).default(defaultPanels as never),

  transcriptChannelId: z.string().default(""),
  logChannelId: z.string().default(""),
  /** Where staff are alerted when a ticket breaches its first-response target. */
  alertChannelId: z.string().default(""),
  slaMinutes: z.number().int().min(0).max(1440).default(30),

  globalMaxOpenPerUser: z.number().int().min(1).max(25).default(3),
  allowUserClose: z.boolean().default(true),
  closeConfirmation: z.boolean().default(true),
  closeReasonRequired: z.boolean().default(false),
  /** Keep the channel for a grace period so staff can reopen it. */
  deleteChannelAfterCloseMinutes: z.number().int().min(0).max(10080).default(60),
  closedCategoryId: z.string().default(""),
  saveTranscripts: z.boolean().default(true),
  dmTranscriptToOpener: z.boolean().default(true),

  claimEnabled: z.boolean().default(true),
  claimRequiredToReply: z.boolean().default(false),

  ratingsEnabled: z.boolean().default(true),
  ratingChannelId: z.string().default(""),

  blockedRoles: z.array(z.string()).default([]),
  supportHours: z
    .object({
      enabled: z.boolean().default(false),
      timezone: z.string().default("UTC"),
      startHour: z.number().int().min(0).max(23).default(9),
      endHour: z.number().int().min(0).max(23).default(18),
      days: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
      offHoursNote: z
        .string()
        .max(1000)
        .default(
          "You opened this outside our support hours, so replies may take longer. We will get to you as soon as we are back.",
        ),
    })
    .default({}),
});

export type TicketsConfig = z.infer<typeof ticketsSchema>;

export const ticketsModule: ModuleDefinition<typeof ticketsSchema> = {
  name: "tickets",
  schema: ticketsSchema,
  ui: {
    title: "Tickets",
    description: "Multi-category panels, modal intake forms, claiming, SLAs, transcripts and CSAT.",
    icon: "ticket",
    group: "Support",
    customPage: "TicketsPage",
    sections: [
      {
        id: "general",
        title: "General",
        fields: [
          { path: "enabled", label: "Enable the ticket system", kind: "toggle" },
          { path: "logChannelId", label: "Ticket log channel", kind: "channel", width: "half" },
          { path: "transcriptChannelId", label: "Transcript archive channel", kind: "channel", width: "half" },
          { path: "alertChannelId", label: "SLA breach alerts", kind: "channel", width: "half" },
          {
            path: "slaMinutes",
            label: "First response target (minutes)",
            kind: "number",
            min: 0,
            max: 1440,
            width: "half",
            description: "0 disables SLA tracking. Breaches are posted to the alert channel.",
          },
        ],
      },
      {
        id: "panels",
        title: "Panels",
        description: "The message users click to open a ticket. Publish pushes it to Discord.",
        fields: [{ path: "panels", label: "Panels", kind: "custom", component: "TicketPanelEditor" }],
      },
      {
        id: "categories",
        title: "Categories & intake forms",
        fields: [{ path: "categories", label: "Categories", kind: "custom", component: "TicketCategoryEditor" }],
      },
      {
        id: "workflow",
        title: "Workflow",
        fields: [
          { path: "claimEnabled", label: "Staff can claim tickets", kind: "toggle" },
          { path: "claimRequiredToReply", label: "Only the claimer may reply", kind: "toggle", showIf: { path: "claimEnabled", truthy: true } },
          { path: "allowUserClose", label: "Users can close their own ticket", kind: "toggle" },
          { path: "closeConfirmation", label: "Ask for confirmation before closing", kind: "toggle" },
          { path: "closeReasonRequired", label: "Require a close reason", kind: "toggle" },
          { path: "globalMaxOpenPerUser", label: "Max open tickets per user", kind: "number", min: 1, max: 25, width: "half" },
          {
            path: "deleteChannelAfterCloseMinutes",
            label: "Delete channel after close (minutes)",
            kind: "number",
            min: 0,
            max: 10080,
            width: "half",
            description: "0 keeps the channel forever. Transcripts are saved either way.",
          },
          { path: "closedCategoryId", label: "Move closed tickets to", kind: "channel", channelTypes: ["category"], width: "half" },
          { path: "blockedRoles", label: "Roles blocked from tickets", kind: "roles" },
        ],
      },
      {
        id: "transcripts",
        title: "Transcripts & feedback",
        fields: [
          { path: "saveTranscripts", label: "Save HTML transcripts", kind: "toggle" },
          { path: "dmTranscriptToOpener", label: "DM the transcript to the opener", kind: "toggle", showIf: { path: "saveTranscripts", truthy: true } },
          { path: "ratingsEnabled", label: "Ask for a star rating on close", kind: "toggle" },
          { path: "ratingChannelId", label: "Post ratings to", kind: "channel", width: "half", showIf: { path: "ratingsEnabled", truthy: true } },
        ],
      },
      {
        id: "hours",
        title: "Support hours",
        fields: [
          { path: "supportHours.enabled", label: "Show an out-of-hours notice", kind: "toggle" },
          { path: "supportHours.timezone", label: "Timezone", kind: "text", width: "half", placeholder: "Europe/Berlin", showIf: { path: "supportHours.enabled", truthy: true } },
          { path: "supportHours.startHour", label: "Opens at (hour)", kind: "number", min: 0, max: 23, width: "half", showIf: { path: "supportHours.enabled", truthy: true } },
          { path: "supportHours.endHour", label: "Closes at (hour)", kind: "number", min: 0, max: 23, width: "half", showIf: { path: "supportHours.enabled", truthy: true } },
          { path: "supportHours.offHoursNote", label: "Out-of-hours notice", kind: "textarea", showIf: { path: "supportHours.enabled", truthy: true } },
        ],
      },
    ],
  },
};
