import { z } from 'zod';

export const ConversationSummarySchema = z.object({
  /** 2-4 sentence narrative describing the full story arc */
  narrative_summary: z.string(),
  /** Start time of this topic (ISO 8601) */
  start_time: z.string(),
  /** End time of this topic (ISO 8601) */
  end_time: z.string(),
  /** Total messages in this consolidated topic */
  message_count: z.number(),
  /** Messages from the target user */
  user_messages: z.number(),
  /** Participants with @ prefix */
  participants: z.array(z.string()),
  /** 2-5 key events with context */
  key_events: z.array(z.string()),
  /** Detected references (GitHub issues, project names, etc.) */
  references: z.array(z.string()),
  /** Resolution, decision, or current status (null if ongoing/unclear) */
  outcome: z.string().nullable(),
  /** Actionable next steps committed to by the user (e.g., "Send proposal by Friday") */
  next_actions: z.array(z.string()).optional(),
  /** Timesheet-ready one-liner: action phrase (10-15 words max) for billing logs */
  timesheet_entry: z.string(),
  /** Primary slack link to the conversation start */
  slack_link: z.string().url(),
  /** All slack links if multiple conversations were consolidated */
  slack_links: z.array(z.string().url()).optional(),
  /** Number of original conversation segments that were merged */
  segments_merged: z.number().optional(),
});

export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

export const ChannelSummarySchema = z.object({
  channel_id: z.string(),
  channel_name: z.string(),
  channel_type: z.enum(['public_channel', 'private_channel', 'im', 'mpim']),
  interactions: z.object({
    messages_sent: z.number(),
    mentions_received: z.number(),
    threads: z.number(),
  }),
  /** Narrative summaries - consolidated topics with full context */
  topics: z.array(ConversationSummarySchema),
  /** Consolidation stats for this channel */
  consolidation_stats: z
    .object({
      original_segments: z.number(),
      consolidated_topics: z.number(),
      bot_messages_merged: z.number(),
      trivial_messages_merged: z.number(),
      adjacent_merged: z.number(),
      proximity_merged: z.number(),
      same_author_merged: z.number(),
    })
    .optional(),
});

export type ChannelSummary = z.infer<typeof ChannelSummarySchema>;

export const SummaryOutputSchema = z.object({
  metadata: z.object({
    generated_at: z.string(),
    schema_version: z.literal('2.0.0'),
    request: z.object({
      user_id: z.string(),
      period_start: z.string(),
      period_end: z.string(),
      timezone: z.string(),
    }),
  }),
  summary: z.object({
    total_channels: z.number(),
    total_messages: z.number(),
    mentions_received: z.number(),
    threads_participated: z.number(),
    reactions_given: z.number(),
  }),
  channels: z.array(ChannelSummarySchema),
});

export type SummaryOutput = z.infer<typeof SummaryOutputSchema>;

// Intermediate types used during summarization
export interface ChannelActivityStats {
  channelId: string;
  channelName: string;
  channelType: 'public_channel' | 'private_channel' | 'im' | 'mpim';
  messagesSent: number;
  mentionsReceived: number;
  threadsParticipated: number;
}

export interface SummarizationRequest {
  userId: string;
  periodStart: string;
  periodEnd: string;
  timezone: string;
}
