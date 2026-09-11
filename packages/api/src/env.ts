import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  DISCORD_CLIENT_ID: z.string().min(5),
  DISCORD_CLIENT_SECRET: z.string().min(10, "DISCORD_CLIENT_SECRET is required for dashboard sign-in"),
  DISCORD_TOKEN: z.string().min(20),
  DATABASE_URL: z.string().min(1),
  // Pterodactyl injects SERVER_PORT for the primary allocation; it wins when set
  // so the panel's port assignment is always authoritative.
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  SERVER_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  /** Bind address. 0.0.0.0 is required inside a Pterodactyl container. */
  BIND_ADDRESS: z.string().default("0.0.0.0"),
  /**
   * Express trust-proxy setting. 0 when nothing sits in front (Pterodactyl
   * direct), 1 behind a single reverse proxy. Getting this wrong either breaks
   * rate limiting or lets clients spoof their IP, so it is explicit.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  /** Serve the built dashboard from this API process. Path to packages/web/dist. */
  SERVE_WEB_DIR: z.string().default(""),
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

const port = parsed.data.SERVER_PORT ?? parsed.data.API_PORT;

export const env = {
  ...parsed.data,
  port,
  isProduction: parsed.data.NODE_ENV === "production",
  /**
   * Cookies may only carry the Secure flag over HTTPS. Keying this off
   * PUBLIC_URL rather than NODE_ENV means a production deployment reached over
   * plain http://ip:port can still sign in, instead of silently dropping the
   * session cookie.
   */
  useSecureCookies: parsed.data.PUBLIC_URL.startsWith("https://"),
  corsOrigins: parsed.data.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
  ownerIds: parsed.data.BOT_OWNER_IDS.split(",").map((s) => s.trim()).filter(Boolean),
};
