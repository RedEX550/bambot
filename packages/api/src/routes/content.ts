import { Router } from "express";
import { z } from "zod";
import { messagePayloadSchema } from "@bambot/shared";
import { prisma } from "../db";
import { requireAuth, requireGuildAccess } from "../lib/auth";
import { recordAudit } from "../lib/audit";
import { invalidateConfig, runAction } from "../lib/bot";

export const contentRouter: Router = Router();

contentRouter.use(requireAuth);

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60) || "article";

// ---------------------------------------------------------------------------
// Knowledge base
// ---------------------------------------------------------------------------

const kbSchema = z.object({
  title: z.string().min(1).max(160),
  slug: z.string().max(60).optional(),
  summary: z.string().max(500).default(""),
  content: z.string().min(1).max(6000),
  category: z.string().max(40).default("general"),
  keywords: z.array(z.string().max(60)).max(40).default([]),
  models: z.array(z.string().max(40)).max(20).default([]),
  imageUrl: z.string().max(500).optional().nullable(),
  linkUrl: z.string().max(500).optional().nullable(),
  published: z.boolean().default(true),
});

contentRouter.get("/:guildId/kb", requireGuildAccess, async (req, res) => {
  const search = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const items = await prisma.kbArticle.findMany({
    where: {
      guildId: req.guildId!,
      ...(search ? { OR: [{ title: { contains: search, mode: "insensitive" } }, { content: { contains: search, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ category: "asc" }, { title: "asc" }],
    take: 500,
  });
  res.json({ items, total: items.length });
});

contentRouter.post("/:guildId/kb", requireGuildAccess, async (req, res) => {
  const parsed = kbSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "validation_failed", details: parsed.error.issues });
    return;
  }

  const slug = parsed.data.slug ? slugify(parsed.data.slug) : slugify(parsed.data.title);

  const created = await prisma.kbArticle.upsert({
    where: { guildId_slug: { guildId: req.guildId!, slug } },
    create: {
      ...parsed.data,
      slug,
      summary: parsed.data.summary || parsed.data.content.slice(0, 200),
      guildId: req.guildId!,
      createdBy: req.session!.userId,
      imageUrl: parsed.data.imageUrl ?? null,
      linkUrl: parsed.data.linkUrl ?? null,
    },
    update: {
      ...parsed.data,
      slug,
      summary: parsed.data.summary || parsed.data.content.slice(0, 200),
      imageUrl: parsed.data.imageUrl ?? null,
      linkUrl: parsed.data.linkUrl ?? null,
    },
  });

  await recordAudit(req, { guildId: req.guildId!, action: "kb.save", module: "content", summary: created.title });
  res.json(created);
});

contentRouter.delete("/:guildId/kb/:id", requireGuildAccess, async (req, res) => {
  const deleted = await prisma.kbArticle.deleteMany({ where: { id: req.params.id, guildId: req.guildId! } });
  await recordAudit(req, { guildId: req.guildId!, action: "kb.delete", module: "content" });
  res.json({ ok: deleted.count > 0 });
});

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

const tagSchema = z.object({
  name: z.string().min(1).max(40),
  aliases: z.array(z.string().max(40)).max(10).default([]),
  content: z.string().min(1).max(2000),
});

contentRouter.get("/:guildId/tags", requireGuildAccess, async (req, res) => {
  const items = await prisma.tag.findMany({ where: { guildId: req.guildId! }, orderBy: { uses: "desc" }, take: 500 });
  res.json({ items, total: items.length });
});

contentRouter.post("/:guildId/tags", requireGuildAccess, async (req, res) => {
  const parsed = tagSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "validation_failed", details: parsed.error.issues });
    return;
  }
  const name = parsed.data.name.toLowerCase().trim();

  const saved = await prisma.tag.upsert({
    where: { guildId_name: { guildId: req.guildId!, name } },
    create: { ...parsed.data, name, guildId: req.guildId!, createdBy: req.session!.userId },
    update: { ...parsed.data, name, updatedBy: req.session!.userId },
  });

  await recordAudit(req, { guildId: req.guildId!, action: "tag.save", module: "content", summary: name });
  res.json(saved);
});

contentRouter.delete("/:guildId/tags/:id", requireGuildAccess, async (req, res) => {
  const deleted = await prisma.tag.deleteMany({ where: { id: req.params.id, guildId: req.guildId! } });
  await recordAudit(req, { guildId: req.guildId!, action: "tag.delete", module: "content" });
  res.json({ ok: deleted.count > 0 });
});

// ---------------------------------------------------------------------------
// Auto-responders
// ---------------------------------------------------------------------------

const responderSchema = z.object({
  name: z.string().min(1).max(60),
  trigger: z.string().min(1).max(200),
  matchType: z.enum(["contains", "exact", "startswith", "regex"]).default("contains"),
  response: messagePayloadSchema,
  channels: z.array(z.string()).default([]),
  ignoredRoles: z.array(z.string()).default([]),
  requiredRoles: z.array(z.string()).default([]),
  cooldown: z.number().int().min(0).max(3600).default(30),
  deleteTrigger: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

contentRouter.get("/:guildId/responders", requireGuildAccess, async (req, res) => {
  const items = await prisma.autoResponder.findMany({ where: { guildId: req.guildId! }, orderBy: { name: "asc" } });
  res.json({ items, total: items.length });
});

contentRouter.post("/:guildId/responders", requireGuildAccess, async (req, res) => {
  const parsed = responderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "validation_failed", details: parsed.error.issues });
    return;
  }

  // A broken regex would throw inside the message handler on every message.
  if (parsed.data.matchType === "regex") {
    try {
      new RegExp(parsed.data.trigger);
    } catch {
      res.status(422).json({ error: "validation_failed", message: "That is not a valid regular expression." });
      return;
    }
  }

  const saved = await prisma.autoResponder.upsert({
    where: { guildId_name: { guildId: req.guildId!, name: parsed.data.name } },
    create: { ...parsed.data, response: parsed.data.response as never, guildId: req.guildId! },
    update: { ...parsed.data, response: parsed.data.response as never },
  });

  await recordAudit(req, { guildId: req.guildId!, action: "responder.save", module: "content", summary: parsed.data.name });
  res.json(saved);
});

contentRouter.delete("/:guildId/responders/:id", requireGuildAccess, async (req, res) => {
  const deleted = await prisma.autoResponder.deleteMany({ where: { id: req.params.id, guildId: req.guildId! } });
  res.json({ ok: deleted.count > 0 });
});

// ---------------------------------------------------------------------------
// Role menus
// ---------------------------------------------------------------------------

const roleMenuSchema = z.object({
  name: z.string().min(1).max(60),
  channelId: z.string().default(""),
  style: z.enum(["button", "select"]).default("button"),
  placeholder: z.string().max(150).default(""),
  minSelect: z.number().int().min(0).max(25).default(0),
  maxSelect: z.number().int().min(0).max(25).default(0),
  embed: messagePayloadSchema,
  options: z
    .array(
      z.object({
        roleId: z.string().regex(/^\d{5,25}$/),
        label: z.string().min(1).max(80),
        description: z.string().max(100).default(""),
        emoji: z.string().max(64).default(""),
        style: z.enum(["primary", "secondary", "success", "danger"]).default("secondary"),
      }),
    )
    .min(1)
    .max(25),
});

contentRouter.get("/:guildId/rolemenus", requireGuildAccess, async (req, res) => {
  const items = await prisma.roleMenu.findMany({ where: { guildId: req.guildId! }, orderBy: { name: "asc" } });
  res.json({ items, total: items.length });
});

contentRouter.post("/:guildId/rolemenus", requireGuildAccess, async (req, res) => {
  const parsed = roleMenuSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "validation_failed", details: parsed.error.issues });
    return;
  }

  const saved = await prisma.roleMenu.upsert({
    where: { guildId_name: { guildId: req.guildId!, name: parsed.data.name } },
    create: {
      ...parsed.data,
      guildId: req.guildId!,
      embed: parsed.data.embed as never,
      options: parsed.data.options as never,
    },
    update: { ...parsed.data, embed: parsed.data.embed as never, options: parsed.data.options as never },
  });

  await recordAudit(req, { guildId: req.guildId!, action: "rolemenu.save", module: "rolemenus", summary: parsed.data.name });
  res.json(saved);
});

contentRouter.post("/:guildId/rolemenus/:id/publish", requireGuildAccess, async (req, res) => {
  try {
    const result = await runAction({ action: "publishRoleMenu", guildId: req.guildId!, payload: { menuId: req.params.id } });
    res.status(result.ok ? 200 : 400).json(result);
  } catch {
    res.status(503).json({ ok: false, message: "The bot is not reachable right now." });
  }
});

contentRouter.delete("/:guildId/rolemenus/:id", requireGuildAccess, async (req, res) => {
  const deleted = await prisma.roleMenu.deleteMany({ where: { id: req.params.id, guildId: req.guildId! } });
  res.json({ ok: deleted.count > 0 });
});

// ---------------------------------------------------------------------------
// Sticky messages & scheduled posts
// ---------------------------------------------------------------------------

contentRouter.get("/:guildId/sticky", requireGuildAccess, async (req, res) => {
  const items = await prisma.stickyMessage.findMany({ where: { guildId: req.guildId! } });
  res.json({ items, total: items.length });
});

contentRouter.post("/:guildId/sticky", requireGuildAccess, async (req, res) => {
  const schema = z.object({
    channelId: z.string().regex(/^\d{5,25}$/),
    payload: messagePayloadSchema,
    messageGap: z.number().int().min(1).max(100).default(5),
    enabled: z.boolean().default(true),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "validation_failed", details: parsed.error.issues });
    return;
  }

  const saved = await prisma.stickyMessage.upsert({
    where: { channelId: parsed.data.channelId },
    create: { ...parsed.data, guildId: req.guildId!, payload: parsed.data.payload as never },
    update: { ...parsed.data, payload: parsed.data.payload as never },
  });
  res.json(saved);
});

contentRouter.delete("/:guildId/sticky/:id", requireGuildAccess, async (req, res) => {
  const deleted = await prisma.stickyMessage.deleteMany({ where: { id: req.params.id, guildId: req.guildId! } });
  res.json({ ok: deleted.count > 0 });
});

contentRouter.get("/:guildId/scheduled", requireGuildAccess, async (req, res) => {
  const items = await prisma.scheduledMessage.findMany({ where: { guildId: req.guildId! }, orderBy: { name: "asc" } });
  res.json({ items, total: items.length });
});

contentRouter.post("/:guildId/scheduled", requireGuildAccess, async (req, res) => {
  const schema = z.object({
    name: z.string().min(1).max(60),
    channelId: z.string().regex(/^\d{5,25}$/),
    payload: messagePayloadSchema,
    cron: z.string().max(100).optional().nullable(),
    runAt: z.string().datetime().optional().nullable(),
    timezone: z.string().max(60).default("UTC"),
    enabled: z.boolean().default(true),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "validation_failed", details: parsed.error.issues });
    return;
  }
  if (!parsed.data.cron && !parsed.data.runAt) {
    res.status(422).json({ error: "validation_failed", message: "Give either a cron expression or a one-off date." });
    return;
  }

  let nextRunAt: Date | null = parsed.data.runAt ? new Date(parsed.data.runAt) : null;
  if (parsed.data.cron) {
    try {
      const { Cron } = await import("croner");
      nextRunAt = new Cron(parsed.data.cron, { timezone: parsed.data.timezone }).nextRun();
    } catch {
      res.status(422).json({ error: "validation_failed", message: "That cron expression is not valid." });
      return;
    }
  }

  const saved = await prisma.scheduledMessage.upsert({
    where: { guildId_name: { guildId: req.guildId!, name: parsed.data.name } },
    create: {
      ...parsed.data,
      guildId: req.guildId!,
      payload: parsed.data.payload as never,
      runAt: parsed.data.runAt ? new Date(parsed.data.runAt) : null,
      nextRunAt,
      createdBy: req.session!.userId,
    },
    update: {
      ...parsed.data,
      payload: parsed.data.payload as never,
      runAt: parsed.data.runAt ? new Date(parsed.data.runAt) : null,
      nextRunAt,
    },
  });

  await invalidateConfig(req.guildId!);
  res.json(saved);
});

contentRouter.delete("/:guildId/scheduled/:id", requireGuildAccess, async (req, res) => {
  const deleted = await prisma.scheduledMessage.deleteMany({ where: { id: req.params.id, guildId: req.guildId! } });
  res.json({ ok: deleted.count > 0 });
});

export default contentRouter;
