import { z } from "zod";
import type { ModuleDefinition } from "./types";

/**
 * The menus themselves live in the RoleMenu table so they can be edited without
 * rewriting the whole module blob; this holds the server-wide guard rails.
 */
export const rolemenusSchema = z.object({
  enabled: z.boolean().default(true),
  logChannelId: z.string().default(""),
  /** Roles a self-service menu may never hand out, even if misconfigured. */
  forbiddenRoles: z.array(z.string()).default([]),
  /** Total self-assignable roles one member may hold. 0 = unlimited. */
  maxRolesPerMember: z.number().int().min(0).max(100).default(0),
  ephemeralConfirmations: z.boolean().default(true),
});

export type RolemenusConfig = z.infer<typeof rolemenusSchema>;

export const rolemenusModule: ModuleDefinition<typeof rolemenusSchema> = {
  name: "rolemenus",
  schema: rolemenusSchema,
  ui: {
    title: "Role menus",
    description: "Self-assignable roles as buttons or dropdowns — printer models, regions, notifications.",
    icon: "list",
    group: "Community",
    customPage: "RoleMenusPage",
    sections: [
      {
        id: "general",
        title: "Guard rails",
        fields: [
          { path: "enabled", label: "Enable role menus", kind: "toggle" },
          { path: "forbiddenRoles", label: "Never assignable", kind: "roles", description: "A safety net against a mis-set menu handing out staff roles." },
          { path: "maxRolesPerMember", label: "Max self-assigned roles", kind: "number", min: 0, max: 100, width: "half" },
          { path: "logChannelId", label: "Log channel", kind: "channel", width: "half" },
          { path: "ephemeralConfirmations", label: "Private confirmations", kind: "toggle" },
        ],
      },
      {
        id: "menus",
        title: "Menus",
        fields: [{ path: "__menus", label: "Menus", kind: "custom", component: "RoleMenuList" }],
      },
    ],
  },
};
