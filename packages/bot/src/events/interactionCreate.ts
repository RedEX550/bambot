import {
  Collection,
  GuildMember,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Interaction,
  type RepliableInteraction,
} from "discord.js";
import type { BotEvent, PermissionTier } from "../core/types";
import { childLogger } from "../core/logger";
import { prisma } from "../core/db";
import { errorEmbed } from "../lib/embeds";
import { resolveTier, tierAtLeast } from "../lib/permissions";
import { formatDuration } from "../lib/time";

const log = childLogger("interactions");

const TIER_LABELS: Record<PermissionTier, string> = {
  everyone: "anyone",
  staff: "support staff",
  mod: "moderators",
  admin: "administrators",
  owner: "the server owner",
};

const respond = async (interaction: RepliableInteraction, message: string) => {
  const payload = { embeds: [errorEmbed(message)], flags: MessageFlags.Ephemeral as const };
  try {
    if (interaction.deferred) await interaction.editReply({ embeds: payload.embeds });
    else if (interaction.replied) await interaction.followUp(payload);
    else await interaction.reply(payload);
  } catch (err) {
    log.debug({ err }, "could not deliver an error response");
  }
};

/** Records usage asynchronously; analytics must never slow down a reply. */
const recordUsage = (guildId: string | null, userId: string, command: string, success: boolean, durationMs: number) => {
  prisma.commandUsage
    .create({ data: { guildId, userId, command, success, durationMs } })
    .catch((err) => log.debug({ err }, "failed to record command usage"));
};

const checkCooldown = (
  cooldowns: Collection<string, Collection<string, number>>,
  commandName: string,
  userId: string,
  seconds: number,
): number | null => {
  if (!seconds) return null;
  let bucket = cooldowns.get(commandName);
  if (!bucket) {
    bucket = new Collection<string, number>();
    cooldowns.set(commandName, bucket);
  }
  const now = Date.now();
  const expires = bucket.get(userId);
  if (expires && expires > now) return expires - now;
  bucket.set(userId, now + seconds * 1000);
  return null;
};

const handleChatInput = async (interaction: ChatInputCommandInteraction, client: Parameters<BotEvent["execute"]>[0]) => {
  const command = client.commands.get(interaction.commandName);
  if (!command) {
    await respond(interaction, "That command is no longer available. Try again in a moment.");
    return;
  }

  const started = Date.now();
  const guildOnly = command.guildOnly !== false;

  if (guildOnly && !interaction.inGuild()) {
    await respond(interaction, "That command only works inside a server.");
    return;
  }

  try {
    if (interaction.inGuild() && interaction.guild) {
      const core = await client.config.get(interaction.guildId, "core");

      if (core.disabledCommands.includes(interaction.commandName)) {
        await respond(interaction, "That command is switched off in this server.");
        return;
      }

      if (command.module) {
        const moduleConfig = (await client.config.get(interaction.guildId, command.module)) as { enabled?: boolean };
        if (moduleConfig && moduleConfig.enabled === false) {
          await respond(interaction, `The **${command.module}** module is switched off in this server.`);
          return;
        }
      }

      const required = command.permission ?? "everyone";
      if (required !== "everyone") {
        // interaction.member may be the raw API shape; resolve a real GuildMember.
        const member =
          interaction.member instanceof GuildMember
            ? interaction.member
            : await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member) {
          await respond(interaction, "I could not check your permissions. Try again.");
          return;
        }
        const tier = resolveTier(member, core);
        if (!tierAtLeast(tier, required)) {
          await respond(interaction, `That command is limited to ${TIER_LABELS[required]}.`);
          return;
        }
      }
    }

    const remaining = checkCooldown(client.cooldowns, command.data.name, interaction.user.id, command.cooldown ?? 0);
    if (remaining) {
      await respond(interaction, `Slow down — try again in ${formatDuration(remaining)}.`);
      return;
    }

    if (!command.noDefer && !interaction.deferred && !interaction.replied) {
      const ephemeral = command.ephemeral ?? false;
      await interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
    }

    await command.execute(interaction, client);
    recordUsage(interaction.guildId, interaction.user.id, interaction.commandName, true, Date.now() - started);
  } catch (err) {
    log.error({ err, command: interaction.commandName, guildId: interaction.guildId }, "command failed");
    recordUsage(interaction.guildId, interaction.user.id, interaction.commandName, false, Date.now() - started);
    await respond(interaction, "Something went wrong running that. The error has been logged.");
  }
};

export const interactionCreate: BotEvent<"interactionCreate"> = {
  name: "interactionCreate",
  async execute(client, interaction: Interaction) {
    if (interaction.isChatInputCommand()) {
      await handleChatInput(interaction, client);
      return;
    }

    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (!command?.autocomplete) return;
      try {
        await command.autocomplete(interaction, client);
      } catch (err) {
        log.debug({ err, command: interaction.commandName }, "autocomplete failed");
        if (!interaction.responded) await interaction.respond([]).catch(() => undefined);
      }
      return;
    }

    if (interaction.isContextMenuCommand()) {
      const command = client.contextMenus.get(interaction.commandName);
      if (!command) return;
      try {
        await command.execute(interaction, client);
      } catch (err) {
        log.error({ err, command: interaction.commandName }, "context menu failed");
        await respond(interaction, "Something went wrong. The error has been logged.");
      }
      return;
    }

    if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
      const [prefix, ...args] = interaction.customId.split(":");
      if (prefix === "noop") return;

      const handler = client.components.get(prefix);
      if (!handler) {
        // Usually a panel left over from an older deployment.
        await respond(interaction, "This control is from an older version and no longer works. Ask staff to refresh the panel.");
        return;
      }

      try {
        await handler.execute(interaction, args, client);
      } catch (err) {
        log.error({ err, customId: interaction.customId }, "component handler failed");
        await respond(interaction, "Something went wrong. The error has been logged.");
      }
    }
  },
};

export default interactionCreate;
