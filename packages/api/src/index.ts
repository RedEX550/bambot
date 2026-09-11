import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./env";
import { logger } from "./logger";
import { prisma } from "./db";
import { authRouter } from "./routes/auth";
import { configRouter } from "./routes/config";
import { guildsRouter } from "./routes/guilds";
import { actionsRouter } from "./routes/actions";
import { dataRouter } from "./routes/data";
import { contentRouter } from "./routes/content";

const app = express();

// Behind nginx, so the real client IP comes from X-Forwarded-For.
app.set("trust proxy", 1);

app.use(
  helmet({
    // The dashboard is served separately; transcripts set their own CSP.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

app.use(
  cors({
    origin: (origin, callback) => {
      // Same-origin requests and curl have no Origin header.
      if (!origin) return callback(null, true);
      if (env.corsOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`Origin ${origin} is not allowed`));
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

/**
 * Two rate limits.
 *
 * The sign-in flow is the expensive one because it hits Discord, so it gets a
 * tighter budget than ordinary dashboard reads.
 */
const generalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "rate_limited", message: "Slow down a moment." },
});

const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "rate_limited", message: "Too many sign-in attempts. Wait a minute." },
});

app.get("/api/health", async (_req, res) => {
  let database = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = true;
  } catch {
    database = false;
  }
  res.status(database ? 200 : 503).json({ ok: database, database, uptimeSeconds: Math.floor(process.uptime()) });
});

app.use("/api/auth", authLimiter, authRouter);
app.use("/api/config", generalLimiter, configRouter);
app.use("/api/guilds", generalLimiter, guildsRouter);
app.use("/api/actions", generalLimiter, actionsRouter);
app.use("/api/data", generalLimiter, dataRouter);
app.use("/api/content", generalLimiter, contentRouter);

app.use((req, res) => {
  res.status(404).json({ error: "not_found", message: `No route for ${req.method} ${req.path}` });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err, path: req.path, method: req.method }, "unhandled API error");
  if (res.headersSent) return;
  res.status(500).json({
    error: "internal_error",
    message: env.isProduction ? "Something went wrong." : err.message,
  });
});

const server = app.listen(env.API_PORT, () => {
  logger.info({ port: env.API_PORT, env: env.NODE_ENV }, "Bambot API listening");
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, "shutting down");
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => logger.error({ reason }, "unhandled rejection"));

export default app;
