import type { Guild } from "discord.js";
import type { BambotClient } from "../core/client";
import { config } from "../core/config";
import { prisma } from "../core/db";
import { childLogger } from "../core/logger";

const log = childLogger("counters");

/**
 * Renames the configured stat channels.
 *
 * Discord rate limits channel renames to two per ten minutes per channel, and
 * the limit is silent: the request simply hangs. The module schema enforces a
 * six minute floor, and a rename is skipped entirely when the name has not
 * changed, which is the usual case between ticks.
 */
export const syncCounters = async (client: BambotClient, guild: Guild): Promise<number> => {
  const cfg = await config.get(guild.id, "counters");
  if (!cfg.enabled || !cfg.counters.length) return 0;

  const openTickets = cfg.counters.some((c) => c.metric === "ticketsOpen")
    ? await prisma.ticket.count({ where: { guildId: guild.id, status: { not: "CLOSED" } } })
    : 0;

  let members = guild.memberCount;
  let humans = 0;
  let bots = 0;
  const needsMemberScan = cfg.counters.some((c) => ["humans", "bots", "roleCount"].includes(c.metric));
  if (needsMemberScan) {
    const fetched = await guild.members.fetch().catch(() => null);
    if (fetched) {
      members = fetched.size;
      bots = fetched.filter((m) => m.user.bot).size;
      humans = members - bots;
    }
  }

  let updated = 0;
  for (const counter of cfg.counters) {
    if (!counter.enabled) continue;
    const channel = guild.channels.cache.get(counter.channelId);
    if (!channel || !channel.manageable) continue;

    let value = 0;
    switch (counter.metric) {
      case "members":
        value = guild.memberCount;
        break;
      case "humans":
        value = humans;
        break;
      case "bots":
        value = bots;
        break;
      case "boosts":
        value = guild.premiumSubscriptionCount ?? 0;
        break;
      case "ticketsOpen":
        value = openTickets;
        break;
      case "roleCount":
        value = counter.roleId ? (guild.roles.cache.get(counter.roleId)?.members.size ?? 0) : 0;
        break;
      case "online":
        // Requires the presence intent, which Bambot deliberately does not ask for.
        value = guild.approximatePresenceCount ?? 0;
        break;
      default:
        value = guild.memberCount;
    }

    const name = counter.template
      .replace(/\{count\}/g, value.toLocaleString("en-US"))
      .replace(/\{members\}/g, guild.memberCount.toLocaleString("en-US"))
      .replace(/\{boosts\}/g, String(guild.premiumSubscriptionCount ?? 0))
      .replace(/\{tickets\.open\}/g, String(openTickets))
      .slice(0, 100);

    if (channel.name === name) continue;

    try {
      await channel.setName(name, "Stat channel update");
      updated += 1;
    } catch (err) {
      log.debug({ err, channelId: channel.id }, "counter rename failed (usually the rename rate limit)");
    }
  }

  return updated;
};
