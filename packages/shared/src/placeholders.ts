/**
 * The placeholder catalogue. The dashboard renders this as a clickable
 * "insert variable" list next to every text field, and the bot resolves the
 * same keys at send time, so the two can never drift apart.
 */

export interface PlaceholderDoc {
  key: string;
  description: string;
  example: string;
  /** Which scopes provide this value. */
  scopes: PlaceholderScope[];
}

export type PlaceholderScope =
  | "member"
  | "guild"
  | "ticket"
  | "case"
  | "level"
  | "suggestion"
  | "giveaway";

export const PLACEHOLDERS: PlaceholderDoc[] = [
  { key: "{user}", description: "Mentions the member", example: "@rezi", scopes: ["member"] },
  { key: "{user.name}", description: "Username", example: "rezi", scopes: ["member"] },
  { key: "{user.display}", description: "Server display name", example: "Rezi", scopes: ["member"] },
  { key: "{user.id}", description: "User ID", example: "123456789012345678", scopes: ["member"] },
  { key: "{user.tag}", description: "Full handle", example: "rezi", scopes: ["member"] },
  { key: "{user.avatar}", description: "Avatar URL", example: "https://cdn.discordapp.com/...", scopes: ["member"] },
  { key: "{user.created}", description: "Account creation date", example: "12 Mar 2021", scopes: ["member"] },
  { key: "{user.created.relative}", description: "Relative account age", example: "3 years ago", scopes: ["member"] },
  { key: "{user.joined}", description: "Server join date", example: "1 Sep 2026", scopes: ["member"] },

  { key: "{server}", description: "Server name", example: "Bambu Lab Official", scopes: ["guild"] },
  { key: "{server.id}", description: "Server ID", example: "970163353542606888", scopes: ["guild"] },
  { key: "{server.icon}", description: "Server icon URL", example: "https://cdn.discordapp.com/...", scopes: ["guild"] },
  { key: "{server.members}", description: "Member count", example: "41813", scopes: ["guild"] },
  { key: "{server.members.ordinal}", description: "Ordinal member count", example: "41,813th", scopes: ["guild"] },
  { key: "{server.boosts}", description: "Boost count", example: "42", scopes: ["guild"] },

  { key: "{ticket.number}", description: "Ticket number", example: "1042", scopes: ["ticket"] },
  { key: "{ticket.category}", description: "Ticket category label", example: "Printer Support", scopes: ["ticket"] },
  { key: "{ticket.opener}", description: "Ticket opener mention", example: "@rezi", scopes: ["ticket"] },
  { key: "{ticket.channel}", description: "Ticket channel mention", example: "#ticket-1042", scopes: ["ticket"] },
  { key: "{ticket.claimer}", description: "Staff member who claimed it", example: "@support", scopes: ["ticket"] },
  { key: "{ticket.priority}", description: "Priority", example: "HIGH", scopes: ["ticket"] },

  { key: "{case.number}", description: "Case number", example: "77", scopes: ["case"] },
  { key: "{case.reason}", description: "Moderation reason", example: "Scam link", scopes: ["case"] },
  { key: "{case.moderator}", description: "Acting moderator", example: "@mod", scopes: ["case"] },
  { key: "{case.duration}", description: "Human readable duration", example: "7 days", scopes: ["case"] },

  { key: "{level}", description: "New level", example: "12", scopes: ["level"] },
  { key: "{level.xp}", description: "Total XP", example: "18420", scopes: ["level"] },
  { key: "{level.rank}", description: "Leaderboard rank", example: "#38", scopes: ["level"] },

  { key: "{suggestion.number}", description: "Suggestion number", example: "204", scopes: ["suggestion"] },
  { key: "{suggestion.status}", description: "Current status", example: "APPROVED", scopes: ["suggestion"] },

  { key: "{giveaway.prize}", description: "Prize", example: "Bambu Lab A1 mini", scopes: ["giveaway"] },
  { key: "{giveaway.winners}", description: "Winner mentions", example: "@a, @b", scopes: ["giveaway"] },
  { key: "{giveaway.ends}", description: "End timestamp", example: "in 2 days", scopes: ["giveaway"] },
];

export const placeholdersForScopes = (scopes: PlaceholderScope[]): PlaceholderDoc[] =>
  PLACEHOLDERS.filter((p) => p.scopes.some((s) => scopes.includes(s)));
