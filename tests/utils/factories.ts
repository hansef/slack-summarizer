/**
 * Factory functions for creating test data.
 *
 * These factories produce valid typed objects with sensible defaults that can be
 * overridden for specific test cases. Use these instead of creating inline objects
 * to ensure type safety and reduce test boilerplate.
 */

import { v4 as uuidv4 } from 'uuid';
import type { SlackMessage, SlackChannel, SlackUser, SlackThread, UserActivityData } from '@/core/models/slack.js';
import type { Conversation } from '@/core/models/conversation.js';

// Note: Consolidation types (ConversationGroup, ConsolidationResult) are not imported
// to avoid circular dependencies. Test files that need them should import directly.

/**
 * Creates a Slack message with sensible defaults.
 * All fields can be overridden via the partial parameter.
 */
export function createSlackMessage(overrides?: Partial<SlackMessage>): SlackMessage {
  const ts = overrides?.ts ?? '1704067200.000000'; // 2024-01-01 00:00:00 UTC
  return {
    type: 'message',
    ts,
    channel: 'C123456',
    text: 'Test message',
    user: 'U123456',
    ...overrides,
  };
}

/**
 * Creates a Slack message that appears to be from a bot.
 * Bot messages are identified by subtype='bot_message' or matching bot user IDs.
 */
export function createBotMessage(overrides?: Partial<SlackMessage>): SlackMessage {
  return createSlackMessage({
    subtype: 'bot_message',
    user: 'B123456', // Bot user IDs typically start with B
    text: 'Automated message from bot',
    ...overrides,
  });
}

/**
 * Creates a Slack message that is part of a thread (reply).
 * Thread replies have thread_ts set to the parent message's ts.
 */
export function createThreadReply(parentTs: string, overrides?: Partial<SlackMessage>): SlackMessage {
  return createSlackMessage({
    thread_ts: parentTs,
    ...overrides,
  });
}

/**
 * Creates a Slack channel with sensible defaults.
 */
export function createSlackChannel(overrides?: Partial<SlackChannel>): SlackChannel {
  return {
    id: 'C123456',
    name: 'general',
    is_channel: true,
    is_private: false,
    is_member: true,
    ...overrides,
  };
}

/**
 * Creates a DM channel (direct message).
 * DM channels have is_im=true and a user field indicating the other participant.
 */
export function createDMChannel(otherUserId: string, overrides?: Partial<SlackChannel>): SlackChannel {
  return createSlackChannel({
    id: `D${otherUserId.slice(1)}`, // DM channel IDs start with D
    name: undefined, // DMs don't have names
    is_channel: false,
    is_im: true,
    user: otherUserId,
    ...overrides,
  });
}

/**
 * Creates a Slack user with sensible defaults.
 */
export function createSlackUser(overrides?: Partial<SlackUser>): SlackUser {
  return {
    id: 'U123456',
    name: 'testuser',
    real_name: 'Test User',
    display_name: 'testuser',
    is_bot: false,
    ...overrides,
  };
}

/**
 * Creates a Slack thread with parent message and replies.
 */
export function createSlackThread(overrides?: Partial<SlackThread>): SlackThread {
  const threadTs = overrides?.threadTs ?? '1704067200.000000';
  const channel = overrides?.channel ?? 'C123456';

  return {
    threadTs,
    channel,
    messages: overrides?.messages ?? [
      createSlackMessage({ ts: threadTs, channel, reply_count: 2 }),
      createThreadReply(threadTs, { ts: '1704067260.000000', channel }),
      createThreadReply(threadTs, { ts: '1704067320.000000', channel }),
    ],
  };
}

/**
 * Creates a Conversation object (the result of message segmentation).
 */
export function createConversation(overrides?: Partial<Conversation>): Conversation {
  const id = overrides?.id ?? uuidv4();
  const channelId = overrides?.channelId ?? 'C123456';
  const messages = overrides?.messages ?? [createSlackMessage({ channel: channelId })];

  return {
    id,
    channelId,
    channelName: 'general',
    isThread: false,
    messages,
    startTime: '2024-01-01T10:00:00Z',
    endTime: '2024-01-01T10:30:00Z',
    participants: ['U123456'],
    messageCount: messages.length,
    userMessageCount: messages.length,
    ...overrides,
  };
}

/**
 * Creates a thread Conversation.
 */
export function createThreadConversation(overrides?: Partial<Conversation>): Conversation {
  return createConversation({
    isThread: true,
    threadTs: '1704067200.000000',
    ...overrides,
  });
}

// Note: ConversationGroup and ConsolidationResult factories were removed to avoid
// circular dependencies with the consolidator module. Tests that need these types
// should use the actual consolidateConversations function or create inline objects.

/**
 * Creates UserActivityData (the output of the data fetcher).
 */
export function createUserActivityData(overrides?: Partial<UserActivityData>): UserActivityData {
  return {
    userId: 'U123456',
    timeRange: {
      start: '2024-01-01T00:00:00Z',
      end: '2024-01-01T23:59:59Z',
    },
    messagesSent: [],
    mentionsReceived: [],
    threadsParticipated: [],
    reactionsGiven: [],
    channels: [createSlackChannel()],
    allChannelMessages: [],
    ...overrides,
  };
}

/**
 * Generates sequential timestamps starting from a base time.
 * Useful for creating multiple messages with realistic time progression.
 *
 * @param startTs - Starting timestamp in Slack format (seconds.microseconds)
 * @param count - Number of timestamps to generate
 * @param gapSeconds - Gap between timestamps in seconds (default: 60)
 */
export function generateTimestamps(startTs: string, count: number, gapSeconds = 60): string[] {
  const [seconds] = startTs.split('.');
  const baseSeconds = parseInt(seconds, 10);

  return Array.from({ length: count }, (_, i) => {
    const newSeconds = baseSeconds + (i * gapSeconds);
    return `${newSeconds}.000000`;
  });
}

/**
 * Creates a sequence of messages in a conversation with realistic timestamps.
 */
export function createMessageSequence(
  count: number,
  options?: {
    startTs?: string;
    gapSeconds?: number;
    channelId?: string;
    users?: string[];
  }
): SlackMessage[] {
  const startTs = options?.startTs ?? '1704067200.000000';
  const gapSeconds = options?.gapSeconds ?? 60;
  const channelId = options?.channelId ?? 'C123456';
  const users = options?.users ?? ['U123456'];

  const timestamps = generateTimestamps(startTs, count, gapSeconds);

  return timestamps.map((ts, i) => createSlackMessage({
    ts,
    channel: channelId,
    user: users[i % users.length],
    text: `Message ${i + 1}`,
  }));
}
