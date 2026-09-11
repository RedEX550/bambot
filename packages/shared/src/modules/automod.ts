import { z } from "zod";
import type { ModuleDefinition } from "./types";
import type { FieldSpec } from "../fields";

export const AUTOMOD_ACTIONS = ["none", "delete", "warn", "timeout", "kick", "ban", "quarantine"] as const;
export type AutomodAction = (typeof AUTOMOD_ACTIONS)[number];

const actionOptions = [
  { value: "none", label: "Log only", description: "Record the hit, take no action" },
  { value: "delete", label: "Delete message" },
  { value: "warn", label: "Delete + warn", description: "Creates a moderation case" },
  { value: "timeout", label: "Delete + timeout" },
  { value: "kick", label: "Delete + kick" },
  { value: "ban", label: "Delete + ban" },
  { value: "quarantine", label: "Delete + quarantine role" },
];

/** Shared shape for every rule so the UI and the engine stay uniform. */
const rule = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object({
      enabled: z.boolean().default(false),
      action: z.enum(AUTOMOD_ACTIONS).default("delete"),
      /** Timeout length in seconds when action is "timeout". */
      timeoutSeconds: z.number().int().min(10).max(2419200).default(600),
      /** Points added to the member heat score, used by the escalation ladder. */
      points: z.number().int().min(0).max(100).default(1),
      notifyUser: z.boolean().default(true),
      exemptRoles: z.array(z.string()).default([]),
      exemptChannels: z.array(z.string()).default([]),
      ...shape,
    })
    .default({} as never);

export const automodSchema = z.object({
  enabled: z.boolean().default(false),
  logChannelId: z.string().default(""),
  quarantineRoleId: z.string().default(""),
  /** Members below this account age (hours) get every rule applied strictly. */
  strictForNewAccountsHours: z.number().int().min(0).max(8760).default(72),
  /** Do not filter members who have been in the server longer than this (days). 0 = filter everyone. */
  trustAfterDays: z.number().int().min(0).max(3650).default(0),

  invites: rule({
    allowOwnServer: z.boolean().default(true),
    allowedGuildIds: z.array(z.string()).default([]),
  }),

  links: rule({
    mode: z.enum(["blocklist", "allowlist"]).default("blocklist"),
    blockedDomains: z.array(z.string()).default([]),
    allowedDomains: z
      .array(z.string())
      .default([
        "bambulab.com",
        "wiki.bambulab.com",
        "forum.bambulab.com",
        "makerworld.com",
        "blog.bambulab.com",
        "store.bambulab.com",
        "github.com",
        "printables.com",
        "thingiverse.com",
        "youtube.com",
        "youtu.be",
        "imgur.com",
        "reddit.com",
        "discord.com",
      ]),
  }),

  /**
   * Heuristic scam filter. Scores a message against phrase clusters that show up
   * in printer-giveaway and crypto scams, plus lookalike domains for bambulab.com.
   */
  scam: rule({
    threshold: z.number().int().min(1).max(20).default(3),
    blockLookalikeDomains: z.boolean().default(true),
    extraPhrases: z.array(z.string()).default([]),
    /** Also scan DMs the bot can see and warn the recipient. */
    warnOnDmReports: z.boolean().default(true),
  }),

  words: rule({
    blocked: z.array(z.string()).default([]),
    regexes: z.array(z.string()).default([]),
    /** Catch letter substitution such as f-r-e-e or f!lament. */
    fuzzy: z.boolean().default(true),
    wholeWordOnly: z.boolean().default(false),
  }),

  spam: rule({
    messages: z.number().int().min(2).max(30).default(6),
    seconds: z.number().int().min(1).max(120).default(5),
    /** Delete the whole burst, not just the last message. */
    purgeBurst: z.boolean().default(true),
  }),

  duplicates: rule({
    count: z.number().int().min(2).max(20).default(4),
    windowSeconds: z.number().int().min(5).max(600).default(60),
    crossChannel: z.boolean().default(true),
  }),

  mentions: rule({
    maxPerMessage: z.number().int().min(1).max(50).default(6),
    maxRoleMentions: z.number().int().min(0).max(20).default(2),
    banEveryoneAttempts: z.boolean().default(false),
  }),

  caps: rule({
    percent: z.number().int().min(10).max(100).default(75),
    minLength: z.number().int().min(4).max(200).default(12),
  }),

  emoji: rule({
    maxPerMessage: z.number().int().min(1).max(100).default(12),
  }),

  attachments: rule({
    blockedExtensions: z.array(z.string()).default(["exe", "bat", "cmd", "scr", "js", "vbs", "jar", "msi", "apk"]),
    maxPerMessage: z.number().int().min(1).max(20).default(10),
  }),

  walls: rule({
    maxNewlines: z.number().int().min(3).max(100).default(20),
    maxLength: z.number().int().min(100).max(4000).default(1800),
  }),

  zalgo: rule({}),

  stickers: rule({
    maxPerWindow: z.number().int().min(1).max(20).default(5),
    windowSeconds: z.number().int().min(5).max(300).default(30),
  }),

  /** Repeat offenders escalate automatically instead of piling up warnings. */
  escalation: z
    .object({
      enabled: z.boolean().default(true),
      windowMinutes: z.number().int().min(1).max(10080).default(60),
      /** Sorted ascending by points; the highest matching tier wins. */
      tiers: z
        .array(
          z.object({
            points: z.number().int().min(1).max(1000),
            action: z.enum(AUTOMOD_ACTIONS),
            timeoutSeconds: z.number().int().min(10).max(2419200).default(600),
          }),
        )
        .default([
          { points: 3, action: "timeout", timeoutSeconds: 600 },
          { points: 6, action: "timeout", timeoutSeconds: 86400 },
          { points: 10, action: "kick", timeoutSeconds: 600 },
          { points: 15, action: "ban", timeoutSeconds: 600 },
        ]),
    })
    .default({}),
});

export type AutomodConfig = z.infer<typeof automodSchema>;

/** Generates the six repeated fields every rule section shows. */
const ruleFields = (prefix: string, extra: FieldSpec[] = []): FieldSpec[] => [
  { path: `${prefix}.enabled`, label: "Enabled", kind: "toggle" },
  {
    path: `${prefix}.action`,
    label: "Action",
    kind: "select",
    width: "half",
    options: actionOptions,
    showIf: { path: `${prefix}.enabled`, truthy: true },
  },
  {
    path: `${prefix}.timeoutSeconds`,
    label: "Timeout length (seconds)",
    kind: "duration",
    width: "half",
    showIf: { path: `${prefix}.action`, equals: "timeout" },
  },
  ...extra.map((f) => ({ ...f, showIf: f.showIf ?? { path: `${prefix}.enabled`, truthy: true } })),
  {
    path: `${prefix}.points`,
    label: "Escalation points",
    kind: "number",
    min: 0,
    max: 100,
    width: "half",
    description: "Added to the member heat score for the escalation ladder.",
    showIf: { path: `${prefix}.enabled`, truthy: true },
  },
  { path: `${prefix}.notifyUser`, label: "DM the member", kind: "toggle", showIf: { path: `${prefix}.enabled`, truthy: true } },
  { path: `${prefix}.exemptRoles`, label: "Exempt roles", kind: "roles", showIf: { path: `${prefix}.enabled`, truthy: true } },
  { path: `${prefix}.exemptChannels`, label: "Exempt channels", kind: "channels", showIf: { path: `${prefix}.enabled`, truthy: true } },
];

export const automodModule: ModuleDefinition<typeof automodSchema> = {
  name: "automod",
  schema: automodSchema,
  ui: {
    title: "Automod",
    description: "Twelve independent filters with a shared escalation ladder and a scam scorer built for this community.",
    icon: "shield",
    group: "Moderation",
    sections: [
      {
        id: "general",
        title: "General",
        fields: [
          { path: "enabled", label: "Enable automod", kind: "toggle" },
          { path: "logChannelId", label: "Automod log channel", kind: "channel", width: "half" },
          { path: "quarantineRoleId", label: "Quarantine role", kind: "role", width: "half", description: "Applied by the quarantine action." },
          {
            path: "strictForNewAccountsHours",
            label: "Strict mode for accounts younger than (hours)",
            kind: "number",
            min: 0,
            max: 8760,
            width: "half",
            description: "New accounts bypass no filter, even with exempt roles.",
          },
          {
            path: "trustAfterDays",
            label: "Stop filtering members after (days)",
            kind: "number",
            min: 0,
            max: 3650,
            width: "half",
            description: "0 filters everyone. Useful to leave long-standing members alone.",
          },
        ],
      },
      {
        id: "scam",
        title: "Scam & phishing scorer",
        description:
          "Scores each message against giveaway, crypto, support-impersonation and lookalike-domain patterns. Higher threshold = fewer false positives.",
        fields: ruleFields("scam", [
          { path: "scam.threshold", label: "Score threshold", kind: "slider", min: 1, max: 10, step: 1, width: "half" },
          { path: "scam.blockLookalikeDomains", label: "Block bambulab.com lookalikes", kind: "toggle" },
          { path: "scam.extraPhrases", label: "Extra scam phrases", kind: "stringlist", placeholder: "free printer giveaway" },
        ]),
      },
      {
        id: "invites",
        title: "Discord invites",
        fields: ruleFields("invites", [
          { path: "invites.allowOwnServer", label: "Allow invites to this server", kind: "toggle" },
          { path: "invites.allowedGuildIds", label: "Allowed server IDs", kind: "stringlist" },
        ]),
      },
      {
        id: "links",
        title: "Links",
        fields: ruleFields("links", [
          {
            path: "links.mode",
            label: "Mode",
            kind: "select",
            width: "half",
            options: [
              { value: "blocklist", label: "Block listed domains" },
              { value: "allowlist", label: "Allow only listed domains" },
            ],
          },
          { path: "links.blockedDomains", label: "Blocked domains", kind: "stringlist", showIf: { path: "links.mode", equals: "blocklist" } },
          { path: "links.allowedDomains", label: "Allowed domains", kind: "stringlist" },
        ]),
      },
      {
        id: "words",
        title: "Word filter",
        fields: ruleFields("words", [
          { path: "words.blocked", label: "Blocked words", kind: "stringlist" },
          { path: "words.regexes", label: "Regex patterns", kind: "stringlist", placeholder: "(?i)buy\\s+followers" },
          { path: "words.fuzzy", label: "Catch letter substitution", kind: "toggle", description: "Matches f r e e, fr33, f!lament." },
          { path: "words.wholeWordOnly", label: "Whole words only", kind: "toggle" },
        ]),
      },
      {
        id: "spam",
        title: "Message spam",
        fields: ruleFields("spam", [
          { path: "spam.messages", label: "Messages", kind: "number", min: 2, max: 30, width: "half" },
          { path: "spam.seconds", label: "Within (seconds)", kind: "number", min: 1, max: 120, width: "half" },
          { path: "spam.purgeBurst", label: "Delete the whole burst", kind: "toggle" },
        ]),
      },
      {
        id: "duplicates",
        title: "Repeated messages",
        fields: ruleFields("duplicates", [
          { path: "duplicates.count", label: "Repeats", kind: "number", min: 2, max: 20, width: "half" },
          { path: "duplicates.windowSeconds", label: "Within (seconds)", kind: "number", min: 5, max: 600, width: "half" },
          { path: "duplicates.crossChannel", label: "Count across channels", kind: "toggle", description: "Catches the classic cross-post scam." },
        ]),
      },
      {
        id: "mentions",
        title: "Mention spam",
        fields: ruleFields("mentions", [
          { path: "mentions.maxPerMessage", label: "Max mentions per message", kind: "number", min: 1, max: 50, width: "half" },
          { path: "mentions.maxRoleMentions", label: "Max role mentions", kind: "number", min: 0, max: 20, width: "half" },
          { path: "mentions.banEveryoneAttempts", label: "Ban on @everyone attempts", kind: "toggle" },
        ]),
      },
      {
        id: "caps",
        title: "Excessive caps",
        fields: ruleFields("caps", [
          { path: "caps.percent", label: "Uppercase threshold (%)", kind: "slider", min: 10, max: 100, step: 5, width: "half" },
          { path: "caps.minLength", label: "Minimum message length", kind: "number", min: 4, max: 200, width: "half" },
        ]),
      },
      {
        id: "attachments",
        title: "Attachments",
        fields: ruleFields("attachments", [
          { path: "attachments.blockedExtensions", label: "Blocked extensions", kind: "stringlist" },
          { path: "attachments.maxPerMessage", label: "Max attachments", kind: "number", min: 1, max: 20, width: "half" },
        ]),
      },
      {
        id: "walls",
        title: "Wall of text",
        fields: ruleFields("walls", [
          { path: "walls.maxNewlines", label: "Max line breaks", kind: "number", min: 3, max: 100, width: "half" },
          { path: "walls.maxLength", label: "Max characters", kind: "number", min: 100, max: 4000, width: "half" },
        ]),
      },
      {
        id: "emoji",
        title: "Emoji spam",
        fields: ruleFields("emoji", [{ path: "emoji.maxPerMessage", label: "Max emoji per message", kind: "number", min: 1, max: 100, width: "half" }]),
      },
      {
        id: "stickers",
        title: "Sticker spam",
        fields: ruleFields("stickers", [
          { path: "stickers.maxPerWindow", label: "Max stickers", kind: "number", min: 1, max: 20, width: "half" },
          { path: "stickers.windowSeconds", label: "Within (seconds)", kind: "number", min: 5, max: 300, width: "half" },
        ]),
      },
      {
        id: "zalgo",
        title: "Zalgo & unicode abuse",
        fields: ruleFields("zalgo"),
      },
      {
        id: "escalation",
        title: "Escalation ladder",
        description: "Points from every filter accumulate per member. Crossing a tier applies the harsher action automatically.",
        fields: [
          { path: "escalation.enabled", label: "Enable escalation", kind: "toggle" },
          {
            path: "escalation.windowMinutes",
            label: "Points decay after (minutes)",
            kind: "number",
            min: 1,
            max: 10080,
            width: "half",
            showIf: { path: "escalation.enabled", truthy: true },
          },
          { path: "escalation.tiers", label: "Tiers", kind: "custom", component: "EscalationEditor", showIf: { path: "escalation.enabled", truthy: true } },
        ],
      },
    ],
  },
};
