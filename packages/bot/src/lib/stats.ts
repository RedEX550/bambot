import { prisma } from "../core/db";
import { childLogger } from "../core/logger";

const log = childLogger("stats");

export type DailyStatField =
  | "joins"
  | "leaves"
  | "messages"
  | "ticketsOpened"
  | "ticketsClosed"
  | "modActions"
  | "automodHits"
  | "commandsUsed"
  | "voiceMinutes";

/**
 * Increments a counter on today's row.
 *
 * Message counts fire on every message in a busy server, so writes are batched
 * in memory and flushed once a minute rather than hammering Postgres.
 */
const pending = new Map<string, number>();

export const bumpDailyStat = (guildId: string, field: DailyStatField, by = 1) => {
  const key = `${guildId}:${field}`;
  pending.set(key, (pending.get(key) ?? 0) + by);
};

export const flushDailyStats = async () => {
  if (!pending.size) return;
  const snapshot = [...pending.entries()];
  pending.clear();

  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);

  for (const [key, amount] of snapshot) {
    const [guildId, field] = key.split(":");
    try {
      await prisma.dailyStat.upsert({
        where: { guildId_date: { guildId, date } },
        create: { guildId, date, [field]: amount } as never,
        update: { [field]: { increment: amount } } as never,
      });
    } catch (err) {
      log.debug({ err, guildId, field }, "failed to flush daily stat");
    }
  }
};

setInterval(() => {
  void flushDailyStats();
}, 60_000).unref();
