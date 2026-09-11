/**
 * Registers slash commands with Discord.
 *
 * Run once after every deployment that adds or changes a command:
 *   npm run deploy:commands
 *
 * With DEV_GUILD_ID set the commands are registered to that one guild, which is
 * instant. Without it they go global, which Discord can take up to an hour to
 * propagate — that is Discord's cache, not a bug here.
 */

import { logger } from "../core/logger";
import { BambotClient } from "../core/client";
import { loadCommands, loadContextMenus } from "../core/registry";
import { deployCommands } from "../core/deploy";

const main = async () => {
  const client = new BambotClient();
  loadCommands(client);
  loadContextMenus(client);

  const result = await deployCommands(client);

  if (!result.ok) {
    logger.fatal({ error: result.error }, "command registration failed");
    process.exit(1);
  }

  logger.info(
    { count: result.count, scope: result.scope },
    result.scope === "global"
      ? "global commands registered — allow up to an hour to appear"
      : "guild commands registered (instant)",
  );
  logger.info(result.names.map((name) => `/${name}`).join("  "));
  process.exit(0);
};

void main();
