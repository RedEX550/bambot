import pino from "pino";
import { env } from "./env";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "bambot" },
  ...(env.isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname,service" },
        },
      }),
});

export const childLogger = (name: string) => logger.child({ module: name });
