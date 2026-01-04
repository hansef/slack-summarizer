import { z } from 'zod';
import { SlackMessageSchema } from './slack.js';

export const ConversationSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  channelName: z.string().optional(),
  isThread: z.boolean(),
  threadTs: z.string().optional(),
  messages: z.array(SlackMessageSchema),
  startTime: z.string(), // ISO 8601
  endTime: z.string(), // ISO 8601
  participants: z.array(z.string()),
  messageCount: z.number(),
  userMessageCount: z.number(),
});

export type Conversation = z.infer<typeof ConversationSchema>;

export interface SegmentationResult {
  conversations: Conversation[];
  stats: {
    totalMessages: number;
    totalConversations: number;
    threadsExtracted: number;
    timeGapSplits: number;
    semanticSplits: number;
  };
}

export interface MessagePair {
  first: { text: string; user?: string; ts: string };
  second: { text: string; user?: string; ts: string };
  index: number;
}
