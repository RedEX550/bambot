import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import type { DashboardGuild, SessionUser } from "@bambot/shared";
import { PERM_ADMINISTRATOR, PERM_MANAGE_GUILD } from "@bambot/shared";
import { env } from "../env";
import { prisma } from "../db";
import { logger } from "../logger";

export const SESSION_COOKIE = "bambot_session";
const SESSION_TTL_DAYS = 7;

export interface JwtPayload {
  sid: string;
  uid: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: { id: string; userId: string; userTag: string; avatar: string | null };
      guildId?: string;
    }
  }
}

export const signSession = (sessionId: string, userId: string): string =>
  jwt.sign({ sid: sessionId, uid: userId } satisfies JwtPayload, env.SESSION_SECRET, {
    expiresIn: `${SESSION_TTL_DAYS}d`,
  });

export const setSessionCookie = (res: Response, token: string) => {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: env.isProduction ? "strict" : "lax",
    maxAge: SESSION_TTL_DAYS * 86_400_000,
    path: "/",
  });
};

export const clearSessionCookie = (res: Response) => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
};

// ---------------------------------------------------------------------------
// Discord OAuth2
// ---------------------------------------------------------------------------

export interface DiscordTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export const exchangeCode = async (code: string): Promise<DiscordTokens> => {
  const body = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: env.OAUTH_REDIRECT_URI,
  });

  const response = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }
  return (await response.json()) as DiscordTokens;
};

export const refreshTokens = async (refreshToken: string): Promise<DiscordTokens> => {
  const body = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`Token refresh failed (${response.status})`);
  return (await response.json()) as DiscordTokens;
};

interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

interface DiscordPartialGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
}

const discordApi = async <T>(path: string, accessToken: string): Promise<T> => {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Discord API ${path} returned ${response.status}`);
  return (await response.json()) as T;
};

export const fetchDiscordUser = (accessToken: string) => discordApi<DiscordUser>("/users/@me", accessToken);
export const fetchDiscordGuilds = (accessToken: string) => discordApi<DiscordPartialGuild[]>("/users/@me/guilds", accessToken);

export const avatarUrl = (user: { id: string; avatar: string | null }): string | null =>
  user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : null;

/** Manage Server or Administrator is what the dashboard treats as "can edit". */
export const canManageGuild = (permissions: string, owner: boolean): boolean => {
  if (owner) return true;
  try {
    const bits = BigInt(permissions);
    return (bits & PERM_ADMINISTRATOR) === PERM_ADMINISTRATOR || (bits & PERM_MANAGE_GUILD) === PERM_MANAGE_GUILD;
  } catch {
    return false;
  }
};

/**
 * Lists the guilds this user may configure.
 *
 * Discord rate limits /users/@me/guilds aggressively, so the result is cached
 * on the session row for five minutes. `force` bypasses it for the refresh
 * button in the UI.
 */
export const listManageableGuilds = async (sessionId: string, force = false): Promise<DashboardGuild[]> => {
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) return [];

  const cacheAge = session.guildsFetchedAt ? Date.now() - session.guildsFetchedAt.getTime() : Infinity;
  let guilds: DiscordPartialGuild[];

  if (!force && session.guildsCache && cacheAge < 300_000) {
    guilds = session.guildsCache as unknown as DiscordPartialGuild[];
  } else {
    let accessToken = session.accessToken;

    if (session.expiresAt.getTime() < Date.now() + 60_000) {
      try {
        const refreshed = await refreshTokens(session.refreshToken);
        accessToken = refreshed.access_token;
        await prisma.session.update({
          where: { id: session.id },
          data: {
            accessToken: refreshed.access_token,
            refreshToken: refreshed.refresh_token,
            expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
          },
        });
      } catch (err) {
        logger.warn({ err, sessionId }, "token refresh failed");
        return [];
      }
    }

    try {
      guilds = await fetchDiscordGuilds(accessToken);
      await prisma.session.update({
        where: { id: session.id },
        data: { guildsCache: guilds as never, guildsFetchedAt: new Date() },
      });
    } catch (err) {
      logger.warn({ err, sessionId }, "guild list fetch failed");
      guilds = (session.guildsCache as unknown as DiscordPartialGuild[]) ?? [];
    }
  }

  const manageable = guilds.filter((g) => canManageGuild(g.permissions, g.owner));
  const isOwner = env.ownerIds.includes(session.userId);

  const known = await prisma.guild.findMany({
    where: { id: { in: manageable.map((g) => g.id) }, active: true },
    select: { id: true, memberCap: true },
  });
  const present = new Map(known.map((g) => [g.id, g.memberCap]));

  const result: DashboardGuild[] = manageable.map((g) => ({
    id: g.id,
    name: g.name,
    iconUrl: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128` : null,
    botPresent: present.has(g.id),
    canManage: true,
    memberCount: present.get(g.id) || undefined,
  }));

  // Bot owners see every guild the bot is in, for support purposes.
  if (isOwner) {
    const all = await prisma.guild.findMany({ where: { active: true } });
    for (const guild of all) {
      if (result.some((r) => r.id === guild.id)) continue;
      result.push({
        id: guild.id,
        name: guild.name,
        iconUrl: guild.iconHash ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.iconHash}.png?size=128` : null,
        botPresent: true,
        canManage: true,
        memberCount: guild.memberCap,
      });
    }
  }

  return result.sort((a, b) => Number(b.botPresent) - Number(a.botPresent) || a.name.localeCompare(b.name));
};

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) {
    res.status(401).json({ error: "unauthorized", message: "Sign in to continue." });
    return;
  }

  try {
    const payload = jwt.verify(token, env.SESSION_SECRET) as JwtPayload;
    const session = await prisma.session.findUnique({ where: { id: payload.sid } });
    if (!session) {
      clearSessionCookie(res);
      res.status(401).json({ error: "unauthorized", message: "Your session has expired." });
      return;
    }
    req.session = { id: session.id, userId: session.userId, userTag: session.userTag, avatar: session.avatar };
    next();
  } catch {
    clearSessionCookie(res);
    res.status(401).json({ error: "unauthorized", message: "Your session has expired." });
  }
};

/**
 * Confirms the signed-in user may configure :guildId.
 *
 * Checked on every request rather than trusted from the session, so removing
 * someone's Manage Server permission takes effect on their next action.
 */
export const requireGuildAccess = async (req: Request, res: Response, next: NextFunction) => {
  const guildId = req.params.guildId;
  if (!req.session) {
    res.status(401).json({ error: "unauthorized", message: "Sign in to continue." });
    return;
  }
  if (!/^\d{5,25}$/.test(guildId ?? "")) {
    res.status(400).json({ error: "bad_request", message: "That is not a valid server ID." });
    return;
  }

  if (env.ownerIds.includes(req.session.userId)) {
    req.guildId = guildId;
    next();
    return;
  }

  const guilds = await listManageableGuilds(req.session.id);
  const match = guilds.find((g) => g.id === guildId);

  if (!match) {
    res.status(403).json({ error: "forbidden", message: "You do not manage that server." });
    return;
  }
  if (!match.botPresent) {
    res.status(404).json({ error: "bot_missing", message: "Bambot is not in that server yet." });
    return;
  }

  req.guildId = guildId;
  next();
};

export const sessionUser = (req: Request): SessionUser | null =>
  req.session
    ? {
        id: req.session.userId,
        username: req.session.userTag,
        globalName: null,
        avatarUrl: req.session.avatar,
      }
    : null;
