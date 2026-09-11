import { Client, Collection, GatewayIntentBits, Options, Partials } from "discord.js";
import type { BotCommand, BotTask, ComponentHandler, ContextMenuCommand } from "./types";
import { config, ConfigService } from "./config";
import { childLogger } from "./logger";

const log = childLogger("client");

/**
 * The Discord client plus every registry the rest of the bot looks things up in.
 *
 * Intents are the full set the feature list needs: message content for automod,
 * levelling and auto-responders; members for welcome, autorole and raid
 * detection; presences are deliberately *not* requested — nothing needs them and
 * they are expensive at 40k members.
 */
export class BambotClient extends Client {
  readonly commands = new Collection<string, BotCommand>();
  readonly contextMenus = new Collection<string, ContextMenuCommand>();
  readonly components = new Collection<string, ComponentHandler>();
  readonly tasks = new Collection<string, BotTask>();
  readonly cooldowns = new Collection<string, Collection<string, number>>();
  readonly config: ConfigService = config;

  /** Guild IDs currently in raid mode, with the time it lifts. */
  readonly raidMode = new Collection<string, number>();

  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildEmojisAndStickers,
      ],
      partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction,
        Partials.GuildMember,
        Partials.User,
      ],
      allowedMentions: { parse: ["users", "roles"], repliedUser: false },
      // A 40k-member guild does not need every message cached forever.
      makeCache: Options.cacheWithLimits({
        ...Options.DefaultMakeCacheSettings,
        MessageManager: 200,
        PresenceManager: 0,
        GuildScheduledEventManager: 0,
      }),
      sweepers: {
        ...Options.DefaultSweeperSettings,
        messages: { interval: 600, lifetime: 1800 },
      },
    });
  }

  /** True while the guild is inside its raid-mode window. */
  isRaidMode(guildId: string): boolean {
    const until = this.raidMode.get(guildId);
    if (!until) return false;
    if (until < Date.now()) {
      this.raidMode.delete(guildId);
      return false;
    }
    return true;
  }

  setRaidMode(guildId: string, minutes: number) {
    this.raidMode.set(guildId, Date.now() + minutes * 60_000);
    log.warn({ guildId, minutes }, "raid mode engaged");
  }

  clearRaidMode(guildId: string) {
    this.raidMode.delete(guildId);
  }
}
