import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { BotActionRequest, GuildMeta } from "@bambot/shared";
import { env } from "./env";
import { childLogger } from "./logger";
import type { BambotClient } from "./client";
import { buildGuildMeta } from "../services/guild-meta";
import { runBotAction } from "../services/bot-actions";
import { config } from "./config";

const log = childLogger("internal");

const json = (res: ServerResponse, status: number, body: unknown) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
};

const readBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      // The dashboard never sends anything large here; refuse the rest.
      if (size > 2_000_000) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });

/**
 * A tiny private HTTP surface the API calls.
 *
 * The dashboard needs two things the database cannot provide: live guild data
 * (channels, roles, what the bot can actually see) and the ability to make the
 * bot act right now — publish a panel, preview a welcome image, reload config.
 * Bind this to localhost and never expose it publicly.
 */
export const startInternalServer = (client: BambotClient) => {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", `http://localhost:${env.BOT_INTERNAL_PORT}`);

        if (url.pathname === "/health") {
          json(res, 200, {
            ok: client.isReady(),
            uptimeSeconds: Math.floor(process.uptime()),
            guilds: client.guilds.cache.size,
            ping: Math.round(client.ws.ping),
            commands: client.commands.size,
          });
          return;
        }

        if (req.headers["x-internal-key"] !== env.INTERNAL_API_KEY) {
          json(res, 401, { error: "unauthorized" });
          return;
        }

        const metaMatch = url.pathname.match(/^\/guilds\/(\d+)\/meta$/);
        if (metaMatch && req.method === "GET") {
          const guild = client.guilds.cache.get(metaMatch[1]);
          if (!guild) {
            json(res, 404, { error: "guild_not_found", message: "Bambot is not in that server." });
            return;
          }
          const meta: GuildMeta = await buildGuildMeta(guild);
          json(res, 200, meta);
          return;
        }

        const memberMatch = url.pathname.match(/^\/guilds\/(\d+)\/members$/);
        if (memberMatch && req.method === "GET") {
          const guild = client.guilds.cache.get(memberMatch[1]);
          if (!guild) {
            json(res, 404, { error: "guild_not_found" });
            return;
          }
          const query = (url.searchParams.get("q") ?? "").toLowerCase();
          const found = await guild.members.fetch({ query: query || undefined, limit: 20 }).catch(() => null);
          json(
            res,
            200,
            (found ? [...found.values()] : []).map((m) => ({
              id: m.id,
              tag: m.user.username,
              displayName: m.displayName,
              avatarUrl: m.user.displayAvatarURL({ size: 64 }),
            })),
          );
          return;
        }

        if (url.pathname === "/actions" && req.method === "POST") {
          const body = (await readBody(req)) as BotActionRequest;
          if (!body?.action || !body?.guildId) {
            json(res, 400, { ok: false, message: "action and guildId are required" });
            return;
          }
          const result = await runBotAction(client, body);
          json(res, result.ok ? 200 : 400, result);
          return;
        }

        if (url.pathname === "/config/invalidate" && req.method === "POST") {
          const body = (await readBody(req)) as { guildId?: string; module?: string };
          if (body?.guildId) config.invalidate(body.guildId, body.module);
          else config.invalidateAll();
          json(res, 200, { ok: true });
          return;
        }

        json(res, 404, { error: "not_found" });
      } catch (err) {
        log.error({ err }, "internal request failed");
        json(res, 500, { error: "internal_error", message: String(err) });
      }
    })();
  });

  server.listen(env.BOT_INTERNAL_PORT, "127.0.0.1", () => {
    log.info({ port: env.BOT_INTERNAL_PORT }, "internal API listening on localhost");
  });

  return server;
};
