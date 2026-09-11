import { z } from "zod";
import type { ModuleDefinition } from "./types";

/**
 * The Bambu Lab integrations. Everything here is built on sources that are
 * actually stable: the wiki HMS deep-link scheme, the BambuStudio GitHub
 * releases API, and Open Graph tags on makerworld.com model pages.
 *
 * MakerWorld has no public search API (server-side requests return empty
 * results), so this module enriches links people post rather than pretending
 * to search a catalogue it cannot reach.
 */

export const RELEASE_SOURCES = [
  "bambustudio",
  "orcaslicer",
  "firmware-x1",
  "firmware-p1",
  "firmware-a1",
  "firmware-h2",
] as const;

export const bambuSchema = z.object({
  enabled: z.boolean().default(true),

  /** Which wiki locale HMS and wiki lookups deep-link into. */
  wikiLocale: z.enum(["en", "de", "fr", "es", "ja", "zh"]).default("en"),

  hms: z
    .object({
      enabled: z.boolean().default(true),
      /** Detect a bare HMS code in normal chat and offer the lookup. */
      autoDetectInChat: z.boolean().default(true),
      autoDetectChannels: z.array(z.string()).default([]),
      /** Post the answer publicly instead of only to the person who asked. */
      publicReplies: z.boolean().default(true),
    })
    .default({}),

  releases: z
    .object({
      enabled: z.boolean().default(false),
      channelId: z.string().default(""),
      pingRoleId: z.string().default(""),
      sources: z.array(z.enum(RELEASE_SOURCES)).default(["bambustudio"]),
      includePrerelease: z.boolean().default(false),
      checkIntervalMinutes: z.number().int().min(10).max(1440).default(30),
      /** Open a discussion thread under each announcement. */
      createThread: z.boolean().default(true),
    })
    .default({}),

  makerworld: z
    .object({
      enabled: z.boolean().default(true),
      /** Expand makerworld.com links into a rich preview card. */
      autoEmbedLinks: z.boolean().default(true),
      /** Channels where a bare link is turned into a showcase post. */
      showcaseChannelIds: z.array(z.string()).default([]),
      /** React to showcase posts so the starboard can pick them up. */
      autoReactShowcase: z.boolean().default(true),
      showcaseEmoji: z.string().max(64).default("⭐"),
    })
    .default({}),

  /**
   * Watches busy support channels for questions that exactly match a knowledge
   * base article and offers the answer. Deliberately conservative: it suggests,
   * it does not lecture.
   */
  autoAnswer: z
    .object({
      enabled: z.boolean().default(false),
      channelIds: z.array(z.string()).default([]),
      forumChannelIds: z.array(z.string()).default([]),
      /** 0-100. Below this the bot stays quiet. */
      minConfidence: z.number().int().min(30).max(100).default(70),
      /** Reply privately to the asker instead of in the channel. */
      ephemeral: z.boolean().default(false),
      cooldownSeconds: z.number().int().min(0).max(3600).default(120),
      /** Add a "did this help?" prompt that closes the forum post when clicked. */
      offerSolvedButton: z.boolean().default(true),
      solvedTagName: z.string().max(40).default("Solved"),
    })
    .default({}),

  /** Defaults for /cost so members get sensible numbers without arguments. */
  calculator: z
    .object({
      currency: z.string().max(8).default("EUR"),
      filamentPricePerKg: z.number().min(0).max(1000).default(20),
      spoolWeightGrams: z.number().int().min(0).max(5000).default(250),
      powerCostPerKwh: z.number().min(0).max(10).default(0.3),
      printerWattage: z.number().int().min(10).max(5000).default(120),
      failureRatePercent: z.number().int().min(0).max(100).default(10),
    })
    .default({}),

  /** A role per printer model, granted from /printer or a role menu. */
  printerRoles: z.array(z.object({ model: z.string(), roleId: z.string() })).default([]),

  /**
   * Extra warning shown on scam-prone topics. Bambu giveaways attract
   * impersonators, so this is on by default.
   */
  scamNotice: z
    .object({
      enabled: z.boolean().default(true),
      text: z
        .string()
        .max(1000)
        .default(
          "Bambu Lab staff will never DM you first, never ask for your password or wallet, and never run giveaways over DM. Report impersonators with a ticket.",
        ),
    })
    .default({}),
});

export type BambuConfig = z.infer<typeof bambuSchema>;

export const bambuModule: ModuleDefinition<typeof bambuSchema> = {
  name: "bambu",
  schema: bambuSchema,
  ui: {
    title: "Bambu Lab tools",
    description: "HMS lookup, release watching, MakerWorld previews, knowledge-base auto-answers and print cost maths.",
    icon: "printer",
    group: "Bambu Lab",
    sections: [
      {
        id: "general",
        title: "General",
        fields: [
          { path: "enabled", label: "Enable Bambu Lab tools", kind: "toggle" },
          {
            path: "wikiLocale",
            label: "Wiki language",
            kind: "select",
            width: "half",
            description: "Which locale HMS and wiki deep links point at.",
            options: [
              { value: "en", label: "English" },
              { value: "de", label: "Deutsch" },
              { value: "fr", label: "Français" },
              { value: "es", label: "Español" },
              { value: "ja", label: "日本語" },
              { value: "zh", label: "中文" },
            ],
          },
        ],
      },
      {
        id: "hms",
        title: "HMS error lookup",
        description: "Decodes codes like 0300-0300-0001-0001 into the affected subsystem, fixes and the exact wiki page.",
        fields: [
          { path: "hms.enabled", label: "Enable /hms", kind: "toggle" },
          { path: "hms.autoDetectInChat", label: "Offer a lookup when a code is posted in chat", kind: "toggle" },
          { path: "hms.autoDetectChannels", label: "Only in these channels", kind: "channels", showIf: { path: "hms.autoDetectInChat", truthy: true } },
          { path: "hms.publicReplies", label: "Answer publicly", kind: "toggle" },
        ],
      },
      {
        id: "releases",
        title: "Firmware & software watcher",
        description: "Polls the BambuStudio releases API and the wiki firmware history pages, then posts what changed.",
        fields: [
          { path: "releases.enabled", label: "Announce new releases", kind: "toggle" },
          { path: "releases.channelId", label: "Announcement channel", kind: "channel", width: "half" },
          { path: "releases.pingRoleId", label: "Role to ping", kind: "role", width: "half" },
          {
            path: "releases.sources",
            label: "Sources",
            kind: "multiselect",
            options: [
              { value: "bambustudio", label: "Bambu Studio", description: "GitHub releases" },
              { value: "orcaslicer", label: "OrcaSlicer", description: "GitHub releases" },
              { value: "firmware-x1", label: "X1 / X1C firmware" },
              { value: "firmware-p1", label: "P1P / P1S firmware" },
              { value: "firmware-a1", label: "A1 / A1 mini firmware" },
              { value: "firmware-h2", label: "H2 series firmware" },
            ],
          },
          { path: "releases.includePrerelease", label: "Include beta releases", kind: "toggle" },
          { path: "releases.createThread", label: "Open a discussion thread", kind: "toggle" },
          { path: "releases.checkIntervalMinutes", label: "Check every (minutes)", kind: "number", min: 10, max: 1440, width: "half" },
        ],
      },
      {
        id: "makerworld",
        title: "MakerWorld",
        fields: [
          { path: "makerworld.enabled", label: "Enable MakerWorld features", kind: "toggle" },
          { path: "makerworld.autoEmbedLinks", label: "Expand model links into preview cards", kind: "toggle" },
          { path: "makerworld.showcaseChannelIds", label: "Showcase channels", kind: "channels" },
          { path: "makerworld.autoReactShowcase", label: "Auto-react to showcase posts", kind: "toggle" },
          { path: "makerworld.showcaseEmoji", label: "Showcase reaction", kind: "text", width: "half" },
        ],
      },
      {
        id: "autoanswer",
        title: "Knowledge base auto-answer",
        description: "Suggests an article when a question closely matches one. Conservative by design.",
        fields: [
          { path: "autoAnswer.enabled", label: "Enable auto-answer", kind: "toggle" },
          { path: "autoAnswer.channelIds", label: "Text channels to watch", kind: "channels" },
          { path: "autoAnswer.forumChannelIds", label: "Forum channels to watch", kind: "channels", channelTypes: ["forum"] },
          { path: "autoAnswer.minConfidence", label: "Confidence threshold", kind: "slider", min: 30, max: 100, step: 5, width: "half" },
          { path: "autoAnswer.cooldownSeconds", label: "Cooldown per channel (seconds)", kind: "number", min: 0, max: 3600, width: "half" },
          { path: "autoAnswer.ephemeral", label: "Reply privately", kind: "toggle" },
          { path: "autoAnswer.offerSolvedButton", label: "Offer a mark-as-solved button", kind: "toggle" },
          { path: "autoAnswer.solvedTagName", label: "Solved forum tag name", kind: "text", width: "half", showIf: { path: "autoAnswer.offerSolvedButton", truthy: true } },
        ],
      },
      {
        id: "calculator",
        title: "Print cost defaults",
        fields: [
          { path: "calculator.currency", label: "Currency", kind: "text", width: "half" },
          { path: "calculator.filamentPricePerKg", label: "Filament price per kg", kind: "number", min: 0, max: 1000, step: 0.5, width: "half" },
          { path: "calculator.spoolWeightGrams", label: "Empty spool weight (g)", kind: "number", min: 0, max: 5000, width: "half" },
          { path: "calculator.powerCostPerKwh", label: "Electricity price per kWh", kind: "number", min: 0, max: 10, step: 0.01, width: "half" },
          { path: "calculator.printerWattage", label: "Average printer draw (W)", kind: "number", min: 10, max: 5000, width: "half" },
          { path: "calculator.failureRatePercent", label: "Assumed failure rate (%)", kind: "slider", min: 0, max: 100, step: 5, width: "half" },
        ],
      },
      {
        id: "roles",
        title: "Printer roles",
        description: "Map each model to a role so members can self-assign the machine they own.",
        fields: [{ path: "printerRoles", label: "Printer roles", kind: "custom", component: "PrinterRoleEditor" }],
      },
      {
        id: "scam",
        title: "Scam notice",
        fields: [
          { path: "scamNotice.enabled", label: "Show a scam warning on relevant answers", kind: "toggle" },
          { path: "scamNotice.text", label: "Notice text", kind: "textarea" },
        ],
      },
    ],
  },
};
