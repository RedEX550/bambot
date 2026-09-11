import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  DISCORD_TOKEN: z.string().min(20, "DISCORD_TOKEN is missing or malformed"),
  DISCORD_CLIENT_ID: z.string().min(5),
  DATABASE_URL: z.string().min(1),
  DEV_GUILD_ID: z.string().optional().default(""),
  BOT_INTERNAL_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  INTERNAL_API_KEY: z.string().min(8, "INTERNAL_API_KEY must be at least 8 characters"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  BOT_OWNER_IDS: z.string().default(""),
  TRANSCRIPT_DIR: z.string().default("./data/transcripts"),
  PUBLIC_URL: z.string().default("http://localhost:5173"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  // eslint-disable-next-line no-console
  console.error(`\nBambot cannot start: the environment is incomplete.\n${issues}\n\nCopy .env.example to .env and fill it in.\n`);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  ownerIds: parsed.data.BOT_OWNER_IDS.split(",").map((s) => s.trim()).filter(Boolean),
  isProduction: parsed.data.NODE_ENV === "production",
};
