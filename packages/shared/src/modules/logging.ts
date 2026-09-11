import { z } from "zod";
import type { ModuleDefinition } from "./types";
import type { FieldSpec } from "../fields";

/**
 * Logging is grouped: each group gets its own channel, and individual events
 * inside a group can be muted. That keeps a busy server from needing 30 channels
 * while still allowing "log everything except message edits".
 */
export const LOG_GROUPS = {
  message: {
    label: "Messages",
    events: {
      messageDelete: "Message deleted",
      messageUpdate: "Message edited",
      messageBulkDelete: "Messages purged",
      reactionRemoveAll: "All reactions cleared",
    },
  },
  member: {
    label: "Members",
    events: {
      memberJoin: "Member joined",
      memberLeave: "Member left",
      nicknameUpdate: "Nickname changed",
      roleUpdate: "Roles changed",
      avatarUpdate: "Avatar changed",
      usernameUpdate: "Username changed",
    },
  },
  moderation: {
    label: "Moderation",
    events: {
      memberBan: "Member banned",
      memberUnban: "Member unbanned",
      memberKick: "Member kicked",
      memberTimeout: "Member timed out",
      memberWarn: "Member warned",
      caseUpdate: "Case edited or pardoned",
    },
  },
  automod: {
    label: "Automod",
    events: {
      automodHit: "Filter triggered",
      raidDetected: "Raid detected",
      escalation: "Escalation applied",
    },
  },
  server: {
    label: "Server",
    events: {
      channelCreate: "Channel created",
      channelDelete: "Channel deleted",
      channelUpdate: "Channel updated",
      roleCreate: "Role created",
      roleDelete: "Role deleted",
      roleUpdate: "Role updated",
      emojiUpdate: "Emoji or sticker updated",
      guildUpdate: "Server settings changed",
      inviteCreate: "Invite created",
      inviteDelete: "Invite deleted",
      threadCreate: "Thread created",
      threadDelete: "Thread deleted",
    },
  },
  voice: {
    label: "Voice",
    events: {
      voiceJoin: "Joined a voice channel",
      voiceLeave: "Left a voice channel",
      voiceMove: "Moved between channels",
      voiceStateUpdate: "Muted, deafened or streaming",
    },
  },
  tickets: {
    label: "Tickets",
    events: {
      ticketOpen: "Ticket opened",
      ticketClaim: "Ticket claimed",
      ticketClose: "Ticket closed",
      ticketRating: "Rating submitted",
    },
  },
  dashboard: {
    label: "Dashboard",
    events: {
      configUpdate: "Setting changed on the dashboard",
      panelPublish: "Panel published",
      login: "Dashboard sign-in",
    },
  },
} as const;

export type LogGroup = keyof typeof LOG_GROUPS;

const groupSchema = z.object({
  channelId: z.string().default(""),
  enabled: z.boolean().default(false),
  muted: z.array(z.string()).default([]),
});

export const loggingSchema = z.object({
  enabled: z.boolean().default(false),
  /** Never log anything that happens in these channels. */
  ignoredChannels: z.array(z.string()).default([]),
  ignoredRoles: z.array(z.string()).default([]),
  ignoreBots: z.boolean().default(true),
  /** Attach the deleted message content. Turn off for privacy-sensitive servers. */
  includeContent: z.boolean().default(true),
  /** Re-upload deleted images so the log survives CDN expiry. */
  mirrorAttachments: z.boolean().default(false),
  groups: z
    .object({
      message: groupSchema.default({}),
      member: groupSchema.default({}),
      moderation: groupSchema.default({}),
      automod: groupSchema.default({}),
      server: groupSchema.default({}),
      voice: groupSchema.default({}),
      tickets: groupSchema.default({}),
      dashboard: groupSchema.default({}),
    })
    .default({}),
});

export type LoggingConfig = z.infer<typeof loggingSchema>;

const groupFields = (key: LogGroup): FieldSpec[] => {
  const group = LOG_GROUPS[key];
  return [
    { path: `groups.${key}.enabled`, label: `Log ${group.label.toLowerCase()}`, kind: "toggle" },
    {
      path: `groups.${key}.channelId`,
      label: "Channel",
      kind: "channel",
      width: "half",
      showIf: { path: `groups.${key}.enabled`, truthy: true },
    },
    {
      path: `groups.${key}.muted`,
      label: "Muted events",
      kind: "multiselect",
      description: "Events selected here are not logged.",
      options: Object.entries(group.events).map(([value, label]) => ({ value, label: label as string })),
      showIf: { path: `groups.${key}.enabled`, truthy: true },
    },
  ];
};

export const loggingModule: ModuleDefinition<typeof loggingSchema> = {
  name: "logging",
  schema: loggingSchema,
  ui: {
    title: "Audit logging",
    description: "Route 30+ Discord and Bambot events into the channels you choose.",
    icon: "scroll",
    group: "Moderation",
    sections: [
      {
        id: "general",
        title: "General",
        fields: [
          { path: "enabled", label: "Enable logging", kind: "toggle" },
          { path: "ignoredChannels", label: "Ignored channels", kind: "channels" },
          { path: "ignoredRoles", label: "Ignored roles", kind: "roles" },
          { path: "ignoreBots", label: "Ignore bots", kind: "toggle" },
          { path: "includeContent", label: "Include message content", kind: "toggle", description: "Turn off if your server has strict privacy expectations." },
          { path: "mirrorAttachments", label: "Mirror deleted attachments", kind: "toggle", description: "Re-uploads images so links do not expire." },
        ],
      },
      ...(Object.keys(LOG_GROUPS) as LogGroup[]).map((key) => ({
        id: key,
        title: LOG_GROUPS[key].label,
        fields: groupFields(key),
      })),
    ],
  },
};
