import { Router } from "express";
import { z } from "zod";
import { messagePayloadSchema } from "@bambot/shared";
import { requireAuth, requireGuildAccess } from "../lib/auth";
import { BotUnavailableError, botHealth, runAction } from "../lib/bot";
import { recordAudit } from "../lib/audit";

export const actionsRouter: Router = Router();

actionsRouter.use(requireAuth);

/**
 * Actions are allow-listed rather than proxied.
 *
 * The bot's internal API is powerful, so the dashboard cannot ask it to do
 * anything it likes: each action has its own schema, and the guildId always
 * comes from the verified route parameter, never from the request body.
 */
const schemas = {
  publishPanel: z.object({ panelId: z.string().min(1).max(60) }),
  publishRoleMenu: z.object({ menuId: z.string().min(1).max(60) }),
  publishVerification: z.object({}),
  previewWelcome: z.object({ userId: z.string().regex(/^\d{5,25}$/).optional() }),
  reloadConfig: z.object({ module: z.string().max(40).optional() }),
  syncCounters: z.object({}),
  sendMessage: z.object({
    channelId: z.string().regex(/^\d{5,25}$/),
    message: messagePayloadSchema,
  }),
  closeTicket: z.object({
    channelId: z.string().regex(/^\d{5,25}$/),
    reason: z.string().max(500).default("Closed from the dashboard"),
  }),
} as const;

type ActionName = keyof typeof schemas;

actionsRouter.get("/health", async (_req, res) => {
  try {
    res.json({ bot: await botHealth() });
  } catch {
    res.status(503).json({ bot: null, message: "The bot is not reachable." });
  }
});

actionsRouter.post("/:guildId/:action", requireGuildAccess, async (req, res) => {
  const action = req.params.action as ActionName;
  const schema = schemas[action];

  if (!schema) {
    res.status(404).json({ error: "unknown_action", message: `There is no "${action}" action.` });
    return;
  }

  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(422).json({
      error: "validation_failed",
      message: "That action payload is not valid.",
      details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
    return;
  }

  try {
    const result = await runAction({
      action,
      guildId: req.guildId!,
      payload: parsed.data as Record<string, unknown>,
    });

    // Previews are read-only and would otherwise flood the audit log.
    if (action !== "previewWelcome" && action !== "reloadConfig") {
      await recordAudit(req, {
        guildId: req.guildId!,
        action: `action.${action}`,
        summary: result.message,
        after: parsed.data,
      });
    }

    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    if (err instanceof BotUnavailableError) {
      res.status(503).json({ ok: false, message: err.message });
      return;
    }
    throw err;
  }
});

export default actionsRouter;
