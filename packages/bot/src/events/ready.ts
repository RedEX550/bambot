import { ActivityType, Events } from "discord.js";
import type { BotEvent } from "../core/types";
import { childLogger } from "../core/logger";
import { prisma } from "../core/db";

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
