import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  ClientEvents,
  ContextMenuCommandBuilder,
  MessageContextMenuCommandInteraction,
  ModalSubmitInteraction,
  MessageComponentInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  UserContextMenuCommandInteraction,
} from "discord.js";
import type { ModuleName } from "@bambot/shared";
import type { BambotClient } from "./client";

/**
 * Permission tiers, checked in addition to Discord's own permission system.
 * Each tier implies the ones below it.
 */
export type PermissionTier = "everyone" | "staff" | "mod" | "admin" | "owner";

export type AnySlashBuilder =
  | SlashCommandBuilder
  | SlashCommandOptionsOnlyBuilder
  | SlashCommandSubcommandsOnlyBuilder
  | Omit<SlashCommandBuilder, "addSubcommand" | "addSubcommandGroup">;

export interface BotCommand {
  data: AnySlashBuilder;
  /** Disabling the owning module disables the command. */
  module?: ModuleName;
  permission?: PermissionTier;
  /** Per-user cooldown in seconds. */
  cooldown?: number;
  /** Refuse to run outside a guild. Defaults to true. */
  guildOnly?: boolean;
  /** Skip the generic "thinking" defer; the command replies itself. */
  noDefer?: boolean;
  /** Defer as ephemeral when deferring. */
  ephemeral?: boolean;
  execute(interaction: ChatInputCommandInteraction, client: BambotClient): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction, client: BambotClient): Promise<void>;
}

export interface ContextMenuCommand {
  data: ContextMenuCommandBuilder;
  module?: ModuleName;
  permission?: PermissionTier;
  execute(
    interaction: UserContextMenuCommandInteraction | MessageContextMenuCommandInteraction,
    client: BambotClient,
  ): Promise<void>;
}

/**
 * Components are routed by the first segment of their customId, so
 * `ticket:close:1042` reaches the handler registered with prefix "ticket"
 * and receives ["close", "1042"] as args.
 */
export interface ComponentHandler {
  prefix: string;
  /** Only the person who triggered the parent interaction may use it. */
  authorOnly?: boolean;
  execute(
    interaction: MessageComponentInteraction | ModalSubmitInteraction,
    args: string[],
    client: BambotClient,
  ): Promise<void>;
}

export interface BotEvent<K extends keyof ClientEvents = keyof ClientEvents> {
  name: K;
  once?: boolean;
  execute(client: BambotClient, ...args: ClientEvents[K]): Promise<void> | void;
}

/** A background job run on an interval by the scheduler. */
export interface BotTask {
  name: string;
  /** Interval in seconds, or a cron expression. */
  intervalSeconds?: number;
  cron?: string;
  /** Run once at startup as well. */
  runOnStart?: boolean;
  execute(client: BambotClient): Promise<void>;
}

export const definePermission = (tier: PermissionTier): PermissionTier => tier;
