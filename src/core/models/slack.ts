import { z } from 'zod';

// Slack attachment schema (for shared messages, unfurls, etc.)
export const SlackAttachmentSchema = z.object({
  fallback: z.string().optional(), // Plain text summary
  text: z.string().optional(), // Main attachment text
  pretext: z.string().optional(), // Text above the attachment
  title: z.string().optional(),
  title_link: z.string().optional(),
  author_name: z.string().optional(), // For shared messages: original author
  author_id: z.string().optional(), // User ID of original author
  channel_name: z.string().optional(), // For shared messages: source channel
  channel_id: z.string().optional(),
  from_url: z.string().optional(), // URL that was unfurled
  footer: z.string().optional(),
});

export type SlackAttachment = z.infer<typeof SlackAttachmentSchema>;

// Core Slack message schema
export const SlackMessageSchema = z.object({
  ts: z.string(),
  thread_ts: z.string().optional(),
  user: z.string().optional(), // Can be undefined for bot messages with different structure
  text: z.string().default(''),
  channel: z.string(),
  type: z.string().default('message'),
  subtype: z.string().optional(),
  reply_count: z.number().optional(),
  reply_users_count: z.number().optional(),
  latest_reply: z.string().optional(),
  reactions: z
    .array(
      z.object({
        name: z.string(),
        count: z.number(),
        users: z.array(z.string()),
      })
    )
    .optional(),
  attachments: z.array(SlackAttachmentSchema).optional(),
});

export type SlackMessage = z.infer<typeof SlackMessageSchema>;

// Channel info schema
export const SlackChannelSchema = z.object({
  id: z.string(),
  name: z.string().optional(), // DMs don't have names
  is_channel: z.boolean().optional(),
  is_group: z.boolean().optional(),
  is_im: z.boolean().optional(),
  is_mpim: z.boolean().optional(),
  is_private: z.boolean().optional(),
  is_member: z.boolean().optional(),
  num_members: z.number().optional(),
  user: z.string().optional(), // For DMs: the other user's ID
  members: z.array(z.string()).optional(), // For MPIMs: array of member user IDs
});

export type SlackChannel = z.infer<typeof SlackChannelSchema>;

export type ChannelType = 'public_channel' | 'private_channel' | 'im' | 'mpim';

export function getChannelType(channel: SlackChannel): ChannelType {
  if (channel.is_im) return 'im';
  if (channel.is_mpim) return 'mpim';
  if (channel.is_private || channel.is_group) return 'private_channel';
  return 'public_channel';
}

// User info schema
export const SlackUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  real_name: z.string().optional(),
  display_name: z.string().optional(),
  is_bot: z.boolean().optional(),
});

export type SlackUser = z.infer<typeof SlackUserSchema>;

// Thread schema
export const SlackThreadSchema = z.object({
  threadTs: z.string(),
  channel: z.string(),
  messages: z.array(SlackMessageSchema),
});

export type SlackThread = z.infer<typeof SlackThreadSchema>;

// Reaction schema
export const SlackReactionItemSchema = z.object({
  messageId: z.string(),
  channel: z.string(),
  reaction: z.string(),
  timestamp: z.string(),
});

export type SlackReactionItem = z.infer<typeof SlackReactionItemSchema>;

// User activity data - the main output of the fetcher
export const UserActivityDataSchema = z.object({
  userId: z.string(),
  timeRange: z.object({
    start: z.string(), // ISO 8601
    end: z.string(),
  }),
  messagesSent: z.array(SlackMessageSchema),
  mentionsReceived: z.array(SlackMessageSchema),
  threadsParticipated: z.array(SlackThreadSchema),
  reactionsGiven: z.array(SlackReactionItemSchema),
  channels: z.array(SlackChannelSchema),
  /** All messages from active channels (for context enrichment) */
  allChannelMessages: z.array(SlackMessageSchema).optional(),
});

export type UserActivityData = z.infer<typeof UserActivityDataSchema>;

// Auth test response
export const AuthTestResponseSchema = z.object({
  ok: z.literal(true),
  user_id: z.string(),
  user: z.string(),
  team_id: z.string(),
  team: z.string(),
});

export type AuthTestResponse = z.infer<typeof AuthTestResponseSchema>;
