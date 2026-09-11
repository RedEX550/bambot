import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireGuildAccess } from "../lib/auth";
import { recordAudit } from "../lib/audit";

export const dataRouter: Router = Router();

dataRouter.use(requireAuth);

const pagination = (req: { query: Record<string, unknown> }) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 25, 1), 100);
  return { page, pageSize, skip: (page - 1) * pageSize };
};

// ---------------------------------------------------------------------------
// Moderation cases
// ---------------------------------------------------------------------------

dataRouter.get("/:guildId/cases", requireGuildAccess, async (req, res) => {
  const { page, pageSize, skip } = pagination(req);
  const guildId = req.guildId!;

  const search = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const type = typeof req.query.type === "string" && req.query.type !== "all" ? req.query.type : undefined;

  const where = {
    guildId,
    ...(type ? { type } : {}),
    ...(search
      ? {
          OR: [
            { targetTag: { contains: search, mode: "insensitive" as const } },
            { targetId: search },
            { moderatorTag: { contains: search, mode: "insensitive" as const } },
            { reason: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.case.findMany({ where, orderBy: { caseNumber: "desc" }, skip, take: pageSize }),
    prisma.case.count({ where }),
  ]);

  res.json({ items, total, page, pageSize });
});

dataRouter.patch("/:guildId/cases/:caseId", requireGuildAccess, async (req, res) => {
  const schema = z.object({
    reason: z.string().max(1000).optional(),
    pardoned: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "validation_failed", message: "Invalid case update." });
    return;
  }

  const existing = await prisma.case.findFirst({ where: { id: req.params.caseId, guildId: req.guildId! } });
  if (!existing) {
    res.status(404).json({ error: "not_found", message: "That case does not exist." });
    return;
  }

  const updated = await prisma.case.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.reason !== undefined ? { reason: parsed.data.reason } : {}),
      ...(parsed.data.pardoned !== undefined
        ? { pardoned: parsed.data.pardoned, active: parsed.data.pardoned ? false : existing.active, pardonedBy: req.session!.userId }
        : {}),
    },
  });

  await recordAudit(req, {
    guildId: req.guildId!,
    action: "case.update",
    module: "moderation",
    summary: `case #${existing.caseNumber}`,
    before: existing,
    after: updated,
  });

  res.json(updated);
});

dataRouter.get("/:guildId/cases/user/:userId", requireGuildAccess, async (req, res) => {
  const cases = await prisma.case.findMany({
    where: { guildId: req.guildId!, targetId: req.params.userId },
    orderBy: { caseNumber: "desc" },
    take: 100,
  });
  res.json({ items: cases, total: cases.length });
});

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

dataRouter.get("/:guildId/tickets", requireGuildAccess, async (req, res) => {
  const { page, pageSize, skip } = pagination(req);
  const status = typeof req.query.status === "string" && req.query.status !== "all" ? req.query.status : undefined;
  const category = typeof req.query.category === "string" && req.query.category !== "all" ? req.query.category : undefined;
  const search = typeof req.query.q === "string" ? req.query.q.trim() : "";

  const where = {
    guildId: req.guildId!,
    ...(status === "open" ? { status: { not: "CLOSED" } } : status ? { status } : {}),
    ...(category ? { categoryKey: category } : {}),
    ...(search
      ? {
          OR: [
            { openerTag: { contains: search, mode: "insensitive" as const } },
            { subject: { contains: search, mode: "insensitive" as const } },
            { openerId: search },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.ticket.findMany({ where, orderBy: { ticketNumber: "desc" }, skip, take: pageSize }),
    prisma.ticket.count({ where }),
  ]);

  res.json({
    items: rows.map((t) => ({
      ...t,
      firstResponseMinutes: t.firstResponseAt
        ? Math.round((t.firstResponseAt.getTime() - t.createdAt.getTime()) / 60_000)
        : null,
    })),
    total,
    page,
    pageSize,
  });
});

/** Per-staff-member ticket performance, for the support report. */
dataRouter.get("/:guildId/tickets/stats", requireGuildAccess, async (req, res) => {
  const guildId = req.guildId!;
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  const since = new Date(Date.now() - days * 86_400_000);

  const tickets = await prisma.ticket.findMany({
    where: { guildId, createdAt: { gte: since } },
    select: {
      categoryKey: true,
      claimedById: true,
      claimedByTag: true,
      rating: true,
      status: true,
      createdAt: true,
      firstResponseAt: true,
      closedAt: true,
    },
  });

  const byCategory = new Map<string, number>();
  const byStaff = new Map<string, { tag: string; handled: number; ratings: number[]; responses: number[] }>();

  for (const ticket of tickets) {
    byCategory.set(ticket.categoryKey, (byCategory.get(ticket.categoryKey) ?? 0) + 1);

    if (ticket.claimedById) {
      const entry = byStaff.get(ticket.claimedById) ?? {
        tag: ticket.claimedByTag ?? ticket.claimedById,
        handled: 0,
        ratings: [],
        responses: [],
      };
      entry.handled += 1;
      if (ticket.rating) entry.ratings.push(ticket.rating);
      if (ticket.firstResponseAt) {
        entry.responses.push((ticket.firstResponseAt.getTime() - ticket.createdAt.getTime()) / 60_000);
      }
      byStaff.set(ticket.claimedById, entry);
    }
  }

  const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

  res.json({
    total: tickets.length,
    open: tickets.filter((t) => t.status !== "CLOSED").length,
    byCategory: [...byCategory.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
    staff: [...byStaff.entries()]
      .map(([id, entry]) => ({
        id,
        tag: entry.tag,
        handled: entry.handled,
        averageRating: average(entry.ratings),
        averageResponseMinutes: average(entry.responses) === null ? null : Math.round(average(entry.responses)!),
      }))
      .sort((a, b) => b.handled - a.handled),
  });
});

/**
 * Serves a saved transcript as a standalone HTML page.
 *
 * Content-Security-Policy is set to block everything except inline styles, so
 * even if a transcript somehow contained hostile markup it cannot execute or
 * call home. The transcript generator already escapes, this is defence in depth.
 */
dataRouter.get("/:guildId/transcripts/:transcriptId", requireGuildAccess, async (req, res) => {
  const transcript = await prisma.transcript.findFirst({
    where: { id: req.params.transcriptId, guildId: req.guildId! },
  });

  if (!transcript) {
    res.status(404).json({ error: "not_found", message: "That transcript does not exist." });
    return;
  }

  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader(
    "content-security-policy",
    "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; media-src https:",
  );
  res.setHeader("x-content-type-options", "nosniff");
  res.send(transcript.html);
});

dataRouter.get("/:guildId/transcripts", requireGuildAccess, async (req, res) => {
  const { page, pageSize, skip } = pagination(req);
  const [items, total] = await Promise.all([
    prisma.transcript.findMany({
      where: { guildId: req.guildId! },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      select: { id: true, channelId: true, ticketId: true, meta: true, createdAt: true },
    }),
    prisma.transcript.count({ where: { guildId: req.guildId! } }),
  ]);
  res.json({ items, total, page, pageSize });
});

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

dataRouter.get("/:guildId/levels", requireGuildAccess, async (req, res) => {
  const { page, pageSize, skip } = pagination(req);
  const [items, total] = await Promise.all([
    prisma.level.findMany({ where: { guildId: req.guildId! }, orderBy: { xp: "desc" }, skip, take: pageSize }),
    prisma.level.count({ where: { guildId: req.guildId! } }),
  ]);
  res.json({ items, total, page, pageSize });
});

dataRouter.patch("/:guildId/levels/:userId", requireGuildAccess, async (req, res) => {
  const schema = z.object({ xp: z.number().int().min(0).max(100_000_000).optional(), optedOut: z.boolean().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "validation_failed", message: "Invalid level update." });
    return;
  }

  const updated = await prisma.level.update({
    where: { guildId_userId: { guildId: req.guildId!, userId: req.params.userId } },
    data: parsed.data,
  });

  await recordAudit(req, {
    guildId: req.guildId!,
    action: "level.update",
    module: "leveling",
    summary: `updated <@${req.params.userId}>`,
    after: parsed.data,
  });

  res.json(updated);
});

dataRouter.delete("/:guildId/levels/:userId", requireGuildAccess, async (req, res) => {
  await prisma.level
    .delete({ where: { guildId_userId: { guildId: req.guildId!, userId: req.params.userId } } })
    .catch(() => undefined);
  await recordAudit(req, { guildId: req.guildId!, action: "level.reset", module: "leveling", summary: `reset <@${req.params.userId}>` });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Suggestions & giveaways (read + status changes)
// ---------------------------------------------------------------------------

dataRouter.get("/:guildId/suggestions", requireGuildAccess, async (req, res) => {
  const { page, pageSize, skip } = pagination(req);
  const status = typeof req.query.status === "string" && req.query.status !== "all" ? req.query.status : undefined;
  const where = { guildId: req.guildId!, ...(status ? { status } : {}) };

  const [items, total] = await Promise.all([
    prisma.suggestion.findMany({ where, orderBy: { number: "desc" }, skip, take: pageSize }),
    prisma.suggestion.count({ where }),
  ]);
  res.json({ items, total, page, pageSize });
});

dataRouter.patch("/:guildId/suggestions/:id", requireGuildAccess, async (req, res) => {
  const schema = z.object({
    status: z.enum(["PENDING", "APPROVED", "DENIED", "IMPLEMENTED", "CONSIDERED", "DUPLICATE"]),
    staffNote: z.string().max(1000).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "validation_failed", message: "Invalid status." });
    return;
  }

  const updated = await prisma.suggestion.update({
    where: { id: req.params.id },
    data: { ...parsed.data, handledById: req.session!.userId, handledAt: new Date() },
  });

  await recordAudit(req, {
    guildId: req.guildId!,
    action: "suggestion.status",
    module: "suggestions",
    summary: `#${updated.number} → ${parsed.data.status}`,
  });

  res.json(updated);
});

dataRouter.get("/:guildId/giveaways", requireGuildAccess, async (req, res) => {
  const items = await prisma.giveaway.findMany({
    where: { guildId: req.guildId! },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { _count: { select: { entries: true } } },
  });
  res.json({ items, total: items.length });
});

export default dataRouter;
