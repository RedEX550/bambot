import type { Guild, GuildMember, User } from "discord.js";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

/**
 * Placeholder resolution.
 *
 * Values are collected lazily into a flat map and substituted in one pass, so a
 * template with 40 placeholders still costs one regex walk. Unknown keys are
 * left untouched rather than blanked, which makes typos obvious to whoever is
 * editing the template in the dashboard.
 */

export type PlaceholderValues = Record<string, string>;

export interface PlaceholderContext {
  member?: GuildMember | null;
  user?: User | null;
  guild?: Guild | null;
  ticket?: {
    number?: number | string;
    category?: string;
    opener?: string;
    channel?: string;
    claimer?: string;
    priority?: string;
  };
  moderationCase?: {
    number?: number | string;
    reason?: string;
    moderator?: string;
    duration?: string;
    type?: string;
  };
  level?: { level?: number | string; xp?: number | string; rank?: number | string };
  suggestion?: { number?: number | string; status?: string };
  giveaway?: { prize?: string; winners?: string; ends?: string };
  extra?: PlaceholderValues;
}

const ordinal = (n: number): string => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n.toLocaleString("en-US")}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export const buildValues = (ctx: PlaceholderContext): PlaceholderValues => {
  const values: PlaceholderValues = {};
  const user = ctx.user ?? ctx.member?.user ?? null;

  if (user) {
    values["user"] = `<@${user.id}>`;
    values["user.name"] = user.username;
    values["user.id"] = user.id;
    values["user.tag"] = user.discriminator && user.discriminator !== "0" ? user.tag : user.username;
    values["user.display"] = ctx.member?.displayName ?? user.globalName ?? user.username;
    values["user.avatar"] = user.displayAvatarURL({ size: 256, extension: "png" });
    values["user.created"] = dayjs(user.createdAt).format("D MMM YYYY");
    values["user.created.relative"] = dayjs(user.createdAt).fromNow(true);
  }

  if (ctx.member) {
    values["user.joined"] = ctx.member.joinedAt ? dayjs(ctx.member.joinedAt).format("D MMM YYYY") : "unknown";
    values["user.joined.relative"] = ctx.member.joinedAt ? dayjs(ctx.member.joinedAt).fromNow(true) : "unknown";
    values["user.nickname"] = ctx.member.nickname ?? ctx.member.displayName;
  }

  if (ctx.guild) {
    values["server"] = ctx.guild.name;
    values["server.id"] = ctx.guild.id;
    values["server.icon"] = ctx.guild.iconURL({ size: 256, extension: "png" }) ?? "";
    values["server.members"] = String(ctx.guild.memberCount ?? 0);
    values["server.members.ordinal"] = ordinal(ctx.guild.memberCount ?? 0);
    values["server.boosts"] = String(ctx.guild.premiumSubscriptionCount ?? 0);
    values["server.owner"] = ctx.guild.ownerId ? `<@${ctx.guild.ownerId}>` : "";
  }

  if (ctx.ticket) {
    values["ticket.number"] = String(ctx.ticket.number ?? "");
    values["ticket.category"] = ctx.ticket.category ?? "";
    values["ticket.opener"] = ctx.ticket.opener ?? "";
    values["ticket.channel"] = ctx.ticket.channel ?? "";
    values["ticket.claimer"] = ctx.ticket.claimer ?? "nobody yet";
    values["ticket.priority"] = ctx.ticket.priority ?? "NORMAL";
  }

  if (ctx.moderationCase) {
    values["case.number"] = String(ctx.moderationCase.number ?? "");
    values["case.reason"] = ctx.moderationCase.reason ?? "No reason provided";
    values["case.moderator"] = ctx.moderationCase.moderator ?? "";
    values["case.duration"] = ctx.moderationCase.duration ?? "permanent";
    values["case.type"] = ctx.moderationCase.type ?? "";
  }

  if (ctx.level) {
    values["level"] = String(ctx.level.level ?? 0);
    values["level.xp"] = String(ctx.level.xp ?? 0);
    values["level.rank"] = ctx.level.rank ? `#${ctx.level.rank}` : "unranked";
  }

  if (ctx.suggestion) {
    values["suggestion.number"] = String(ctx.suggestion.number ?? "");
    values["suggestion.status"] = ctx.suggestion.status ?? "PENDING";
  }

  if (ctx.giveaway) {
    values["giveaway.prize"] = ctx.giveaway.prize ?? "";
    values["giveaway.winners"] = ctx.giveaway.winners ?? "";
    values["giveaway.ends"] = ctx.giveaway.ends ?? "";
  }

  return { ...values, ...(ctx.extra ?? {}) };
};

const TOKEN = /\{([a-zA-Z0-9_.]+)\}/g;

/** Substitutes `{key}` tokens. Unknown keys are left as-is. */
export const applyValues = (template: string, values: PlaceholderValues): string =>
  template.replace(TOKEN, (match, key: string) => values[key] ?? match);

export const render = (template: string, ctx: PlaceholderContext): string =>
  applyValues(template, buildValues(ctx));

/** Walks any nested structure and renders every string in it. */
export const renderDeep = <T>(value: T, values: PlaceholderValues): T => {
  if (typeof value === "string") return applyValues(value, values) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => renderDeep(v, values)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = renderDeep(v, values);
    return out as T;
  }
  return value;
};
