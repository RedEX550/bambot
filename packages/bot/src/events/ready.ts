import { ActivityType, Events } from "discord.js";
import type { BotEvent } from "../core/types";
import { childLogger } from "../core/logger";
import { prisma } from "../core/db";
import { env } from "../core/env";
import { deployCommands } from "../core/deploy";

const log = childLogger("ready");

export const ready: BotEvent<"clientReady"> = {
  name: Events.ClientReady as "clientReady",
  once: true,
  async execute(client) {
    const user = client.user;
    if (!user) return;

    log.info(
      { tag: user.tag, guilds: client.guilds.cache.size, commands: client.commands.size },
      "Bambot is online",
    );

    if (env.AUTO_DEPLOY_COMMANDS) {
      const result = await deployCommands(client);
      if (result.ok) {
        log.info(
          { count: result.count, scope: result.scope },
          result.scope === "global"
            ? "slash commands registered globally — Discord can take up to an hour to show them"
            : "slash commands registered to the dev guild",
        );
      } else {
        log.error({ error: result.error }, "automatic command registration failed");
      }
    }

    user.setPresence({
      status: "online",
      activities: [{ name: "/help • bambot dashboard", type: ActivityType.Listening }],
    });

    // Keep the guild table in step with reality so the dashboard guild list is
    // accurate even after the bot was added or removed while offline.
    for (const guild of client.guilds.cache.values()) {
      try {
        await prisma.guild.upsert({
          where: { id: guild.id },
          create: {
            id: guild.id,
            name: guild.name,
            iconHash: guild.icon,
            ownerId: guild.ownerId,
            memberCap: guild.memberCount,
            active: true,
          },
          update: {
            name: guild.name,
            iconHash: guild.icon,
            ownerId: guild.ownerId,
            memberCap: guild.memberCount,
            active: true,
          },
        });
      } catch (err) {
        log.error({ err, guildId: guild.id }, "failed to sync guild row");
      }
    }
  },
};

export default ready;
