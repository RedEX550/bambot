import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Cron } from "croner";
import type { BambotClient } from "./client";
import type { BotCommand, BotEvent, BotTask, ComponentHandler, ContextMenuCommand } from "./types";
import { childLogger } from "./logger";

const log = childLogger("registry");

/** Recursively collects loadable modules, working under both ts-node and tsc output. */
const walk = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (!/\.(ts|js)$/.test(entry)) continue;
    if (/\.d\.ts$/.test(entry) || entry.endsWith(".map")) continue;
    if (entry.startsWith("_")) continue;
    out.push(full);
  }
  return out;
};

/** Modules may default-export one item or an array of them. */
const exported = <T>(mod: Record<string, unknown>): T[] => {
  const value = (mod.default ?? mod) as unknown;
  if (Array.isArray(value)) return value as T[];
  // Named exports: take every object that looks like a definition.
  if (mod.default) return [value as T];
  return Object.values(mod).filter((v) => v && typeof v === "object") as T[];
};

const root = join(__dirname, "..");

export const loadCommands = (client: BambotClient) => {
  let count = 0;
  for (const file of walk(join(root, "commands"))) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(file) as Record<string, unknown>;
    for (const command of exported<BotCommand>(mod)) {
      if (!command?.data || typeof command.execute !== "function") continue;
      client.commands.set(command.data.name, command);
      count += 1;
    }
  }
  log.info({ count }, "slash commands loaded");
};

export const loadContextMenus = (client: BambotClient) => {
  let count = 0;
  for (const file of walk(join(root, "contextmenus"))) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(file) as Record<string, unknown>;
    for (const command of exported<ContextMenuCommand>(mod)) {
      if (!command?.data || typeof command.execute !== "function") continue;
      client.contextMenus.set(command.data.name, command);
      count += 1;
    }
  }
  if (count) log.info({ count }, "context menu commands loaded");
};

export const loadComponents = (client: BambotClient) => {
  let count = 0;
  for (const file of walk(join(root, "components"))) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(file) as Record<string, unknown>;
    for (const handler of exported<ComponentHandler>(mod)) {
      if (!handler?.prefix || typeof handler.execute !== "function") continue;
      if (client.components.has(handler.prefix)) {
        log.warn({ prefix: handler.prefix }, "duplicate component prefix, the later one wins");
      }
      client.components.set(handler.prefix, handler);
      count += 1;
    }
  }
  log.info({ count }, "component handlers loaded");
};

export const loadEvents = (client: BambotClient) => {
  let count = 0;
  for (const file of walk(join(root, "events"))) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(file) as Record<string, unknown>;
    for (const event of exported<BotEvent>(mod)) {
      if (!event?.name || typeof event.execute !== "function") continue;
      const handler = (...args: unknown[]) => {
        try {
          const result = (event.execute as (...a: unknown[]) => unknown)(client, ...args);
          if (result instanceof Promise) {
            result.catch((err) => log.error({ err, event: event.name }, "event handler rejected"));
          }
        } catch (err) {
          log.error({ err, event: event.name }, "event handler threw");
        }
      };
      if (event.once) client.once(event.name, handler);
      else client.on(event.name, handler);
      count += 1;
    }
  }
  log.info({ count }, "event listeners registered");
};

const activeCrons: Cron[] = [];
const activeIntervals: NodeJS.Timeout[] = [];

export const loadTasks = (client: BambotClient) => {
  let count = 0;
  for (const file of walk(join(root, "tasks"))) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(file) as Record<string, unknown>;
    for (const task of exported<BotTask>(mod)) {
      if (!task?.name || typeof task.execute !== "function") continue;
      client.tasks.set(task.name, task);
      count += 1;

      const run = async () => {
        const started = Date.now();
        try {
          await task.execute(client);
          log.debug({ task: task.name, ms: Date.now() - started }, "task finished");
        } catch (err) {
          log.error({ err, task: task.name }, "task failed");
        }
      };

      if (task.cron) {
        activeCrons.push(new Cron(task.cron, { protect: true }, run));
      } else if (task.intervalSeconds) {
        activeIntervals.push(setInterval(run, task.intervalSeconds * 1000));
      }
      if (task.runOnStart) setTimeout(run, 5_000);
    }
  }
  log.info({ count }, "background tasks scheduled");
};

export const stopTasks = () => {
  for (const cron of activeCrons) cron.stop();
  for (const interval of activeIntervals) clearInterval(interval);
  activeCrons.length = 0;
  activeIntervals.length = 0;
};

export const loadAll = (client: BambotClient) => {
  loadCommands(client);
  loadContextMenus(client);
  loadComponents(client);
  loadEvents(client);
};
