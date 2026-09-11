import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type Guild,
} from "discord.js";
import { z } from "zod";
import { prisma } from "../core/db";
import { config } from "../core/config";
import { buildMessage } from "../lib/payload";
import { clamp } from "../lib/embeds";
import { childLogger } from "../core/logger";

const log = childLogger("rolemenus");

export const roleMenuOptionSchema = z.object({
  roleId: z.string(),
  label: z.string().min(1).max(80),
  description: z.string().max(100).default(""),
  emoji: z.string().max(64).default(""),
  /** Buttons only. */
  style: z.enum(["primary", "secondary", "success", "danger"]).default("secondary"),
});

export type RoleMenuOption = z.infer<typeof roleMenuOptionSchema>;

export const parseOptions = (raw: unknown): RoleMenuOption[] => {
  const result = z.array(roleMenuOptionSchema).safeParse(raw);
  return result.success ? result.data : [];
};

const BUTTON_STYLES = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
} as const;

export const buildRoleMenuComponents = (menuId: string, style: string, placeholder: string, minSelect: number, maxSelect: number, options: RoleMenuOption[]) => {
  if (!options.length) return [];

  if (style === "select") {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`rolemenu:select:${menuId}`)
      .setPlaceholder(clamp(placeholder || "Pick your roles", 150))
      .setMinValues(Math.max(0, Math.min(minSelect, options.length)))
      .setMaxValues(Math.max(1, Math.min(maxSelect || options.length, options.length)))
      .addOptions(
        options.slice(0, 25).map((option) => {
          const built = new StringSelectMenuOptionBuilder().setLabel(clamp(option.label, 100)).setValue(option.roleId);
          if (option.description) built.setDescription(clamp(option.description, 100));
          if (option.emoji) {
            try {
              built.setEmoji(option.emoji);
            } catch {
              /* an emoji we cannot use should not break the menu */
            }
          }
          return built;
        }),
      );
    return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
  }

  const buttons = options.slice(0, 25).map((option) => {
    const button = new ButtonBuilder()
      .setCustomId(`rolemenu:toggle:${menuId}:${option.roleId}`)
      .setLabel(clamp(option.label, 80))
      .setStyle(BUTTON_STYLES[option.style] ?? ButtonStyle.Secondary);
    if (option.emoji) {
      try {
        button.setEmoji(option.emoji);
      } catch {
        /* ignore */
      }
    }
    return button;
  });

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
  }
  return rows;
};

export const publishRoleMenu = async (guild: Guild, menuId: string): Promise<{ ok: boolean; message: string }> => {
  const menu = await prisma.roleMenu.findFirst({ where: { id: menuId, guildId: guild.id } });
  if (!menu) return { ok: false, message: "That role menu no longer exists." };
  if (!menu.channelId) return { ok: false, message: "Choose a channel for this menu first." };

  const channel = guild.channels.cache.get(menu.channelId);
  if (!channel?.isTextBased()) return { ok: false, message: "The menu channel is missing or is not a text channel." };

  const options = parseOptions(menu.options);
  if (!options.length) return { ok: false, message: "Add at least one role to this menu." };

  const cfg = await config.get(guild.id, "rolemenus");
  const blocked = options.filter((o) => cfg.forbiddenRoles.includes(o.roleId));
  if (blocked.length) {
    return { ok: false, message: `This menu contains roles that are on the never-assignable list.` };
  }

  const me = guild.members.me;
  const unassignable = options.filter((o) => {
    const role = guild.roles.cache.get(o.roleId);
    return !role || role.managed || (me ? role.position >= me.roles.highest.position : true);
  });
  if (unassignable.length === options.length) {
    return { ok: false, message: "I cannot assign any of these roles. Move my role above them in Server Settings." };
  }

  const components = buildRoleMenuComponents(menu.id, menu.style, menu.placeholder ?? "", menu.minSelect, menu.maxSelect, options);
  const built = buildMessage(
    (menu.embed as never) ?? { content: "", embeds: [], buttons: [], ghostPing: false, deleteAfter: 0 },
    { guild },
  );
  const payload = { content: built.content, embeds: built.embeds, components };

  if (menu.messageId) {
    const existing = await channel.messages.fetch(menu.messageId).catch(() => null);
    if (existing?.editable) {
      await existing.edit(payload);
      return {
        ok: true,
        message: unassignable.length
          ? `Menu refreshed, but ${unassignable.length} role(s) sit above my own and will fail.`
          : `Menu refreshed in #${channel.name}.`,
      };
    }
  }

  const sent = await channel.send(payload).catch((err) => {
    log.error({ err, guildId: guild.id }, "failed to publish role menu");
    return null;
  });
  if (!sent) return { ok: false, message: "I could not post in that channel." };

  await prisma.roleMenu.update({ where: { id: menu.id }, data: { messageId: sent.id } });
  return {
    ok: true,
    message: unassignable.length
      ? `Menu posted, but ${unassignable.length} role(s) sit above my own and will fail.`
      : `Menu posted in #${channel.name}.`,
  };
};
