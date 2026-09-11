import pino from "pino";
import { env } from "./env";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "bambot-api" },
  redact: {
    // Never let a token reach the logs.
    paths: ["req.headers.cookie", "req.headers.authorization", "accessToken", "refreshToken", "*.accessToken"],
    remove: true,
  },
});
