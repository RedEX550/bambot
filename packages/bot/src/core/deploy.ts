import { REST, Routes } from "discord.js";
import { env } from "./env";
import { childLogger } from "./logger";
import type { BambotClient } from "./client";

const log = childLogger("deploy");

export interface DeployResult {
  ok: boolean;
  count: number;
  scope: "guild" | "global";
  names: string[];
  error?: string;
}

/**
 * Registers the loaded slash commands with Discord.
 *
 * Shared by the standalone `deploy-commands` script and the optional
 * deploy-on-boot path. Panels such as Pterodactyl give the operator no shell,
 * so being able to do this from a environment variable is the difference
 * between a working install and a bot with no commands.
 *
 * Discord treats the payload as the complete set: anything not included is
 * removed, which is what makes this safe to run on every boot.
 */
export const deployCommands = async (client: BambotClient): Promise<DeployResult> => {
  const body = [
    ...client.commands.map((command) => command.data.toJSON()),
    ...client.contextMenus.map((command) => command.data.toJSON()),
  ];

  const names = body.map((command) => command.name).sort();
  const scope: "guild" | "global" = env.DEV_GUILD_ID ? "guild" : "global";

  if (!body.length) {
    return { ok: false, count: 0, scope, names, error: "No commands were loaded." };
  }

  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);

  try {
    if (env.DEV_GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DEV_GUILD_ID), { body });
    } else {
      await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body });
    }
    return { ok: true, count: body.length, scope, names };
  } catch (err) {
    log.error({ err }, "command registration failed");
    return {
      ok: false,
      count: 0,
      scope,
      names,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};
