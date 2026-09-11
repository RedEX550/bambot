import type { ModuleName } from "../constants";
import type { ModuleDefinition } from "./types";

import { coreModule } from "./core";
import { welcomeModule } from "./welcome";
import { goodbyeModule } from "./goodbye";
import { autoroleModule } from "./autorole";
import { verificationModule } from "./verification";
import { ticketsModule } from "./tickets";
import { modmailModule } from "./modmail";
import { automodModule } from "./automod";
import { antiraidModule } from "./antiraid";
import { moderationModule } from "./moderation";
import { loggingModule } from "./logging";
import { levelingModule } from "./leveling";
import { starboardModule } from "./starboard";
import { suggestionsModule } from "./suggestions";
import { giveawaysModule } from "./giveaways";
import { rolemenusModule } from "./rolemenus";
import { tempvoiceModule } from "./tempvoice";
import { countersModule } from "./counters";
import { bambuModule } from "./bambu";
import { contentModule } from "./content";

export * from "./types";
export * from "./core";
export * from "./welcome";
export * from "./goodbye";
export * from "./autorole";
export * from "./verification";
export * from "./tickets";
export * from "./modmail";
export * from "./automod";
export * from "./antiraid";
export * from "./moderation";
export * from "./logging";
export * from "./leveling";
export * from "./starboard";
export * from "./suggestions";
export * from "./giveaways";
export * from "./rolemenus";
export * from "./tempvoice";
export * from "./counters";
export * from "./bambu";
export * from "./content";

/** The single source of truth the bot, the API and the dashboard all read. */
export const MODULE_REGISTRY: Record<ModuleName, ModuleDefinition> = {
  core: coreModule,
  welcome: welcomeModule,
  goodbye: goodbyeModule,
  autorole: autoroleModule,
  verification: verificationModule,
  tickets: ticketsModule,
  modmail: modmailModule,
  automod: automodModule,
  antiraid: antiraidModule,
  moderation: moderationModule,
  logging: loggingModule,
  leveling: levelingModule,
  starboard: starboardModule,
  suggestions: suggestionsModule,
  giveaways: giveawaysModule,
  rolemenus: rolemenusModule,
  tempvoice: tempvoiceModule,
  counters: countersModule,
  bambu: bambuModule,
  content: contentModule,
};

export const getModule = (name: string): ModuleDefinition | undefined =>
  (MODULE_REGISTRY as Record<string, ModuleDefinition>)[name];

/** Parses an unknown payload for a module, filling in every default. */
export const parseModuleConfig = (name: string, data: unknown): unknown => {
  const mod = getModule(name);
  if (!mod) throw new Error(`Unknown module: ${name}`);
  return mod.schema.parse(data ?? {});
};

/** Fresh defaults for a module. */
export const moduleDefaults = (name: string): unknown => parseModuleConfig(name, {});

/** Sidebar structure for the dashboard, grouped and in a stable order. */
export const moduleGroups = (): { group: string; modules: { name: ModuleName; title: string; icon: string; description: string }[] }[] => {
  const order = ["General", "Moderation", "Support", "Community", "Bambu Lab"];
  const groups = new Map<string, { name: ModuleName; title: string; icon: string; description: string }[]>();
  for (const [name, mod] of Object.entries(MODULE_REGISTRY)) {
    const list = groups.get(mod.ui.group) ?? [];
    list.push({ name: name as ModuleName, title: mod.ui.title, icon: mod.ui.icon, description: mod.ui.description });
    groups.set(mod.ui.group, list);
  }
  return order.filter((g) => groups.has(g)).map((group) => ({ group, modules: groups.get(group)! }));
};

/** Maps a module name to its parsed config type, so `config.get(id, "tickets")` is typed. */
export interface ModuleConfigMap {
  core: import("./core").CoreConfig;
  welcome: import("./welcome").WelcomeConfig;
  goodbye: import("./goodbye").GoodbyeConfig;
  autorole: import("./autorole").AutoroleConfig;
  verification: import("./verification").VerificationConfig;
  tickets: import("./tickets").TicketsConfig;
  modmail: import("./modmail").ModmailConfig;
  automod: import("./automod").AutomodConfig;
  antiraid: import("./antiraid").AntiraidConfig;
  moderation: import("./moderation").ModerationConfig;
  logging: import("./logging").LoggingConfig;
  leveling: import("./leveling").LevelingConfig;
  starboard: import("./starboard").StarboardConfig;
  suggestions: import("./suggestions").SuggestionsConfig;
  giveaways: import("./giveaways").GiveawaysConfig;
  rolemenus: import("./rolemenus").RolemenusConfig;
  tempvoice: import("./tempvoice").TempvoiceConfig;
  counters: import("./counters").CountersConfig;
  bambu: import("./bambu").BambuConfig;
  content: import("./content").ContentConfig;
}
