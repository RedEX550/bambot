import { PermissionFlagsBits, type GuildMember } from "discord.js";
import type { CoreConfig } from "@bambot/shared";
import { env } from "../core/env";
import type { PermissionTier } from "../core/types";

const TIER_ORDER: PermissionTier[] = ["everyone", "staff", "mod", "admin", "owner"];

/**
 * Works out the highest tier a member holds.
 *
 * Native Discord permissions count too, so a server that has not configured
 * Bambot roles yet still works: Administrator maps to admin, and the classic
 * moderation permissions map to mod.
 */
export const resolveTier = (member: GuildMember, core: CoreConfig): PermissionTier => {
  if (env.ownerIds.includes(member.id)) return "owner";
  if (member.id === member.guild.ownerId) return "owner";

  const roles = member.roles.cache;
  const hasAny = (ids: string[]) => ids.some((id) => roles.has(id));

  if (member.permissions.has(PermissionFlagsBits.Administrator) || hasAny(core.adminRoles)) return "admin";
  if (
    hasAny(core.modRoles) ||
    member.permissions.has(PermissionFlagsBits.BanMembers) ||
    member.permissions.has(PermissionFlagsBits.KickMembers) ||
    member.permissions.has(PermissionFlagsBits.ModerateMembers)
  ) {
    return "mod";
  }
  if (hasAny(core.staffRoles) || member.permissions.has(PermissionFlagsBits.ManageMessages)) return "staff";
  return "everyone";
};

export const tierAtLeast = (tier: PermissionTier, required: PermissionTier): boolean =>
  TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(required);

export const hasTier = (member: GuildMember, required: PermissionTier, core: CoreConfig): boolean =>
  tierAtLeast(resolveTier(member, core), required);

export const isStaff = (member: GuildMember, core: CoreConfig): boolean => hasTier(member, "staff", core);

/** Members with an exempt role skip automod, raid checks and rate limits. */
export const isExempt = (member: GuildMember, core: CoreConfig): boolean => {
  if (core.exemptRoles.some((id) => member.roles.cache.has(id))) return true;
  return member.permissions.has(PermissionFlagsBits.Administrator);
};

export interface ActionabilityResult {
  ok: boolean;
  reason?: string;
}

/**
 * Can `moderator` act on `target`? Checks self-targeting, the guild owner,
 * role hierarchy for both the moderator and the bot, and the configured
 * protected roles.
 */
export const canActOn = (
  moderator: GuildMember,
  target: GuildMember,
  protectedRoles: string[] = [],
): ActionabilityResult => {
  if (moderator.id === target.id) return { ok: false, reason: "You cannot use this on yourself." };
  if (target.id === target.guild.ownerId) return { ok: false, reason: "That member owns the server." };
  if (target.id === target.client.user.id) return { ok: false, reason: "I am not going to do that to myself." };

  if (protectedRoles.some((id) => target.roles.cache.has(id))) {
    return { ok: false, reason: "That member holds a protected role." };
  }

  const isOwner = moderator.id === moderator.guild.ownerId;
  if (!isOwner && moderator.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    return { ok: false, reason: "That member has a role equal to or above yours." };
  }

  const me = target.guild.members.me;
  if (!me) return { ok: false, reason: "I cannot see my own permissions right now." };
  if (me.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    return { ok: false, reason: "That member has a role above mine — move my role higher in Server Settings." };
  }

  return { ok: true };
};
