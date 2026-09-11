import { z } from "zod";
import type { ModuleDefinition } from "./types";

export const tempvoiceSchema = z.object({
  enabled: z.boolean().default(false),
  /** Joining one of these creates a personal channel and moves the member into it. */
  hubChannelIds: z.array(z.string()).default([]),
  parentCategoryId: z.string().default(""),
  /** Supports {user}, {user.display}, {number}. */
  nameTemplate: z.string().max(80).default("{user.display}'s room"),
  defaultUserLimit: z.number().int().min(0).max(99).default(0),
  defaultLocked: z.boolean().default(false),
  /** Post a control panel with rename, lock, limit and kick buttons. */
  controlPanel: z.boolean().default(true),
  /** Delete the channel this many seconds after the last person leaves. */
  emptyGraceSeconds: z.number().int().min(0).max(3600).default(10),
  maxPerMember: z.number().int().min(1).max(5).default(1),
  blockedRoles: z.array(z.string()).default([]),
});

export type TempvoiceConfig = z.infer<typeof tempvoiceSchema>;

export const tempvoiceModule: ModuleDefinition<typeof tempvoiceSchema> = {
  name: "tempvoice",
  schema: tempvoiceSchema,
  ui: {
    title: "Temp voice",
    description: "Join-to-create voice rooms that clean themselves up, with an owner control panel.",
    icon: "mic",
    group: "Community",
    sections: [
      {
        id: "general",
        title: "Join to create",
        fields: [
          { path: "enabled", label: "Enable temp voice", kind: "toggle" },
          { path: "hubChannelIds", label: "Hub channels", kind: "channels", channelTypes: ["voice"] },
          { path: "parentCategoryId", label: "Create rooms in", kind: "channel", channelTypes: ["category"], width: "half" },
          { path: "nameTemplate", label: "Room name template", kind: "text", scopes: ["member"], width: "half" },
          { path: "defaultUserLimit", label: "Default user limit", kind: "number", min: 0, max: 99, width: "half" },
          { path: "emptyGraceSeconds", label: "Delete after empty (seconds)", kind: "number", min: 0, max: 3600, width: "half" },
          { path: "defaultLocked", label: "Create rooms locked", kind: "toggle" },
          { path: "controlPanel", label: "Post an owner control panel", kind: "toggle" },
          { path: "maxPerMember", label: "Rooms per member", kind: "number", min: 1, max: 5, width: "half" },
          { path: "blockedRoles", label: "Blocked roles", kind: "roles" },
        ],
      },
    ],
  },
};
