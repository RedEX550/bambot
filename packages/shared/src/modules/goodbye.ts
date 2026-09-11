import { z } from "zod";
import { messagePayloadSchema } from "../embed";
import type { ModuleDefinition } from "./types";

export const goodbyeSchema = z.object({
  enabled: z.boolean().default(false),
  channelId: z.string().default(""),
  message: messagePayloadSchema.default({
    content: "",
    embeds: [
      {
        title: "{user.tag} left",
        description: "They were with us since {user.joined}. We are now {server.members} members.",
        color: "#64748B",
        timestamp: true,
        fields: [],
      },
    ],
    buttons: [],
    ghostPing: false,
    deleteAfter: 0,
  }),
  /** Do not post a goodbye when the member was kicked or banned. */
  skipOnModeration: z.boolean().default(true),
});

export type GoodbyeConfig = z.infer<typeof goodbyeSchema>;

export const goodbyeModule: ModuleDefinition<typeof goodbyeSchema> = {
  name: "goodbye",
  schema: goodbyeSchema,
  ui: {
    title: "Goodbye",
    description: "Post a note when someone leaves the server.",
    icon: "door",
    group: "Community",
    sections: [
      {
        id: "general",
        title: "Goodbye message",
        fields: [
          { path: "enabled", label: "Enable goodbye messages", kind: "toggle" },
          { path: "channelId", label: "Channel", kind: "channel", channelTypes: ["text"], showIf: { path: "enabled", truthy: true } },
          { path: "message", label: "Message", kind: "message", scopes: ["member", "guild"], showIf: { path: "enabled", truthy: true } },
          {
            path: "skipOnModeration",
            label: "Stay quiet on kicks and bans",
            kind: "toggle",
            description: "Avoids announcing every removal to the whole server.",
            showIf: { path: "enabled", truthy: true },
          },
        ],
      },
    ],
  },
};
