import { randomBytes } from "node:crypto";
import { Router } from "express";
import { env } from "../env";
import { prisma } from "../db";
import { logger } from "../logger";
import {
  SESSION_COOKIE,
  avatarUrl,
  clearSessionCookie,
  exchangeCode,
  fetchDiscordUser,
  listManageableGuilds,
  requireAuth,
  setSessionCookie,
  signSession,
} from "../lib/auth";

export const authRouter: Router = Router();

const STATE_COOKIE = "bambot_oauth_state";

/**
 * Starts the OAuth flow.
 *
 * The `state` value is stored in a short-lived httpOnly cookie and compared on
 * the way back, which is what stops an attacker from completing a login into
 * someone else's browser (CSRF on the callback).
 */
authRouter.get("/login", (req, res) => {
  const state = randomBytes(24).toString("hex");
  const returnTo = typeof req.query.returnTo === "string" && req.query.returnTo.startsWith("/") ? req.query.returnTo : "/guilds";

  res.cookie(STATE_COOKIE, `${state}|${returnTo}`, {
    httpOnly: true,
    secure: env.useSecureCookies,
    sameSite: "lax",
    maxAge: 600_000,
    path: "/",
  });

  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.OAUTH_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify guilds");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "none");

  res.redirect(url.toString());
});

authRouter.get("/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  const stored = req.cookies?.[STATE_COOKIE] as string | undefined;

  res.clearCookie(STATE_COOKIE, { path: "/" });

  if (!code || !state || !stored) {
    res.redirect(`${env.PUBLIC_URL}/login?error=missing_code`);
    return;
  }

  const [storedState, returnTo = "/guilds"] = stored.split("|");
  if (storedState !== state) {
    logger.warn("oauth state mismatch");
    res.redirect(`${env.PUBLIC_URL}/login?error=state_mismatch`);
    return;
  }

  try {
    const tokens = await exchangeCode(code);
    const user = await fetchDiscordUser(tokens.access_token);

    const session = await prisma.session.create({
      data: {
        userId: user.id,
        userTag: user.global_name || user.username,
        avatar: avatarUrl(user),
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      },
    });

    setSessionCookie(res, signSession(session.id, user.id));
    logger.info({ userId: user.id }, "dashboard sign-in");

    res.redirect(`${env.PUBLIC_URL}${returnTo}`);
  } catch (err) {
    logger.error({ err }, "oauth callback failed");
    res.redirect(`${env.PUBLIC_URL}/login?error=oauth_failed`);
  }
});

authRouter.get("/me", requireAuth, async (req, res) => {
  res.json({
    user: {
      id: req.session!.userId,
      username: req.session!.userTag,
      globalName: null,
      avatarUrl: req.session!.avatar,
    },
    isOwner: env.ownerIds.includes(req.session!.userId),
  });
});

authRouter.get("/guilds", requireAuth, async (req, res) => {
  const force = req.query.refresh === "1";
  const guilds = await listManageableGuilds(req.session!.id, force);
  res.json({
    guilds,
    inviteUrl: `https://discord.com/oauth2/authorize?client_id=${env.DISCORD_CLIENT_ID}&permissions=1101659133654&scope=bot%20applications.commands`,
  });
});

authRouter.post("/logout", requireAuth, async (req, res) => {
  await prisma.session.delete({ where: { id: req.session!.id } }).catch(() => undefined);
  clearSessionCookie(res);
  res.json({ ok: true });
});

export default authRouter;
