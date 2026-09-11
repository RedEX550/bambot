import { z } from "zod";
import type { ModuleDefinition } from "./types";

export const autoroleSchema = z.object({
  enabled: z.boolean().default(false),
  /** Roles granted to every human on join. */
  roles: z.array(z.string()).default([]),
  /** Roles granted to bots on join. */
  botRoles: z.array(z.string()).default([]),
  /** Wait this many seconds before granting (pairs well with raid mode). */
  delaySeconds: z.number().int().min(0).max(86400).default(0),
  /** Re-apply the roles a member had when they left. */
  restoreOnRejoin: z.boolean().default(true),
  /** Roles never restored automatically (staff, mutes are handled separately). */
  restoreBlacklist: z.array(z.string()).default([]),
  /** Grant roles once a member reaches a level. */
  levelRoles: z
    .array(
      z.object({
        level: z.number().int().min(1).max(1000),
        roleId: z.string(),
        removePrevious: z.boolean().default(true),
      }),
    )
    .default([]),
});

export type AutoroleConfig = z.infer<typeof autoroleSchema>;

export const autoroleModule: ModuleDefinition<typeof autoroleSchema> = {
  name: "autorole",
  schema: autoroleSchema,
  ui: {
    title: "Auto roles",
    description: "Hand out roles on join, restore them on rejoin, and reward activity.",
    icon: "user-plus",
    group: "Community",
    sections: [
      {
        id: "join",
        title: "On join",
        fields: [
          { path: "enabled", label: "Enable auto roles", kind: "toggle" },
          { path: "roles", label: "Roles for members", kind: "roles", showIf: { path: "enabled", truthy: true } },
          { path: "botRoles", label: "Roles for bots", kind: "roles", showIf: { path: "enabled", truthy: true } },
          {
            path: "delaySeconds",
            label: "Delay before granting (seconds)",
            kind: "number",
            min: 0,
            max: 86400,
            width: "half",
            description: "A short delay lets the raid filter act first.",
            showIf: { path: "enabled", truthy: true },
          },
        ],
      },
      {
        id: "restore",
        title: "Role persistence",
        fields: [
          {
            path: "restoreOnRejoin",
            label: "Restore roles when a member rejoins",
            kind: "toggle",
            description: "Stops people role-resetting by leaving and coming back.",
          },
          { path: "restoreBlacklist", label: "Never restore these roles", kind: "roles", showIf: { path: "restoreOnRejoin", truthy: true } },
        ],
      },
      {
        id: "levels",
        title: "Level rewards",
        description: "Configured here, granted by the levelling module.",
        fields: [{ path: "levelRoles", label: "Level rewards", kind: "custom", component: "LevelRewardsEditor" }],
      },
    ],
  },
};
