/** Brand + shared constants used by the bot, the API and the dashboard. */

/** Bambu Lab brand green, plus a semantic palette used for every embed. */
export const COLORS = {
  brand: 0x00ae42,
  brandHex: "#00AE42",
  success: 0x2ecc71,
  info: 0x3b82f6,
  warning: 0xf59e0b,
  danger: 0xef4444,
  neutral: 0x64748b,
  ticket: 0x00ae42,
  star: 0xfacc15,
} as const;

export const EMOJI = {
  success: "✅",
  error: "❌",
  warning: "⚠️",
  info: "ℹ️",
  loading: "⏳",
  ticket: "🎫",
  lock: "🔒",
  unlock: "🔓",
  star: "⭐",
  printer: "🖨️",
  spool: "🧵",
  wrench: "🔧",
  bulb: "💡",
  shield: "🛡️",
  up: "👍",
  down: "👎",
} as const;

/** Every configurable feature module. The dashboard sidebar is generated from this. */
export const MODULES = [
  "core",
  "welcome",
  "goodbye",
  "autorole",
  "verification",
  "tickets",
  "modmail",
  "automod",
  "antiraid",
  "moderation",
  "logging",
  "leveling",
  "starboard",
  "suggestions",
  "giveaways",
  "rolemenus",
  "tempvoice",
  "counters",
  "bambu",
  "content",
] as const;

export type ModuleName = (typeof MODULES)[number];

export const CASE_TYPES = [
  "WARN",
  "MUTE",
  "UNMUTE",
  "KICK",
  "BAN",
  "UNBAN",
  "SOFTBAN",
  "NOTE",
  "PURGE",
  "LOCKDOWN",
  "QUARANTINE",
] as const;
export type CaseType = (typeof CASE_TYPES)[number];

export const TICKET_STATUSES = ["OPEN", "CLAIMED", "PENDING", "CLOSED"] as const;
export const TICKET_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const SUGGESTION_STATUSES = [
  "PENDING",
  "APPROVED",
  "DENIED",
  "IMPLEMENTED",
  "CONSIDERED",
  "DUPLICATE",
] as const;

/** Supported dashboard + command locales. Bambu has a global community. */
export const LOCALES = ["en-US", "de", "fr", "es-ES", "zh-CN", "ja", "ko", "pt-BR"] as const;
export type Locale = (typeof LOCALES)[number];

/** Discord permission bit for Administrator, used for dashboard access checks. */
export const PERM_ADMINISTRATOR = 0x8n;
export const PERM_MANAGE_GUILD = 0x20n;

export const LIMITS = {
  embedTitle: 256,
  embedDescription: 4096,
  embedFieldName: 256,
  embedFieldValue: 1024,
  embedFooter: 2048,
  embedAuthor: 256,
  embedFields: 25,
  ticketCategories: 25,
  panelButtons: 25,
  roleMenuOptions: 25,
  automodWords: 500,
  tagContent: 4000,
} as const;
