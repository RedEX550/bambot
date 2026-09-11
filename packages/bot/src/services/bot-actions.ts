import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type Guild } from "discord.js";
import type { BotActionRequest, BotActionResult, MessagePayload } from "@bambot/shared";
import { messagePayloadSchema } from "@bambot/shared";
import type { BambotClient } from "../core/client";
import { config } from "../core/config";
import { childLogger } from "../core/logger";
import { buildMessage } from "../lib/payload";
import { render } from "../lib/placeholders";
import { renderWelcomeBuffer } from "../lib/welcome-image";
import { publishPanel } from "./tickets";
import { publishRoleMenu } from "./rolemenus";
import { syncCounters } from "./counters";
import { closeTicketByChannel } from "./ticket-actions";

const log = childLogger("bot-actions");

const fail = (message: string): BotActionResult => ({ ok: false, message });

/**
 * Everything the dashboard can ask the running bot to do.
 *
 * Config changes are written to the database by the API; these are the actions
 * that need the live gateway connection — publishing a message, rendering a
 * preview with real member data, or acting on a channel.
 */
export const runBotAction = async (client: BambotClient, request: BotActionRequest): Promise<BotActionResult> => {
  const guild = client.guilds.cache.get(request.guildId);
  if (!guild) return fail("Bambot is not in that server.");
  const payload = (request.payload ?? {}) as Record<string, unknown>;

  try {
    switch (request.action) {
      case "publishPanel": {
        const panelId = String(payload.panelId ?? "");
        if (!panelId) return fail("No panel was specified.");
        return await publishPanel(guild, panelId);
      }

      case "publishRoleMenu": {
        const menuId = String(payload.menuId ?? "");
        if (!menuId) return fail("No menu was specified.");
        return await publishRoleMenu(guild, menuId);
      }

      case "publishVerification":
        return await publishVerificationPanel(guild);

      case "previewWelcome":
        return await previewWelcome(client, guild, String(payload.userId ?? ""));

      case "reloadConfig": {
        config.invalidate(guild.id, payload.module ? String(payload.module) : undefined);
        return { ok: true, message: "Configuration reloaded." };
      }

      case "sendMessage": {
        const channelId = String(payload.channelId ?? "");
        const channel = guild.channels.cache.get(channelId);
        if (!channel?.isTextBased()) return fail("That channel does not exist or is not a text channel.");
        const parsed = messagePayloadSchema.safeParse(payload.message);
        if (!parsed.success) return fail("The message payload is not valid.");
        const built = buildMessage(parsed.data as MessagePayload, { guild });
        const sent = await channel.send({ content: built.content, embeds: built.embeds, components: built.components });
        return { ok: true, message: `Sent to #${channel.name}.`, data: { messageId: sent.id } };
      }

      case "syncCounters": {
        const updated = await syncCounters(client, guild);
        return { ok: true, message: `${updated} counter(s) updated.` };
      }

      case "closeTicket": {
        const channelId = String(payload.channelId ?? "");
        const reason = String(payload.reason ?? "Closed from the dashboard");
        const actorTag = String(payload.actorTag ?? "Dashboard");
        const actorId = String(payload.actorId ?? client.user?.id ?? "0");
        return await closeTicketByChannel(client, guild, channelId, { id: actorId, tag: actorTag }, reason);
      }

      default:
        return fail(`Unknown action: ${String(request.action)}`);
    }
  } catch (err) {
    log.error({ err, action: request.action, guildId: request.guildId }, "bot action failed");
    return fail("The bot could not complete that action. Check the bot logs.");
  }
};

const publishVerificationPanel = async (guild: Guild): Promise<BotActionResult> => {
  const cfg = await config.get(guild.id, "verification");
  if (!cfg.channelId) return fail("Choose a verification channel first.");
  const channel = guild.channels.cache.get(cfg.channelId);
  if (!channel?.isTextBased()) return fail("The verification channel is missing.");
  if (!cfg.verifiedRoleId) return fail("Choose the role to grant on success first.");

  const role = guild.roles.cache.get(cfg.verifiedRoleId);
  const me = guild.members.me;
  if (role && me && role.position >= me.roles.highest.position) {
    return fail(`I cannot assign @${role.name} — move my role above it in Server Settings.`);
  }

  const built = buildMessage(cfg.message, { guild });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("verify:start").setLabel(cfg.buttonLabel || "Verify me").setStyle(ButtonStyle.Success).setEmoji("🔓"),
  );

  const sent = await channel.send({ content: built.content, embeds: built.embeds, components: [row] });
  return { ok: true, message: `Verification panel posted in #${channel.name}.`, data: { messageId: sent.id } };
};

/**
 * Renders the welcome banner exactly as a real join would, using a real member
 * so the dashboard preview is honest about how placeholders resolve.
 */
const previewWelcome = async (client: BambotClient, guild: Guild, userId: string): Promise<BotActionResult> => {
  const cfg = await config.get(guild.id, "welcome");
  const member =
    (userId ? await guild.members.fetch(userId).catch(() => null) : null) ??
    guild.members.me ??
    (await guild.members.fetchMe().catch(() => null));

  if (!member) return fail("Could not resolve a member to preview with.");

  const ctx = { member, user: member.user, guild };
  const built = buildMessage(cfg.message, ctx);

  let imageBase64: string | null = null;
  if (cfg.image.enabled) {
    const buffer = await renderWelcomeBuffer({
      title: render(cfg.image.title, ctx),
      subtitle: render(cfg.image.subtitle, ctx),
      avatarUrl: member.user.displayAvatarURL({ extension: "png", size: 256 }),
      config: cfg.image,
    });
    if (buffer) imageBase64 = `data:image/png;base64,${buffer.toString("base64")}`;
  }

  return {
    ok: true,
    message: "Preview rendered.",
    data: {
      content: built.content === "​" ? "" : built.content,
      embeds: built.embeds.map((e) => e.toJSON()),
      imageBase64,
      member: {
        id: member.id,
        displayName: member.displayName,
        avatarUrl: member.user.displayAvatarURL({ size: 128 }),
      },
    },
  };
};
