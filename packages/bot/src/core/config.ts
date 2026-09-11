import type { ModuleConfigMap, ModuleName } from "@bambot/shared";
import { parseModuleConfig } from "@bambot/shared";
import { prisma } from "./db";
import { childLogger } from "./logger";

const log = childLogger("config");

interface CacheEntry {
  data: unknown;
  expires: number;
}

/**
 * Reads per-guild module settings with a short TTL cache.
 *
 * Every read goes through the module zod schema, so a config row written by an
 * older version of the dashboard still comes back with all the newer defaults
 * filled in. That makes adding a setting a one-file change.
 */
export class ConfigService {
  private cache = new Map<string, CacheEntry>();
  private readonly ttlMs = 60_000;

  private key(guildId: string, module: string) {
    return `${guildId}:${module}`;
  }

  async get<K extends ModuleName>(guildId: string, module: K): Promise<ModuleConfigMap[K]> {
    const key = this.key(guildId, module);
    const hit = this.cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.data as ModuleConfigMap[K];

    let raw: unknown = {};
    try {
      const row = await prisma.guildConfig.findUnique({ where: { guildId_module: { guildId, module } } });
      raw = row?.data ?? {};
    } catch (err) {
      log.error({ err, guildId, module }, "failed to read config, falling back to defaults");
    }

    let parsed: unknown;
    try {
      parsed = parseModuleConfig(module, raw);
    } catch (err) {
      // A malformed row must never take the bot down; fall back to defaults.
      log.error({ err, guildId, module }, "config failed validation, using defaults");
      parsed = parseModuleConfig(module, {});
    }

    this.cache.set(key, { data: parsed, expires: Date.now() + this.ttlMs });
    return parsed as ModuleConfigMap[K];
  }

  /** Reads several modules at once; the common case in event handlers. */
  async getMany<K extends ModuleName>(guildId: string, modules: K[]): Promise<{ [P in K]: ModuleConfigMap[P] }> {
    const entries = await Promise.all(modules.map(async (m) => [m, await this.get(guildId, m)] as const));
    return Object.fromEntries(entries) as { [P in K]: ModuleConfigMap[P] };
  }

  async set<K extends ModuleName>(guildId: string, module: K, data: unknown, updatedBy?: string): Promise<ModuleConfigMap[K]> {
    const parsed = parseModuleConfig(module, data);
    await prisma.guildConfig.upsert({
      where: { guildId_module: { guildId, module } },
      create: { guildId, module, data: parsed as never, updatedBy },
      update: { data: parsed as never, updatedBy },
    });
    this.cache.set(this.key(guildId, module), { data: parsed, expires: Date.now() + this.ttlMs });
    return parsed as ModuleConfigMap[K];
  }

  /** Shallow-merges a patch into the stored config. */
  async patch<K extends ModuleName>(guildId: string, module: K, patch: Record<string, unknown>, updatedBy?: string) {
    const current = (await this.get(guildId, module)) as Record<string, unknown>;
    return this.set(guildId, module, { ...current, ...patch }, updatedBy);
  }

  invalidate(guildId: string, module?: string) {
    if (module) {
      this.cache.delete(this.key(guildId, module));
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${guildId}:`)) this.cache.delete(key);
    }
  }

  invalidateAll() {
    this.cache.clear();
  }
}

export const config = new ConfigService();
