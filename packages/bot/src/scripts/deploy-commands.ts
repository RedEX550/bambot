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

import { REST, Routes } from "discord.js";
import { env } from "../core/env";
import { logger } from "../core/logger";
import { BambotClient } from "../core/client";
import { loadCommands, loadContextMenus } from "../core/registry";

const main = async () => {
  const client = new BambotClient();
  loadCommands(client);
  loadContextMenus(client);

  const body = [
    ...client.commands.map((command) => command.data.toJSON()),
    ...client.contextMenus.map((command) => command.data.toJSON()),
  ];

  if (!body.length) {
    logger.error("No commands were found. Did you build the project first?");
    process.exit(1);
  }

  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);

  try {
    if (env.DEV_GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DEV_GUILD_ID), { body });
      logger.info({ count: body.length, guildId: env.DEV_GUILD_ID }, "guild commands registered (instant)");
    } else {
      await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body });
      logger.info({ count: body.length }, "global commands registered — allow up to an hour to appear");
    }

    logger.info(body.map((c) => `/${c.name}`).join("  "));
    process.exit(0);
  } catch (err) {
    logger.fatal({ err }, "command registration failed");
    process.exit(1);
  }
};

void main();
