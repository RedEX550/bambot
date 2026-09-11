import { Router } from "express";
import { MODULE_REGISTRY, MODULES, getModule, moduleDefaults, moduleGroups } from "@bambot/shared";
import { prisma } from "../db";
import { logger } from "../logger";
import { requireAuth, requireGuildAccess } from "../lib/auth";
import { invalidateConfig } from "../lib/bot";
import { diffSummary, recordAudit } from "../lib/audit";

export const configRouter: Router = Router();

configRouter.use(requireAuth);

/** The sidebar and form definitions the dashboard renders itself from. */
configRouter.get("/schema", (_req, res) => {
  res.json({
    groups: moduleGroups(),
    modules: Object.fromEntries(
      MODULES.map((name) => [
        name,
        {
          name,
          ui: MODULE_REGISTRY[name].ui,
          defaults: moduleDefaults(name),
        },
      ]),
    ),
  });
});

configRouter.get("/:guildId", requireGuildAccess, async (req, res) => {
  const guildId = req.guildId!;
  const rows = await prisma.guildConfig.findMany({ where: { guildId } });
  const byModule = new Map(rows.map((row) => [row.module, row]));

  const data: Record<string, unknown> = {};
  const meta: Record<string, { updatedAt: string | null; updatedBy: string | null }> = {};

  for (const name of MODULES) {
    const row = byModule.get(name);
    const mod = MODULE_REGISTRY[name];
    try {
      data[name] = mod.schema.parse(row?.data ?? {});
    } catch {
      // A row written by an older, incompatible build must not break the page.
      data[name] = moduleDefaults(name);
    }
    meta[name] = {
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  }

  res.json({ guildId, data, meta });
});

configRouter.get("/:guildId/:module", requireGuildAccess, async (req, res) => {
  const { module } = req.params;
  const definition = getModule(module);
  if (!definition) {
    res.status(404).json({ error: "unknown_module", message: `There is no "${module}" module.` });
    return;
  }

  const row = await prisma.guildConfig.findUnique({
    where: { guildId_module: { guildId: req.guildId!, module } },
  });

  let data: unknown;
  try {
    data = definition.schema.parse(row?.data ?? {});
  } catch {
    data = moduleDefaults(module);
  }

  res.json({
    module,
    data,
    ui: definition.ui,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    updatedBy: row?.updatedBy ?? null,
  });
});

/**
 * Saves a module.
 *
 * The payload is validated against the module schema before anything is
 * written, so a malformed dashboard build cannot poison the bot's config. The
 * parsed result (not the raw body) is what gets stored, which also fills in any
 * defaults the client did not send.
 */
configRouter.put("/:guildId/:module", requireGuildAccess, async (req, res) => {
  const { module } = req.params;
  const guildId = req.guildId!;
  const definition = getModule(module);

  if (!definition) {
    res.status(404).json({ error: "unknown_module", message: `There is no "${module}" module.` });
    return;
  }

  const parsed = definition.schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({
      error: "validation_failed",
      message: "Some settings are not valid.",
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  const existing = await prisma.guildConfig.findUnique({
    where: { guildId_module: { guildId, module } },
  });

  // The guild row must exist for the foreign key; it may not if the bot has
  // never been online since joining.
  await prisma.guild.upsert({
    where: { id: guildId },
    create: { id: guildId, name: "Unknown server" },
    update: {},
  });

  const saved = await prisma.guildConfig.upsert({
    where: { guildId_module: { guildId, module } },
    create: { guildId, module, data: parsed.data as never, updatedBy: req.session!.userId },
    update: { data: parsed.data as never, updatedBy: req.session!.userId },
  });

  await invalidateConfig(guildId, module);

  await recordAudit(req, {
    guildId,
    action: "config.update",
    module,
    summary: diffSummary(existing?.data, parsed.data),
    before: existing?.data,
    after: parsed.data,
  });

  logger.info({ guildId, module, userId: req.session!.userId }, "config saved");

  res.json({
    module,
    data: parsed.data,
    updatedAt: saved.updatedAt.toISOString(),
    updatedBy: saved.updatedBy,
  });
});

configRouter.post("/:guildId/:module/reset", requireGuildAccess, async (req, res) => {
  const { module } = req.params;
  const guildId = req.guildId!;
  if (!getModule(module)) {
    res.status(404).json({ error: "unknown_module", message: `There is no "${module}" module.` });
    return;
  }

  const existing = await prisma.guildConfig.findUnique({ where: { guildId_module: { guildId, module } } });
  const defaults = moduleDefaults(module);

  await prisma.guildConfig.upsert({
    where: { guildId_module: { guildId, module } },
    create: { guildId, module, data: defaults as never, updatedBy: req.session!.userId },
    update: { data: defaults as never, updatedBy: req.session!.userId },
  });

  await invalidateConfig(guildId, module);
  await recordAudit(req, { guildId, action: "config.reset", module, summary: "reset to defaults", before: existing?.data, after: defaults });

  res.json({ module, data: defaults });
});

/** Full config export, for backups and for moving settings between servers. */
configRouter.get("/:guildId/export/all", requireGuildAccess, async (req, res) => {
  const rows = await prisma.guildConfig.findMany({ where: { guildId: req.guildId! } });
  res.setHeader("content-disposition", `attachment; filename="bambot-config-${req.guildId}.json"`);
  res.json({
    exportedAt: new Date().toISOString(),
    guildId: req.guildId,
    version: 1,
    modules: Object.fromEntries(rows.map((row) => [row.module, row.data])),
  });
});

configRouter.post("/:guildId/import", requireGuildAccess, async (req, res) => {
  const guildId = req.guildId!;
  const modules = (req.body?.modules ?? {}) as Record<string, unknown>;

  const applied: string[] = [];
  const skipped: { module: string; reason: string }[] = [];

  for (const [module, data] of Object.entries(modules)) {
    const definition = getModule(module);
    if (!definition) {
      skipped.push({ module, reason: "unknown module" });
      continue;
    }
    const parsed = definition.schema.safeParse(data);
    if (!parsed.success) {
      skipped.push({ module, reason: parsed.error.issues[0]?.message ?? "invalid" });
      continue;
    }
    await prisma.guildConfig.upsert({
      where: { guildId_module: { guildId, module } },
      create: { guildId, module, data: parsed.data as never, updatedBy: req.session!.userId },
      update: { data: parsed.data as never, updatedBy: req.session!.userId },
    });
    applied.push(module);
  }

  await invalidateConfig(guildId);
  await recordAudit(req, { guildId, action: "config.import", summary: `imported ${applied.length} module(s)` });

  res.json({ applied, skipped });
});

export default configRouter;
