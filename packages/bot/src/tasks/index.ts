import { EmbedBuilder, type TextChannel } from "discord.js";
import { COLORS, EMOJI } from "@bambot/shared";
import type { BotTask } from "../core/types";
import { prisma } from "../core/db";
import { childLogger } from "../core/logger";
import { flushDailyStats } from "../lib/stats";
import { awardVoiceXp } from "../services/leveling";
import { syncCounters } from "../services/counters";
import { closeTicketByChannel } from "../services/ticket-actions";
import { endGiveaway } from "../services/giveaways";
import { checkReleases } from "../services/releases";

const log = childLogger("tasks");

/**
 * Lifts expired temporary punishments.
 *
 * Discord handles timeouts itself, so this only needs to unban members whose
 * timed ban has run out, and to mark the case inactive either way.
 */
export const expirySweeper: BotTask = {
  name: "expiry-sweeper",
  intervalSeconds: 60,
  runOnStart: true,
  async execute(client) {
    const due = await prisma.case.findMany({
      where: { active: true, expiresAt: { not: null, lte: new Date() } },
      take: 100,
    });

    for (const record of due) {
      const guild = client.guilds.cache.get(record.guildId);
      if (!guild) continue;

      try {
        if (record.type === "BAN") {
          await guild.members.unban(record.targetId, `Temporary ban expired (case #${record.caseNumber})`).catch(() => undefined);
        }
        if (record.type === "QUARANTINE") {
          const cfg = await client.config.get(guild.id, "automod");
          if (cfg.quarantineRoleId) {
            const member = await guild.members.fetch(record.targetId).catch(() => null);
            await member?.roles.remove(cfg.quarantineRoleId, "Quarantine expired").catch(() => undefined);
          }
        }
      } catch (err) {
        log.debug({ err, caseId: record.id }, "expiry action failed");
      }

      await prisma.case.update({ where: { id: record.id }, data: { active: false } }).catch(() => undefined);
    }

    // Raid mode windows lapse on their own; clear the flag so the flag list stays honest.
    for (const guildId of [...client.raidMode.keys()]) client.isRaidMode(guildId);
  },
};

/**
 * Closes inactive tickets and removes channels whose grace period has elapsed.
 * Doing the deletion here rather than only with setTimeout means a restart
 * cannot strand a closed ticket channel forever.
 */
export const ticketSweeper: BotTask = {
  name: "ticket-sweeper",
  intervalSeconds: 300,
  async execute(client) {
    for (const guild of client.guilds.cache.values()) {
      const cfg = await client.config.get(guild.id, "tickets");
      if (!cfg.enabled) continue;

      // 1. Delete channels for tickets closed longer than the grace period.
      if (cfg.deleteChannelAfterCloseMinutes > 0) {
        const cutoff = new Date(Date.now() - cfg.deleteChannelAfterCloseMinutes * 60_000);
        const stale = await prisma.ticket.findMany({
          where: { guildId: guild.id, status: "CLOSED", closedAt: { lte: cutoff } },
          take: 25,
        });
        for (const ticket of stale) {
          const channel = guild.channels.cache.get(ticket.channelId);
          if (channel) await channel.delete("Closed ticket grace period elapsed").catch(() => undefined);
        }
      }

      // 2. Warn about, then auto-close, inactive tickets.
      const open = await prisma.ticket.findMany({
        where: { guildId: guild.id, status: { not: "CLOSED" } },
        take: 100,
      });

      for (const ticket of open) {
        const category = cfg.categories.find((c) => c.key === ticket.categoryKey);
        if (!category || category.autoCloseHours === 0) continue;

        const channel = guild.channels.cache.get(ticket.channelId) as TextChannel | undefined;
        if (!channel) {
          await prisma.ticket
            .update({ where: { id: ticket.id }, data: { status: "CLOSED", closedAt: new Date(), closeReason: "Channel deleted" } })
            .catch(() => undefined);
          continue;
        }

        const lastMessage = await channel.messages.fetch({ limit: 1 }).then((c) => c.first()).catch(() => null);
        const lastActivity = lastMessage?.createdTimestamp ?? ticket.createdAt.getTime();
        const idleHours = (Date.now() - lastActivity) / 3_600_000;

        if (idleHours >= category.autoCloseHours) {
          await closeTicketByChannel(
            client,
            guild,
            ticket.channelId,
            { id: client.user!.id, tag: "Bambot" },
            `Closed automatically after ${category.autoCloseHours}h with no activity`,
          ).catch(() => undefined);
          continue;
        }

        if (category.inactivityWarningHours > 0 && idleHours >= category.inactivityWarningHours && lastMessage?.author.id !== client.user?.id) {
          await channel
            .send({
              embeds: [
                new EmbedBuilder()
                  .setColor(COLORS.warning)
                  .setDescription(
                    `${EMOJI.warning} This ticket has been quiet for ${Math.floor(idleHours)} hours and will close automatically after ${category.autoCloseHours}h. Send a message if you still need help.`,
                  ),
              ],
            })
            .catch(() => undefined);
        }
      }
    }
  },
};

/** Alerts staff when a ticket breaches its first-response target. */
export const slaWatcher: BotTask = {
  name: "sla-watcher",
  intervalSeconds: 180,
  async execute(client) {
    for (const guild of client.guilds.cache.values()) {
      const cfg = await client.config.get(guild.id, "tickets");
      if (!cfg.enabled || cfg.slaMinutes === 0 || !cfg.alertChannelId) continue;

      const cutoff = new Date(Date.now() - cfg.slaMinutes * 60_000);
      const breached = await prisma.ticket.findMany({
        where: {
          guildId: guild.id,
          status: "OPEN",
          firstResponseAt: null,
          createdAt: { lte: cutoff },
          tags: { isEmpty: true },
        },
        take: 20,
      });
      if (!breached.length) continue;

      const channel = guild.channels.cache.get(cfg.alertChannelId);
      if (!channel?.isTextBased()) continue;

      await channel
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.danger)
              .setTitle(`${EMOJI.warning} ${breached.length} ticket(s) past the ${cfg.slaMinutes}-minute response target`)
              .setDescription(
                breached
                  .map((t) => `• <#${t.channelId}> — #${t.ticketNumber}, opened <t:${Math.floor(t.createdAt.getTime() / 1000)}:R>`)
                  .join("\n")
                  .slice(0, 4000),
              )
              .setTimestamp(new Date()),
          ],
        })
        .catch(() => undefined);

      // Tag them so the same breach is not reported every three minutes.
      await prisma.ticket
        .updateMany({ where: { id: { in: breached.map((t) => t.id) } }, data: { tags: ["sla-alerted"] } })
        .catch(() => undefined);
    }
  },
};

export const giveawayTask: BotTask = {
  name: "giveaway-ender",
  intervalSeconds: 30,
  async execute(client) {
    const due = await prisma.giveaway.findMany({ where: { ended: false, endsAt: { lte: new Date() } }, take: 20 });
    for (const giveaway of due) {
      const guild = client.guilds.cache.get(giveaway.guildId);
      if (!guild) continue;
      await endGiveaway(client, guild, giveaway.id).catch((err) => log.error({ err }, "giveaway end failed"));
    }
  },
};

export const reminderTask: BotTask = {
  name: "reminders",
  intervalSeconds: 30,
  async execute(client) {
    const due = await prisma.reminder.findMany({ where: { fired: false, remindAt: { lte: new Date() } }, take: 50 });

    for (const reminder of due) {
      const user = await client.users.fetch(reminder.userId).catch(() => null);
      const embed = new EmbedBuilder()
        .setColor(COLORS.info)
        .setTitle("⏰ Reminder")
        .setDescription(reminder.content)
        .setTimestamp(reminder.createdAt)
        .setFooter({ text: "Set with /remind" });

      let delivered = false;
      if (user) delivered = await user.send({ embeds: [embed] }).then(() => true).catch(() => false);

      // DMs closed: fall back to the channel it was set in.
      if (!delivered) {
        const channel = client.channels.cache.get(reminder.channelId);
        if (channel?.isTextBased() && "send" in channel) {
          await channel.send({ content: `<@${reminder.userId}>`, embeds: [embed] }).catch(() => undefined);
        }
      }

      await prisma.reminder.update({ where: { id: reminder.id }, data: { fired: true } }).catch(() => undefined);
    }
  },
};

export const scheduledMessageTask: BotTask = {
  name: "scheduled-messages",
  intervalSeconds: 60,
  async execute(client) {
    const due = await prisma.scheduledMessage.findMany({
      where: { enabled: true, OR: [{ nextRunAt: { lte: new Date() } }, { runAt: { lte: new Date() }, lastRunAt: null }] },
      take: 25,
    });

    for (const scheduled of due) {
      const guild = client.guilds.cache.get(scheduled.guildId);
      const channel = guild?.channels.cache.get(scheduled.channelId);
      if (!channel?.isTextBased()) continue;

      const { buildMessage } = await import("../lib/payload");
      const built = buildMessage(scheduled.payload as never, { guild });
      await channel.send({ content: built.content, embeds: built.embeds, components: built.components }).catch(() => undefined);

      let nextRunAt: Date | null = null;
      if (scheduled.cron) {
        try {
          const { Cron } = await import("croner");
          nextRunAt = new Cron(scheduled.cron, { timezone: scheduled.timezone }).nextRun();
        } catch (err) {
          log.warn({ err, id: scheduled.id }, "invalid cron expression, disabling");
        }
      }

      await prisma.scheduledMessage
        .update({
          where: { id: scheduled.id },
          data: { lastRunAt: new Date(), nextRunAt, enabled: Boolean(nextRunAt) || !scheduled.cron ? scheduled.enabled : false },
        })
        .catch(() => undefined);
    }
  },
};

export const counterTask: BotTask = {
  name: "stat-channels",
  intervalSeconds: 360,
  async execute(client) {
    for (const guild of client.guilds.cache.values()) {
      await syncCounters(client, guild).catch(() => undefined);
    }
  },
};

export const voiceXpTask: BotTask = {
  name: "voice-xp",
  intervalSeconds: 60,
  async execute(client) {
    await awardVoiceXp(client);
  },
};

export const statsFlushTask: BotTask = {
  name: "stats-flush",
  intervalSeconds: 60,
  async execute(client) {
    await flushDailyStats();

    // Snapshot the member count once an hour so the growth chart has a baseline.
    if (new Date().getMinutes() < 1) {
      const date = new Date();
      date.setUTCHours(0, 0, 0, 0);
      for (const guild of client.guilds.cache.values()) {
        await prisma.dailyStat
          .upsert({
            where: { guildId_date: { guildId: guild.id, date } },
            create: { guildId: guild.id, date, memberCount: guild.memberCount },
            update: { memberCount: guild.memberCount },
          })
          .catch(() => undefined);
      }
    }
  },
};

export const releaseTask: BotTask = {
  name: "release-watcher",
  intervalSeconds: 1800,
  runOnStart: true,
  async execute(client) {
    await checkReleases(client);
  },
};

/** Old analytics rows are not worth keeping forever. */
export const pruneTask: BotTask = {
  name: "prune",
  cron: "0 4 * * *",
  async execute() {
    const ninetyDays = new Date(Date.now() - 90 * 86_400_000);
    await prisma.commandUsage.deleteMany({ where: { createdAt: { lt: ninetyDays } } }).catch(() => undefined);
    await prisma.automodHit.deleteMany({ where: { createdAt: { lt: ninetyDays } } }).catch(() => undefined);
    await prisma.memberSnapshot.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 180 * 86_400_000) } } }).catch(() => undefined);
    await prisma.reminder.deleteMany({ where: { fired: true, remindAt: { lt: ninetyDays } } }).catch(() => undefined);
    log.info("daily prune complete");
  },
};

export default [
  expirySweeper,
  ticketSweeper,
  slaWatcher,
  giveawayTask,
  reminderTask,
  scheduledMessageTask,
  counterTask,
  voiceXpTask,
  statsFlushTask,
  releaseTask,
  pruneTask,
];
