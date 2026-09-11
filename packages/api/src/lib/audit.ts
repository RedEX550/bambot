import type { Request } from "express";
import { prisma } from "../db";
import { logger } from "../logger";

/**
 * Records what changed on the dashboard.
 *
 * For a server this size, "who turned automod off at 3am" is the first question
 * anyone asks, so every mutating endpoint writes one of these. Payloads are
 * stored so a change can be reviewed, and reverted by hand if needed.
 */
export const recordAudit = async (
  req: Request,
  data: {
    guildId: string;
    action: string;
    module?: string;
    summary?: string;
    before?: unknown;
    after?: unknown;
  },
) => {
  if (!req.session) return;
  try {
    await prisma.dashboardAudit.create({
      data: {
        guildId: data.guildId,
        userId: req.session.userId,
        userTag: req.session.userTag,
        action: data.action,
        module: data.module,
        summary: data.summary ?? "",
        before: (data.before ?? null) as never,
        after: (data.after ?? null) as never,
        ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip ?? null,
      },
    });
  } catch (err) {
    logger.debug({ err }, "audit write failed");
  }
};

/** Summarises which top-level keys changed, for the audit list. */
export const diffSummary = (before: unknown, after: unknown): string => {
  if (!before || typeof before !== "object" || !after || typeof after !== "object") return "updated";
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  const changed: string[] = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) changed.push(key);
  }
  if (!changed.length) return "no changes";
  return `changed ${changed.slice(0, 6).join(", ")}${changed.length > 6 ? ` and ${changed.length - 6} more` : ""}`;
};
