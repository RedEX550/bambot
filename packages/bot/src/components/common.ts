import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type GuildMember,
} from "discord.js";
import { COLORS, EMOJI } from "@bambot/shared";
import type { ComponentHandler } from "../core/types";
import { prisma } from "../core/db";
import { config } from "../core/config";
import { childLogger } from "../core/logger";
import { errorEmbed, successEmbed } from "../lib/embeds";
import { render } from "../lib/placeholders";
import { parseOptions } from "../services/rolemenus";
import { buildGiveawayEmbed, checkEligibility, entriesFor, entryRow } from "../services/giveaways";

const log = childLogger("components");
const ephemeral = { flags: MessageFlags.Ephemeral as const };

/** Pending verification codes, held in memory only — they expire in minutes. */
const pendingCodes = new Map<string, { code: string; attempts: number; expires: number }>();

const generateCode = (length: number): string => {
  // No 0/O/1/I — people mistype those constantly in a captcha.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
};

const grantVerified = async (member: GuildMember, cfg: { verifiedRoleId: string; unverifiedRoleId: string; removeUnverifiedOnPass: boolean; logChannelId: string }, method: string) => {
  if (cfg.verifiedRoleId) await member.roles.add(cfg.verifiedRoleId, "Verified").catch(() => undefined);
  if (cfg.removeUnverifiedOnPass && cfg.unverifiedRoleId && member.roles.cache.has(cfg.unverifiedRoleId)) {
    await member.roles.remove(cfg.unverifiedRoleId, "Verified").catch(() => undefined);
  }

  await prisma.verification
    .upsert({
      where: { guildId_userId: { guildId: member.guild.id, userId: member.id } },
      create: { guildId: member.guild.id, userId: member.id, method },
      update: { method, verifiedAt: new Date() },
    })
    .catch(() => undefined);

  if (cfg.logChannelId) {
    const channel = member.guild.channels.cache.get(cfg.logChannelId);
    if (channel?.isTextBased()) {
      await channel
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.success)
              .setDescription(`${EMOJI.success} <@${member.id}> verified via **${method}**.`)
              .setTimestamp(new Date()),
          ],
        })
        .catch(() => undefined);
    }
  }
};

export const verifyHandler: ComponentHandler = {
  prefix: "verify",
  async execute(interaction, args, client) {
    const guild = interaction.guild;
    if (!guild) return;

    const cfg = await client.config.get(guild.id, "verification");
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return;

    if (cfg.verifiedRoleId && member.roles.cache.has(cfg.verifiedRoleId)) {
      await interaction.reply({ embeds: [successEmbed("You are already verified.")], ...ephemeral });
      return;
    }

    if (cfg.minWaitSeconds > 0 && member.joinedTimestamp) {
      const waited = (Date.now() - member.joinedTimestamp) / 1000;
      if (waited < cfg.minWaitSeconds) {
        await interaction.reply({
          embeds: [errorEmbed(`Please wait ${Math.ceil(cfg.minWaitSeconds - waited)} more second(s) before verifying.`)],
          ...ephemeral,
        });
        return;
      }
    }

    if (args[0] === "start") {
      if (cfg.mode === "captcha") {
        if (!interaction.isMessageComponent()) return;
        const code = generateCode(cfg.captchaLength);
        pendingCodes.set(`${guild.id}:${member.id}`, { code, attempts: 0, expires: Date.now() + 300_000 });

        await interaction.showModal(
          new ModalBuilder()
            .setCustomId("verify:code")
            .setTitle("Verification")
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId("code")
                  .setLabel(`Type this code: ${code}`)
                  .setPlaceholder(code)
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setMinLength(cfg.captchaLength)
                  .setMaxLength(cfg.captchaLength),
              ),
            ),
        );
        return;
      }

      await interaction.deferReply(ephemeral);
      await grantVerified(member, cfg, cfg.mode);
      await interaction.editReply({ embeds: [successEmbed(render(cfg.successMessage, { member, user: member.user, guild }))] });
      return;
    }

    if (args[0] === "code") {
      if (!interaction.isModalSubmit()) return;
      await interaction.deferReply(ephemeral);

      const key = `${guild.id}:${member.id}`;
      const pending = pendingCodes.get(key);
      if (!pending || pending.expires < Date.now()) {
        pendingCodes.delete(key);
        await interaction.editReply({ embeds: [errorEmbed("That code expired. Press the verify button again.")] });
        return;
      }

      const entered = interaction.fields.getTextInputValue("code").trim().toUpperCase();
      if (entered !== pending.code) {
        pending.attempts += 1;
        if (pending.attempts >= cfg.captchaAttempts) {
          pendingCodes.delete(key);
          await interaction.editReply({ embeds: [errorEmbed("Too many wrong attempts. Press the verify button to start again.")] });
          return;
        }
        await interaction.editReply({
          embeds: [errorEmbed(`That code was wrong. ${cfg.captchaAttempts - pending.attempts} attempt(s) left.`)],
        });
        return;
      }

      pendingCodes.delete(key);
      await grantVerified(member, cfg, "captcha");
      await interaction.editReply({ embeds: [successEmbed(render(cfg.successMessage, { member, user: member.user, guild }))] });
    }
  },
};

export const roleMenuHandler: ComponentHandler = {
  prefix: "rolemenu",
  async execute(interaction, args, client) {
    const guild = interaction.guild;
    if (!guild || !interaction.isMessageComponent()) return;

    const [action, menuId] = args;
    const menu = await prisma.roleMenu.findFirst({ where: { id: menuId, guildId: guild.id } });
    if (!menu) {
      await interaction.reply({ embeds: [errorEmbed("This menu no longer exists.")], ...ephemeral });
      return;
    }

    const cfg = await client.config.get(guild.id, "rolemenus");
    if (!cfg.enabled) {
      await interaction.reply({ embeds: [errorEmbed("Role menus are switched off here.")], ...ephemeral });
      return;
    }

    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return;

    const options = parseOptions(menu.options);
    const allowedIds = options.map((o) => o.roleId).filter((id) => !cfg.forbiddenRoles.includes(id));
    const me = guild.members.me;

    const assignable = (roleId: string) => {
      const role = guild.roles.cache.get(roleId);
      return Boolean(role && !role.managed && me && role.position < me.roles.highest.position);
    };

    await interaction.deferReply(ephemeral);

    const added: string[] = [];
    const removed: string[] = [];
    const failed: string[] = [];

    if (action === "toggle") {
      const roleId = args[2];
      if (!allowedIds.includes(roleId)) {
        await interaction.editReply({ embeds: [errorEmbed("That role is not available from this menu.")] });
        return;
      }
      if (!assignable(roleId)) {
        await interaction.editReply({ embeds: [errorEmbed("I cannot manage that role — my own role needs to be higher.")] });
        return;
      }

      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId, "Role menu").catch(() => failed.push(roleId));
        removed.push(roleId);
      } else {
        if (cfg.maxRolesPerMember > 0) {
          const held = allowedIds.filter((id) => member.roles.cache.has(id)).length;
          if (held >= cfg.maxRolesPerMember) {
            await interaction.editReply({
              embeds: [errorEmbed(`You can only hold ${cfg.maxRolesPerMember} role(s) from these menus. Remove one first.`)],
            });
            return;
          }
        }
        await member.roles.add(roleId, "Role menu").catch(() => failed.push(roleId));
        added.push(roleId);
      }
    } else if (action === "select" && interaction.isStringSelectMenu()) {
      const chosen = interaction.values.filter((id) => allowedIds.includes(id));

      for (const roleId of allowedIds) {
        const shouldHave = chosen.includes(roleId);
        const has = member.roles.cache.has(roleId);
        if (shouldHave === has) continue;
        if (!assignable(roleId)) {
          failed.push(roleId);
          continue;
        }
        if (shouldHave) {
          await member.roles.add(roleId, "Role menu").then(() => added.push(roleId)).catch(() => failed.push(roleId));
        } else {
          await member.roles.remove(roleId, "Role menu").then(() => removed.push(roleId)).catch(() => failed.push(roleId));
        }
      }
    }

    const parts: string[] = [];
    if (added.length) parts.push(`**Added:** ${added.map((r) => `<@&${r}>`).join(", ")}`);
    if (removed.length) parts.push(`**Removed:** ${removed.map((r) => `<@&${r}>`).join(", ")}`);
    if (failed.length) parts.push(`**Could not change:** ${failed.map((r) => `<@&${r}>`).join(", ")}`);

    await interaction.editReply({
      embeds: [parts.length ? successEmbed(parts.join("\n")) : successEmbed("Nothing changed.")],
      allowedMentions: { parse: [] },
    });
  },
};

export const giveawayHandler: ComponentHandler = {
  prefix: "giveaway",
  async execute(interaction, args, client) {
    const guild = interaction.guild;
    if (!guild || !interaction.isMessageComponent()) return;
    if (args[0] !== "enter") return;

    await interaction.deferReply(ephemeral);

    const giveaway = await prisma.giveaway.findUnique({ where: { id: args[1] }, include: { entries: true } });
    if (!giveaway || giveaway.ended) {
      await interaction.editReply({ embeds: [errorEmbed("This giveaway has ended.")] });
      return;
    }

    const cfg = await client.config.get(guild.id, "giveaways");
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return;

    const existing = giveaway.entries.find((e) => e.userId === member.id);
    if (existing) {
      await prisma.giveawayEntry.delete({ where: { id: existing.id } }).catch(() => undefined);
      await interaction.editReply({ embeds: [successEmbed("Your entry has been withdrawn.")] });
      return;
    }

    const requirements = (giveaway.requirements as never) ?? cfg.defaultRequirements;
    const eligible = await checkEligibility(member, requirements);
    if (!eligible.ok) {
      await interaction.editReply({ embeds: [errorEmbed(eligible.reason!)] });
      return;
    }

    const entries = entriesFor(member, cfg.bonusEntries);
    await prisma.giveawayEntry.create({ data: { giveawayId: giveaway.id, userId: member.id, entries } });

    await interaction.editReply({
      embeds: [
        successEmbed(
          entries > 1
            ? `You are entered with **${entries} entries**. Press again to withdraw.`
            : "You are entered. Press again to withdraw.",
        ),
      ],
    });

    // Keep the entry count on the message roughly current.
    const total = await prisma.giveawayEntry.count({ where: { giveawayId: giveaway.id } });
    if (interaction.message.editable) {
      await interaction.message
        .edit({
          embeds: [buildGiveawayEmbed(giveaway, total, COLORS.brand)],
          components: [entryRow(giveaway.id, cfg.buttonLabel)],
        })
        .catch(() => undefined);
    }
  },
};

export const kbFeedbackHandler: ComponentHandler = {
  prefix: "kb",
  async execute(interaction, args) {
    if (!interaction.isMessageComponent()) return;
    const [action, articleId, askerId] = args;

    if (askerId && interaction.user.id !== askerId) {
      await interaction.reply({ embeds: [errorEmbed("Only the person who asked can answer this.")], ...ephemeral });
      return;
    }

    if (action === "solved") {
      await prisma.kbArticle.update({ where: { id: articleId }, data: { helpful: { increment: 1 } } }).catch(() => undefined);
      await interaction.update({
        embeds: interaction.message.embeds,
        components: [],
      });
      await interaction.followUp({ embeds: [successEmbed("Great — thanks for confirming.")], ...ephemeral });

      // Mark the forum post solved if the channel supports tags.
      const channel = interaction.channel;
      if (channel?.isThread() && channel.parent && "availableTags" in channel.parent) {
        const cfg = await config.get(interaction.guildId!, "bambu");
        const tag = channel.parent.availableTags.find(
          (t) => t.name.toLowerCase() === cfg.autoAnswer.solvedTagName.toLowerCase(),
        );
        if (tag && !channel.appliedTags.includes(tag.id)) {
          await channel.setAppliedTags([...channel.appliedTags, tag.id]).catch(() => undefined);
        }
      }
      return;
    }

    if (action === "nothelpful") {
      await prisma.kbArticle.update({ where: { id: articleId }, data: { unhelpful: { increment: 1 } } }).catch(() => undefined);
      await interaction.update({ components: [] });
      await interaction.followUp({
        embeds: [successEmbed("Noted — a human will pick this up. Sorry about that.")],
        ...ephemeral,
      });
    }
  },
};

export default [verifyHandler, roleMenuHandler, giveawayHandler, kbFeedbackHandler];
