import { env } from "./core/env";
import { logger } from "./core/logger";
import { BambotClient } from "./core/client";
import { loadAll, loadTasks, stopTasks } from "./core/registry";
import { startInternalServer } from "./core/internal-server";
import { disconnectDb } from "./core/db";

const client = new BambotClient();

const main = async () => {
  loadAll(client);
  loadTasks(client);

  const internal = startInternalServer(client);

  await client.login(env.DISCORD_TOKEN);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    stopTasks();
    internal.close();
    client.destroy();
    await disconnectDb();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

// Discord.js surfaces a lot through these; losing the process on a transient
// gateway hiccup would be worse than logging and carrying on.
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception");
});

main().catch((err) => {
  logger.fatal({ err }, "failed to start");
  process.exit(1);
});
