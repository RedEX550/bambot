import { ChannelType, type Message } from "discord.js";
import type { BotEvent } from "../core/types";
import type { BambotClient } from "../core/client";
import { childLogger } from "../core/logger";
import { bumpDailyStat } from "../lib/stats";
import { runAutomod } from "../services/automod";
import { announceLevelUp, awardMessageXp } from "../services/leveling";
import {
  handleAfk,
  handleAutoResponders,
  handleHighlights,
  handleHmsDetect,
  handleKbAutoAnswer,
  handleMakerWorld,
  handleSticky,
} from "../services/message-features";
import { handleIncomingDm, trackTicketActivity } from "../services/modmail";

const log = childLogger("messageCreate");

/**
 * One feature at a time, each isolated.
 *
 * Every handler is awaited inside its own guard so that a failure in, say, the
 * MakerWorld fetch cannot stop levelling or automod from running. Automod is
 * the exception that short-circuits: if a message was deleted, nothing further
 * should act on it.
 */
const guard = async (name: string, fn: () => Promise<void>) => {
  try {
    await fn();
  } catch (err) {
    log.error({ err, feature: name }, "message feature failed");
  }
};

export const messageCreate: BotEvent<"messageCreate"> = {
  name: "messageCreate",
  async execute(client: BambotClient, message: Message) {
    if (message.author.bot) return;
    if (message.system) return;

    // Direct messages are the modmail entry point.
    if (!message.inGuild()) {
      await guard("modmail", () => handleIncomingDm(client, message));
      return;
    }

    if (message.channel.type === ChannelType.GuildStageVoice) return;

    const core = await client.config.get(message.guildId, "core");
    if (core.ignoredChannels.includes(message.channelId)) return;

    // Automod first — a deleted message should not earn XP or trigger replies.
    const actioned = await runAutomod(client, message, core).catch((err) => {
      log.error({ err }, "automod failed");
      return false;
    });
    if (actioned) return;

    bumpDailyStat(message.guildId, "messages");

    await guard("ticket-activity", () => trackTicketActivity(client, message));

    await guard("levelling", async () => {
      const result = await awardMessageXp(client, message);
      if (result?.levelledUp) await announceLevelUp(client, message, result.level);
    });

    await guard("afk", () => handleAfk(client, message));
    await guard("highlights", () => handleHighlights(client, message));
    await guard("auto-responders", () => handleAutoResponders(client, message));
    await guard("sticky", () => handleSticky(client, message));
    await guard("hms-detect", () => handleHmsDetect(client, message));
    await guard("makerworld", () => handleMakerWorld(client, message));
    await guard("kb-auto-answer", () => handleKbAutoAnswer(client, message));
  },
};

export default messageCreate;
