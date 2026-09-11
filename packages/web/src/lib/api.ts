import type {
  ConfigResponse,
  DashboardGuild,
  GuildMeta,
  ModuleUi,
  OverviewStats,
  SessionUser,
} from "@bambot/shared";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE = "/api";

/**
 * Thin fetch wrapper.
 *
 * Everything goes through here so that a 401 always means the same thing — the
 * session is gone, send the user to the login page — rather than each caller
 * inventing its own handling.
 */
export const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: init?.body ? { "content-type": "application/json", ...(init?.headers ?? {}) } : (init?.headers ?? {}),
    ...init,
  });

  if (response.status === 401 && !path.startsWith("/auth/me")) {
    window.location.href = `/login?returnTo=${encodeURIComponent(window.location.pathname)}`;
    throw new ApiError(401, "unauthorized", "Session expired");
  }

  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error ?? "error",
      body?.message ?? `Request failed (${response.status})`,
      body?.details,
    );
  }

  return body as T;
};

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

// --- auth -------------------------------------------------------------------

export const getMe = () => api<{ user: SessionUser; isOwner: boolean }>("/auth/me");

export const getGuilds = (refresh = false) =>
  api<{ guilds: DashboardGuild[]; inviteUrl: string }>(`/auth/guilds${refresh ? "?refresh=1" : ""}`);

export const logout = () => api<{ ok: boolean }>("/auth/logout", json("POST"));

export const loginUrl = (returnTo: string) => `${BASE}/auth/login?returnTo=${encodeURIComponent(returnTo)}`;

// --- config -----------------------------------------------------------------

export interface SchemaResponse {
  groups: { group: string; modules: { name: string; title: string; icon: string; description: string }[] }[];
  modules: Record<string, { name: string; ui: ModuleUi; defaults: unknown }>;
}

export const getSchema = () => api<SchemaResponse>("/config/schema");

export const getAllConfig = (guildId: string) =>
  api<{ guildId: string; data: Record<string, unknown>; meta: Record<string, { updatedAt: string | null; updatedBy: string | null }> }>(
    `/config/${guildId}`,
  );

export const getModuleConfig = <T>(guildId: string, module: string) =>
  api<ConfigResponse<T> & { ui: ModuleUi }>(`/config/${guildId}/${module}`);

export const saveModuleConfig = <T>(guildId: string, module: string, data: T) =>
  api<ConfigResponse<T>>(`/config/${guildId}/${module}`, json("PUT", data));

export const resetModuleConfig = (guildId: string, module: string) =>
  api<{ module: string; data: unknown }>(`/config/${guildId}/${module}/reset`, json("POST"));

export const exportConfig = (guildId: string) => `${BASE}/config/${guildId}/export/all`;

export const importConfig = (guildId: string, modules: Record<string, unknown>) =>
  api<{ applied: string[]; skipped: { module: string; reason: string }[] }>(
    `/config/${guildId}/import`,
    json("POST", { modules }),
  );

// --- guild ------------------------------------------------------------------

export const getGuildMeta = (guildId: string) => api<GuildMeta>(`/guilds/${guildId}/meta`);

export const getOverview = (guildId: string, days = 30) =>
  api<OverviewStats>(`/guilds/${guildId}/overview?days=${days}`);

export const getAudit = (guildId: string, page = 1) =>
  api<{ items: AuditEntry[]; total: number; page: number; pageSize: number }>(`/guilds/${guildId}/audit?page=${page}`);

export interface AuditEntry {
  id: string;
  userId: string;
  userTag: string;
  action: string;
  module: string | null;
  summary: string;
  createdAt: string;
}

export const searchMembers = (guildId: string, query: string) =>
  api<{ id: string; tag: string; displayName: string; avatarUrl: string }[]>(
    `/guilds/${guildId}/members?q=${encodeURIComponent(query)}`,
  );

// --- actions ----------------------------------------------------------------

export const runAction = <T = unknown>(guildId: string, action: string, payload?: Record<string, unknown>) =>
  api<{ ok: boolean; message: string; data?: T }>(`/actions/${guildId}/${action}`, json("POST", payload ?? {}));

export const getBotHealth = () =>
  api<{ bot: { ok: boolean; uptimeSeconds: number; guilds: number; ping: number; commands: number } | null }>(
    "/actions/health",
  );

// --- data -------------------------------------------------------------------

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CaseRow {
  id: string;
  caseNumber: number;
  type: string;
  targetId: string;
  targetTag: string;
  moderatorId: string;
  moderatorTag: string;
  reason: string;
  duration: number | null;
  active: boolean;
  pardoned: boolean;
  createdAt: string;
}

export const getCases = (guildId: string, params: { page?: number; q?: string; type?: string } = {}) => {
  const search = new URLSearchParams();
  if (params.page) search.set("page", String(params.page));
  if (params.q) search.set("q", params.q);
  if (params.type) search.set("type", params.type);
  return api<Paginated<CaseRow>>(`/data/${guildId}/cases?${search}`);
};

export const updateCase = (guildId: string, caseId: string, body: { reason?: string; pardoned?: boolean }) =>
  api<CaseRow>(`/data/${guildId}/cases/${caseId}`, json("PATCH", body));

export interface TicketRow {
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

export const getTickets = (guildId: string, params: { page?: number; status?: string; q?: string; category?: string } = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v && search.set(k, String(v)));
  return api<Paginated<TicketRow>>(`/data/${guildId}/tickets?${search}`);
};

export interface TicketStats {
  total: number;
  open: number;
  byCategory: { key: string; count: number }[];
  staff: { id: string; tag: string; handled: number; averageRating: number | null; averageResponseMinutes: number | null }[];
}

export const getTicketStats = (guildId: string, days = 30) =>
  api<TicketStats>(`/data/${guildId}/tickets/stats?days=${days}`);

export const transcriptUrl = (guildId: string, transcriptId: string) =>
  `${BASE}/data/${guildId}/transcripts/${transcriptId}`;

export interface LevelRow {
  id: string;
  userId: string;
  xp: number;
  level: number;
  messages: number;
  optedOut: boolean;
}

export const getLevels = (guildId: string, page = 1) =>
  api<Paginated<LevelRow>>(`/data/${guildId}/levels?page=${page}`);

export const updateLevel = (guildId: string, userId: string, body: { xp?: number; optedOut?: boolean }) =>
  api<LevelRow>(`/data/${guildId}/levels/${userId}`, json("PATCH", body));

export interface SuggestionRow {
  id: string;
  number: number;
  authorId: string;
  authorTag: string;
  content: string;
  status: string;
  staffNote: string | null;
  createdAt: string;
}

export const getSuggestions = (guildId: string, status = "all", page = 1) =>
  api<Paginated<SuggestionRow>>(`/data/${guildId}/suggestions?status=${status}&page=${page}`);

export const updateSuggestion = (guildId: string, id: string, body: { status: string; staffNote?: string }) =>
  api<SuggestionRow>(`/data/${guildId}/suggestions/${id}`, json("PATCH", body));

// --- content ----------------------------------------------------------------

export interface KbRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  content: string;
  category: string;
  keywords: string[];
  published: boolean;
  views: number;
  helpful: number;
  unhelpful: number;
}

export const getKb = (guildId: string, q = "") => api<{ items: KbRow[] }>(`/content/${guildId}/kb?q=${encodeURIComponent(q)}`);
export const saveKb = (guildId: string, body: Partial<KbRow>) => api<KbRow>(`/content/${guildId}/kb`, json("POST", body));
export const deleteKb = (guildId: string, id: string) => api<{ ok: boolean }>(`/content/${guildId}/kb/${id}`, json("DELETE"));

export interface TagRow {
  id: string;
  name: string;
  aliases: string[];
  content: string;
  uses: number;
}

export const getTags = (guildId: string) => api<{ items: TagRow[] }>(`/content/${guildId}/tags`);
export const saveTag = (guildId: string, body: Partial<TagRow>) => api<TagRow>(`/content/${guildId}/tags`, json("POST", body));
export const deleteTag = (guildId: string, id: string) => api<{ ok: boolean }>(`/content/${guildId}/tags/${id}`, json("DELETE"));

export interface RoleMenuRow {
  id: string;
  name: string;
  channelId: string;
  messageId: string | null;
  style: string;
  placeholder: string | null;
  minSelect: number;
  maxSelect: number;
  embed: unknown;
  options: { roleId: string; label: string; description: string; emoji: string; style: string }[];
}

export const getRoleMenus = (guildId: string) => api<{ items: RoleMenuRow[] }>(`/content/${guildId}/rolemenus`);
export const saveRoleMenu = (guildId: string, body: unknown) => api<RoleMenuRow>(`/content/${guildId}/rolemenus`, json("POST", body));
export const publishRoleMenu = (guildId: string, id: string) =>
  api<{ ok: boolean; message: string }>(`/content/${guildId}/rolemenus/${id}/publish`, json("POST"));
export const deleteRoleMenu = (guildId: string, id: string) =>
  api<{ ok: boolean }>(`/content/${guildId}/rolemenus/${id}`, json("DELETE"));
