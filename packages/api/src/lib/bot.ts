import type { BotActionRequest, BotActionResult, GuildMeta } from "@bambot/shared";
import { env } from "../env";
import { logger } from "../logger";

/**
 * Client for the bot's private HTTP surface.
 *
 * The API owns the database; the bot owns the gateway connection. Anything that
 * needs live Discord state or a message sent right now goes through here.
 * Everything is wrapped so a bot restart degrades the dashboard rather than
 * 500-ing it.
 */

export class BotUnavailableError extends Error {
  constructor() {
    super("The bot is not reachable right now. Settings still save, but live actions are paused.");
    this.name = "BotUnavailableError";
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(`${env.BOT_INTERNAL_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-internal-key": env.INTERNAL_API_KEY,
        ...(init?.headers ?? {}),
      },
    });

    if (response.status === 401) throw new Error("The API and the bot disagree about INTERNAL_API_KEY.");
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(body || `bot returned ${response.status}`);
    }
    return (await response.json()) as T;
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || "code" in err)) {
      logger.warn({ err, path }, "bot internal request failed");
      throw new BotUnavailableError();
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

export const botHealth = async () =>
  request<{ ok: boolean; uptimeSeconds: number; guilds: number; ping: number; commands: number }>("/health");

export const fetchGuildMeta = (guildId: string) => request<GuildMeta>(`/guilds/${guildId}/meta`);

export const searchMembers = (guildId: string, query: string) =>
  request<{ id: string; tag: string; displayName: string; avatarUrl: string }[]>(
    `/guilds/${guildId}/members?q=${encodeURIComponent(query)}`,
  );

export const runAction = (payload: BotActionRequest) =>
  request<BotActionResult>("/actions", { method: "POST", body: JSON.stringify(payload) });

/** Tells the bot to drop its cached copy of a config it just had changed. */
export const invalidateConfig = async (guildId: string, module?: string) => {
  try {
    await request("/config/invalidate", { method: "POST", body: JSON.stringify({ guildId, module }) });
  } catch (err) {
    // A stale cache self-heals within a minute, so this is not worth failing a save over.
    logger.debug({ err, guildId, module }, "config invalidation failed");
  }
};
