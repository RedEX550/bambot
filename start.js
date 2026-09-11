#!/usr/bin/env node
/**
 * Single-process entrypoint.
 *
 * Runs the Discord bot and the dashboard API in one Node process, with the API
 * also serving the built dashboard. That turns the whole product into one
 * command on one port, which is what panels like Pterodactyl expect — they hand
 * out a single allocation and run a single startup command.
 *
 *   node start.js
 *
 * On a normal VPS you can still run the two separately (see docker-compose.yml);
 * this file exists for constrained hosts, not because the split is wrong.
 *
 * The two halves talk over 127.0.0.1 exactly as they would when split, so there
 * is no second code path to keep working — the only difference is process count.
 */

"use strict";

const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

const root = __dirname;

const BOT_ENTRY = resolve(root, "packages/bot/dist/index.js");
const API_ENTRY = resolve(root, "packages/api/dist/index.js");
const WEB_DIST = resolve(root, "packages/web/dist");

const die = (message) => {
  process.stderr.write(`\n[bambot] ${message}\n\n`);
  process.exit(1);
};

if (!existsSync(BOT_ENTRY) || !existsSync(API_ENTRY)) {
  die(
    "The project has not been built yet.\n" +
      "         Run:  npm install && npx prisma generate && npm run build:server\n" +
      "         (and `npm run build -w @bambot/web` for the dashboard)",
  );
}

// Serve the dashboard from the API process unless the operator pointed
// SERVE_WEB_DIR somewhere else or switched it off with SERVE_WEB=false.
if (process.env.SERVE_WEB !== "false" && !process.env.SERVE_WEB_DIR) {
  if (existsSync(resolve(WEB_DIST, "index.html"))) {
    process.env.SERVE_WEB_DIR = WEB_DIST;
  } else {
    process.stderr.write(
      "[bambot] The dashboard build is missing, so only the API will be served.\n" +
        "         Build it with:  npm run build -w @bambot/web\n",
    );
  }
}

// Panels commonly expose the allocated port as SERVER_PORT. The API already
// prefers it; mirroring it here keeps the log line honest.
const port = process.env.SERVER_PORT || process.env.API_PORT || "4000";

process.stdout.write(
  `\n  Bambot — starting bot and dashboard in one process\n` +
    `  dashboard + api : http://0.0.0.0:${port}\n` +
    `  bot internal api: 127.0.0.1:${process.env.BOT_INTERNAL_PORT || "4100"} (not exposed)\n\n`,
);

// Order matters only in that the bot should be listening on its internal port
// before the dashboard tries to reach it. Both are required synchronously and
// start themselves; a failure in either exits the process, which is what a panel
// wants so that it restarts cleanly.
require(BOT_ENTRY);
require(API_ENTRY);
