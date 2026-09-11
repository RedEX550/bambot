import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  DISCORD_CLIENT_ID: z.string().min(5),
  DISCORD_CLIENT_SECRET: z.string().min(10, "DISCORD_CLIENT_SECRET is required for dashboard sign-in"),
  DISCORD_TOKEN: z.string().min(20),
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  SESSION_SECRET: z.string().min(24, "SESSION_SECRET must be at least 24 characters"),
  PUBLIC_URL: z.string().default("http://localhost:5173"),
  OAUTH_REDIRECT_URI: z.string().default("http://localhost:4000/api/auth/callback"),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  BOT_INTERNAL_URL: z.string().default("http://localhost:4100"),
  INTERNAL_API_KEY: z.string().min(8),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  BOT_OWNER_IDS: z.string().default(""),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  // eslint-disable-next-line no-console
  console.error(`\nThe API cannot start: the environment is incomplete.\n${issues}\n`);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === "production",
  corsOrigins: parsed.data.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
  ownerIds: parsed.data.BOT_OWNER_IDS.split(",").map((s) => s.trim()).filter(Boolean),
};
