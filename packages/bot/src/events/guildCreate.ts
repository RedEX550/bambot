import type { BotEvent } from "../core/types";
import { prisma } from "../core/db";
import { childLogger } from "../core/logger";

const log = childLogger("guild");

export const guildCreate: BotEvent<"guildCreate"> = {
  name: "guildCreate",
  async execute(_client, guild) {
    log.info({ guildId: guild.id, name: guild.name, members: guild.memberCount }, "joined a guild");
    await prisma.guild
      .upsert({
        where: { id: guild.id },
        create: {
          id: guild.id,
          name: guild.name,
          iconHash: guild.icon,
          ownerId: guild.ownerId,
          memberCap: guild.memberCount,
        },
        update: { name: guild.name, iconHash: guild.icon, active: true },
      })
      .catch((err) => log.error({ err }, "failed to create guild row"));
  },
};

export const guildDelete: BotEvent<"guildDelete"> = {
  name: "guildDelete",
  async execute(_client, guild) {
    log.info({ guildId: guild.id }, "removed from a guild");
    // Rows are kept so settings survive a re-invite; only the flag flips.
    await prisma.guild.update({ where: { id: guild.id }, data: { active: false } }).catch(() => undefined);
  },
};

export default [guildCreate, guildDelete];
