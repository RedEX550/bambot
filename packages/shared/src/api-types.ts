/** DTOs shared by the REST API and the dashboard. */

import type { ModuleName } from "./constants";

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}

export interface SessionUser {
  id: string;
  username: string;
  globalName: string | null;
  avatarUrl: string | null;
}

export interface DashboardGuild {
  id: string;
  name: string;
  iconUrl: string | null;
  /** True when Bambot is in the guild, so the dashboard can offer an invite. */
  botPresent: boolean;
  /** True when the signed-in user may edit this guild. */
  canManage: boolean;
  memberCount?: number;
}

export interface GuildChannel {
  id: string;
  name: string;
  type: "text" | "voice" | "category" | "forum" | "announcement" | "stage" | "other";
  parentId: string | null;
  position: number;
  /** False when the bot cannot send messages there — the picker greys these out. */
  writable: boolean;
}

export interface GuildRole {
  id: string;
  name: string;
  color: string;
  position: number;
  managed: boolean;
  /** False when the role sits above the bot, so it could never be assigned. */
  assignable: boolean;
  memberCount?: number;
}

export interface GuildEmoji {
  id: string;
  name: string;
  url: string;
  animated: boolean;
}

/** Everything the dashboard needs to render pickers for a guild. */
export interface GuildMeta {
  id: string;
  name: string;
  iconUrl: string | null;
  memberCount: number;
  channels: GuildChannel[];
  roles: GuildRole[];
  emojis: GuildEmoji[];
  botRolePosition: number;
  /** Permissions the bot is missing for the features that are switched on. */
  warnings: { module: string; message: string }[];
}

export interface ConfigResponse<T = unknown> {
  module: ModuleName;
  data: T;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface OverviewStats {
  memberCount: number;
  onlineCount: number;
  joins7d: number;
  leaves7d: number;
  messages7d: number;
  openTickets: number;
  ticketsClosed7d: number;
  medianFirstResponseMinutes: number | null;
  csat: number | null;
  modActions7d: number;
  automodHits7d: number;
  topCommands: { command: string; count: number }[];
  series: { date: string; joins: number; leaves: number; messages: number; tickets: number; modActions: number }[];
}

export interface CaseDto {
  id: string;
  caseNumber: number;
  type: string;
  targetId: string;
  targetTag: string;
  moderatorId: string;
  moderatorTag: string;
  reason: string;
  duration: number | null;
  expiresAt: string | null;
  active: boolean;
  pardoned: boolean;
  createdAt: string;
}

export interface TicketDto {
  id: string;
  ticketNumber: number;
  channelId: string;
  categoryKey: string;
  openerId: string;
  openerTag: string;
  claimedByTag: string | null;
  status: string;
  priority: string;
  subject: string | null;
  rating: number | null;
  createdAt: string;
  closedAt: string | null;
  firstResponseMinutes: number | null;
  transcriptId: string | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Actions the dashboard asks the bot to perform live. */
export type BotActionName =
  | "publishPanel"
  | "publishRoleMenu"
  | "publishVerification"
  | "previewWelcome"
  | "reloadConfig"
  | "sendMessage"
  | "syncCounters"
  | "closeTicket";

export interface BotActionRequest {
  action: BotActionName;
  guildId: string;
  payload?: Record<string, unknown>;
}

export interface BotActionResult {
  ok: boolean;
  message: string;
  data?: unknown;
}
