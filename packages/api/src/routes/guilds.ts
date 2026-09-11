import { Router } from "express";
import type { OverviewStats } from "@bambot/shared";
import { prisma } from "../db";
import { requireAuth, requireGuildAccess } from "../lib/auth";
import { BotUnavailableError, fetchGuildMeta, searchMembers } from "../lib/bot";

export const guildsRouter: Router = Router();

guildsRouter.use(requireAuth);

/** Live channels, roles and emojis, plus a pre-flight permission check. */
guildsRouter.get("/:guildId/meta", requireGuildAccess, async (req, res) => {
  try {
    const meta = await fetchGuildMeta(req.guildId!);
    res.json(meta);
  } catch (err) {
    if (err instanceof BotUnavailableError) {
      res.status(503).json({ error: "bot_unavailable", message: err.message });
      return;
    }
    throw err;
  }
});

guildsRouter.get("/:guildId/members", requireGuildAccess, async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q : "";
  try {
    res.json(await searchMembers(req.guildId!, query));
  } catch {
    res.json([]);
  }
});

const dayKey = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * The overview page.
 *
 * Everything is read from the pre-aggregated DailyStat table rather than
 * counting raw rows, so the page stays fast on a busy server. The only live
 * counts are the ones that must be exact right now: open tickets and CSAT.
 */
guildsRouter.get("/:guildId/overview", requireGuildAccess, async (req, res) => {
  const guildId = req.guildId!;
  const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 90);

  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (days - 1));

  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);

  const [stats, openTickets, closed7d, rated, cases7d, commands, guild, ticketTimes] = await Promise.all([
    prisma.dailyStat.findMany({ where: { guildId, date: { gte: since } }, orderBy: { date: "asc" } }),
    prisma.ticket.count({ where: { guildId, status: { not: "CLOSED" } } }),
    prisma.ticket.count({ where: { guildId, closedAt: { gte: sevenDaysAgo } } }),
    prisma.ticket.findMany({
      where: { guildId, rating: { not: null }, closedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      select: { rating: true },
    }),
    prisma.case.count({ where: { guildId, createdAt: { gte: sevenDaysAgo } } }),
    prisma.commandUsage.groupBy({
      by: ["command"],
      where: { guildId, createdAt: { gte: sevenDaysAgo } },
      _count: { command: true },
      orderBy: { _count: { command: "desc" } },
      take: 8,
    }),
    prisma.guild.findUnique({ where: { id: guildId } }),
    prisma.ticket.findMany({
      where: { guildId, firstResponseAt: { not: null }, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      select: { createdAt: true, firstResponseAt: true },
      take: 500,
    }),
  ]);

  // Fill missing days so the chart has no gaps.
  const byDate = new Map(stats.map((s) => [dayKey(s.date), s]));
  const series: OverviewStats["series"] = [];
  for (let i = 0; i < days; i += 1) {
    const date = new Date(since);
    date.setUTCDate(since.getUTCDate() + i);
    const key = dayKey(date);
    const row = byDate.get(key);
    series.push({
      date: key,
      joins: row?.joins ?? 0,
      leaves: row?.leaves ?? 0,
      messages: row?.messages ?? 0,
      tickets: row?.ticketsOpened ?? 0,
      modActions: row?.modActions ?? 0,
    });
  }

  const last7 = series.slice(-7);
  const last7Keys = new Set(last7.map((row) => row.date));
  const automodHits7d = stats
    .filter((row) => last7Keys.has(dayKey(row.date)))
    .reduce((total, row) => total + row.automodHits, 0);
  const sum = (key: keyof (typeof series)[number]) =>
    last7.reduce((total, row) => total + (typeof row[key] === "number" ? (row[key] as number) : 0), 0);

  const responseMinutes = ticketTimes
    .map((t) => (t.firstResponseAt!.getTime() - t.createdAt.getTime()) / 60_000)
    .sort((a, b) => a - b);
  const median = responseMinutes.length ? responseMinutes[Math.floor(responseMinutes.length / 2)] : null;

  const csat = rated.length
    ? Math.round((rated.reduce((total, t) => total + (t.rating ?? 0), 0) / rated.length) * 20)
    : null;

  const payload: OverviewStats = {
    memberCount: guild?.memberCap ?? 0,
    onlineCount: 0,
    joins7d: sum("joins"),
    leaves7d: sum("leaves"),
    messages7d: sum("messages"),
    openTickets,
    ticketsClosed7d: closed7d,
    medianFirstResponseMinutes: median === null ? null : Math.round(median),
    csat,
    modActions7d: cases7d,
    automodHits7d,
    topCommands: commands.map((c) => ({ command: c.command, count: c._count.command })),
    series,
  };

  res.json(payload);
});

guildsRouter.get("/:guildId/audit", requireGuildAccess, async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const pageSize = Math.min(Number(req.query.pageSize) || 25, 100);

  const [items, total] = await Promise.all([
    prisma.dashboardAudit.findMany({
      where: { guildId: req.guildId! },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.dashboardAudit.count({ where: { guildId: req.guildId! } }),
  ]);

  res.json({ items, total, page, pageSize });
});

export default guildsRouter;
