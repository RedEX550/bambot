import { z } from "zod";
import type { ModuleDefinition } from "./types";

/** Voice or category channels renamed on a timer to show live server stats. */
export const counterSchema = z.object({
  channelId: z.string(),
  /** Supports {count}, {members}, {online}, {bots}, {boosts}, {tickets.open}, {printers}. */
  template: z.string().max(100).default("Members: {members}"),
  metric: z
    .enum(["members", "humans", "bots", "online", "boosts", "ticketsOpen", "roleCount", "custom"])
    .default("members"),
  roleId: z.string().default(""),
  enabled: z.boolean().default(true),
});

export const countersSchema = z.object({
  enabled: z.boolean().default(false),
  /** Discord rate limits channel renames hard: 2 per 10 minutes per channel. */
  updateIntervalMinutes: z.number().int().min(6).max(1440).default(10),
  counters: z.array(counterSchema).max(10).default([]),
});

export type CountersConfig = z.infer<typeof countersSchema>;

export const countersModule: ModuleDefinition<typeof countersSchema> = {
  name: "counters",
  schema: countersSchema,
  ui: {
    title: "Stat channels",
    description: "Live member, booster and open-ticket counters shown as channel names.",
    icon: "hash",
    group: "Community",
    sections: [
      {
        id: "general",
        title: "Counters",
        description:
          "Discord only allows two channel renames per ten minutes, so intervals below six minutes are rejected.",
        fields: [
          { path: "enabled", label: "Enable stat channels", kind: "toggle" },
          { path: "updateIntervalMinutes", label: "Update every (minutes)", kind: "number", min: 6, max: 1440, width: "half" },
          { path: "counters", label: "Counters", kind: "custom", component: "CounterEditor" },
        ],
      },
    ],
  },
};
