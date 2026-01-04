import { describe, it, expect } from 'vitest';
import {
  enrichConversation,
  enrichConversations,
  isContextMessage,
  CONTEXT_SUBTYPES,
  DEFAULT_ENRICHMENT_CONFIG,
} from '../../../../src/core/segmentation/context-enricher.js';
import { Conversation } from '../../../../src/core/models/conversation.js';
import { SlackMessage } from '../../../../src/core/models/slack.js';

// Helper to create mock messages
function createMessage(overrides: Partial<SlackMessage> = {}): SlackMessage {
  return {
    ts: overrides.ts ?? '1704067200.000000', // Default: Jan 1, 2024 00:00:00 UTC
    channel: overrides.channel ?? 'C123',
    text: overrides.text ?? 'Test message',
    user: overrides.user ?? 'U456',
    type: 'message',
    ...overrides,
  };
}

// Helper to create mock conversations
function createConversation(overrides: Partial<Conversation> = {}): Conversation {
  const messages = overrides.messages ?? [createMessage()];
  return {
    id: overrides.id ?? 'conv-1',
    channelId: overrides.channelId ?? 'C123',
    channelName: overrides.channelName ?? 'general',
    isThread: overrides.isThread ?? false,
    messages,
    startTime: overrides.startTime ?? '2024-01-01T11:00:00.000Z',
    endTime: overrides.endTime ?? '2024-01-01T11:30:00.000Z',
    participants: overrides.participants ?? ['U456'],
    messageCount: overrides.messageCount ?? messages.length,
    userMessageCount: overrides.userMessageCount ?? 1,
  };
}

// Convert timestamp string to Slack ts format
function toSlackTs(date: Date): string {
  return (date.getTime() / 1000).toFixed(6);
}

describe('context-enricher', () => {
  const userId = 'U_TARGET';
  const otherUserId = 'U_OTHER';
  const channelId = 'C123';

  describe('isContextMessage', () => {
    it('should return false for regular messages', () => {
      const msg = createMessage({ subtype: undefined });
      expect(isContextMessage(msg)).toBe(false);
    });

    it('should return false for bot messages', () => {
      const msg = createMessage({ subtype: 'bot_message' });
      expect(isContextMessage(msg)).toBe(false);
    });

    it('should return true for context_message subtype', () => {
      const msg = createMessage({ subtype: CONTEXT_SUBTYPES.CONTEXT });
      expect(isContextMessage(msg)).toBe(true);
    });

    it('should return true for mention_context subtype', () => {
      const msg = createMessage({ subtype: CONTEXT_SUBTYPES.MENTION_CONTEXT });
      expect(isContextMessage(msg)).toBe(true);
    });
  });

  describe('enrichConversation - @mention lookback', () => {
    it('should add context when user is @mentioned', () => {
      // Set up a timeline:
      // 9:00 AM - Other user sends message (context)
      // 9:30 AM - Other user sends message (context)
      // 10:00 AM - Other user @mentions target user
      // 10:05 AM - Target user responds

      const jan1 = new Date('2024-01-01T00:00:00Z');
      const ts0900 = toSlackTs(new Date(jan1.getTime() + 9 * 60 * 60 * 1000));
      const ts0930 = toSlackTs(new Date(jan1.getTime() + 9.5 * 60 * 60 * 1000));
      const ts1000 = toSlackTs(new Date(jan1.getTime() + 10 * 60 * 60 * 1000));
      const ts1005 = toSlackTs(new Date(jan1.getTime() + 10.08 * 60 * 60 * 1000));

      const mentionMessage = createMessage({
        ts: ts1000,
        channel: channelId,
        user: otherUserId,
        text: `Hey <@${userId}> can you help?`,
      });

      const responseMessage = createMessage({
        ts: ts1005,
        channel: channelId,
        user: userId,
        text: 'Sure, looking into it',
      });

      const conversation = createConversation({
        channelId,
        messages: [mentionMessage, responseMessage],
        participants: [otherUserId, userId],
        messageCount: 2,
        userMessageCount: 1,
        startTime: new Date(jan1.getTime() + 10 * 60 * 60 * 1000).toISOString(),
        endTime: new Date(jan1.getTime() + 10.08 * 60 * 60 * 1000).toISOString(),
      });

      // All channel messages (including earlier context)
      const allChannelMessages = [
        createMessage({
          ts: ts0900,
          channel: channelId,
          user: otherUserId,
          text: 'Starting investigation of the bug',
        }),
        createMessage({
          ts: ts0930,
          channel: channelId,
          user: otherUserId,
          text: 'Found the root cause',
        }),
        mentionMessage,
        responseMessage,
      ];

      const result = enrichConversation(conversation, allChannelMessages, userId);

      // Should have added 2 context messages
      expect(result.metadata.contextMessagesAdded).toBe(2);
      expect(result.metadata.reasons).toContain('mention_lookback');
      expect(result.metadata.originalMessageCount).toBe(2);

      // Conversation should now have 4 messages
      expect(result.conversation.messages.length).toBe(4);

      // First two messages should be marked as mention_context
      expect(result.conversation.messages[0].subtype).toBe(CONTEXT_SUBTYPES.MENTION_CONTEXT);
      expect(result.conversation.messages[1].subtype).toBe(CONTEXT_SUBTYPES.MENTION_CONTEXT);

      // Last two should not be context
      expect(isContextMessage(result.conversation.messages[2])).toBe(false);
      expect(isContextMessage(result.conversation.messages[3])).toBe(false);
    });

    it('should not add mention context when user initiated the conversation', () => {
      const ts = toSlackTs(new Date('2024-01-01T10:00:00Z'));

      const userMessage = createMessage({
        ts,
        channel: channelId,
        user: userId,
        text: 'I need help with something',
      });

      const conversation = createConversation({
        channelId,
        messages: [userMessage],
        participants: [userId],
        messageCount: 1,
        userMessageCount: 1,
      });

      // Some earlier messages in the channel
      const allChannelMessages = [
        createMessage({
          ts: toSlackTs(new Date('2024-01-01T09:00:00Z')),
          channel: channelId,
          user: otherUserId,
          text: 'Unrelated message',
        }),
        userMessage,
      ];

      // Disable short segment expansion to isolate testing mention lookback behavior
      const config = {
        ...DEFAULT_ENRICHMENT_CONFIG,
        enableShortSegmentExpansion: false,
      };

      const result = enrichConversation(conversation, allChannelMessages, userId, config);

      // Should not add any context since user initiated (and short segment expansion is disabled)
      expect(result.metadata.contextMessagesAdded).toBe(0);
      expect(result.metadata.reasons).not.toContain('mention_lookback');
      expect(result.conversation.messages.length).toBe(1);
    });

    it('should not add context when there is no @mention', () => {
      const ts = toSlackTs(new Date('2024-01-01T10:00:00Z'));

      const otherMessage = createMessage({
        ts,
        channel: channelId,
        user: otherUserId,
        text: 'Just a regular message',
      });

      const conversation = createConversation({
        channelId,
        messages: [otherMessage],
        participants: [otherUserId],
        messageCount: 1,
        userMessageCount: 0,
      });

      const result = enrichConversation(conversation, [otherMessage], userId);

      expect(result.metadata.contextMessagesAdded).toBe(0);
    });
  });

  describe('enrichConversation - short segment expansion', () => {
    it('should expand segments with 1-2 messages', () => {
      // Timeline:
      // 9:30 - Other user message (potential context)
      // 9:35 - Other user message (potential context)
      // 9:40 - Other user message (potential context)
      // 10:00 - User message (20 min gap, so within 60 min threshold)

      const jan1 = new Date('2024-01-01T00:00:00Z');
      const ts0930 = toSlackTs(new Date(jan1.getTime() + 9.5 * 60 * 60 * 1000));
      const ts0935 = toSlackTs(new Date(jan1.getTime() + 9.58 * 60 * 60 * 1000));
      const ts0940 = toSlackTs(new Date(jan1.getTime() + 9.67 * 60 * 60 * 1000));
      const ts1000 = toSlackTs(new Date(jan1.getTime() + 10 * 60 * 60 * 1000));

      const userMessage = createMessage({
        ts: ts1000,
        channel: channelId,
        user: userId,
        text: 'My response',
      });

      const conversation = createConversation({
        channelId,
        messages: [userMessage],
        participants: [userId],
        messageCount: 1,
        userMessageCount: 1,
        startTime: new Date(jan1.getTime() + 10 * 60 * 60 * 1000).toISOString(),
        endTime: new Date(jan1.getTime() + 10 * 60 * 60 * 1000).toISOString(),
      });

      const allChannelMessages = [
        createMessage({ ts: ts0930, channel: channelId, user: otherUserId, text: 'Context 1' }),
        createMessage({ ts: ts0935, channel: channelId, user: otherUserId, text: 'Context 2' }),
        createMessage({ ts: ts0940, channel: channelId, user: otherUserId, text: 'Context 3' }),
        userMessage,
      ];

      const config = {
        ...DEFAULT_ENRICHMENT_CONFIG,
        enableMentionLookback: false, // Disable mention lookback for this test
      };

      const result = enrichConversation(conversation, allChannelMessages, userId, config);

      // Should add context messages to reach target size of 5
      expect(result.metadata.contextMessagesAdded).toBe(3);
      expect(result.metadata.reasons).toContain('short_segment_expansion');
      expect(result.conversation.messages.length).toBe(4);

      // Context messages should be marked
      expect(result.conversation.messages[0].subtype).toBe(CONTEXT_SUBTYPES.CONTEXT);
      expect(result.conversation.messages[1].subtype).toBe(CONTEXT_SUBTYPES.CONTEXT);
      expect(result.conversation.messages[2].subtype).toBe(CONTEXT_SUBTYPES.CONTEXT);
    });

    it('should stop expansion at time gap', () => {
      // Timeline:
      // 8:00 - Other user message (2 hours before - beyond threshold)
      // 10:00 - User message

      const jan1 = new Date('2024-01-01T00:00:00Z');
      const ts0800 = toSlackTs(new Date(jan1.getTime() + 8 * 60 * 60 * 1000));
      const ts1000 = toSlackTs(new Date(jan1.getTime() + 10 * 60 * 60 * 1000));

      const userMessage = createMessage({
        ts: ts1000,
        channel: channelId,
        user: userId,
        text: 'My response',
      });

      const conversation = createConversation({
        channelId,
        messages: [userMessage],
        participants: [userId],
        messageCount: 1,
        userMessageCount: 1,
      });

      const allChannelMessages = [
        createMessage({ ts: ts0800, channel: channelId, user: otherUserId, text: 'Old message' }),
        userMessage,
      ];

      const config = {
        ...DEFAULT_ENRICHMENT_CONFIG,
        enableMentionLookback: false,
        shortSegmentMaxGapMinutes: 60, // 1 hour max gap
      };

      const result = enrichConversation(conversation, allChannelMessages, userId, config);

      // Should not add the old message (2 hour gap exceeds threshold)
      expect(result.metadata.contextMessagesAdded).toBe(0);
    });

    it('should not expand segments with more than threshold messages', () => {
      const jan1 = new Date('2024-01-01T00:00:00Z');
      const messages = [
        createMessage({ ts: toSlackTs(new Date(jan1.getTime() + 10 * 60 * 60 * 1000)), user: userId }),
        createMessage({ ts: toSlackTs(new Date(jan1.getTime() + 10.1 * 60 * 60 * 1000)), user: userId }),
        createMessage({ ts: toSlackTs(new Date(jan1.getTime() + 10.2 * 60 * 60 * 1000)), user: userId }),
      ];

      const conversation = createConversation({
        channelId,
        messages,
        participants: [userId],
        messageCount: 3,
        userMessageCount: 3,
      });

      const config = {
        ...DEFAULT_ENRICHMENT_CONFIG,
        enableMentionLookback: false,
        shortSegmentThreshold: 2, // Only expand if 2 or fewer messages
      };

      const result = enrichConversation(conversation, messages, userId, config);

      // Should not expand since we have 3 messages (above threshold of 2)
      expect(result.metadata.contextMessagesAdded).toBe(0);
    });

    it('should not expand thread conversations', () => {
      const userMessage = createMessage({
        ts: toSlackTs(new Date('2024-01-01T10:00:00Z')),
        channel: channelId,
        user: userId,
        text: 'Thread reply',
      });

      const conversation = createConversation({
        channelId,
        isThread: true, // This is a thread
        messages: [userMessage],
        messageCount: 1,
        userMessageCount: 1,
      });

      const allChannelMessages = [
        createMessage({
          ts: toSlackTs(new Date('2024-01-01T09:50:00Z')),
          channel: channelId,
          user: otherUserId,
        }),
        userMessage,
      ];

      const config = {
        ...DEFAULT_ENRICHMENT_CONFIG,
        enableMentionLookback: false,
      };

      const result = enrichConversation(conversation, allChannelMessages, userId, config);

      // Threads should not be expanded
      expect(result.metadata.contextMessagesAdded).toBe(0);
    });
  });

  describe('enrichConversation - priority', () => {
    it('should prioritize mention lookback over short segment expansion', () => {
      // When both could apply, mention lookback should take precedence
      const jan1 = new Date('2024-01-01T00:00:00Z');
      const ts0900 = toSlackTs(new Date(jan1.getTime() + 9 * 60 * 60 * 1000));
      const ts1000 = toSlackTs(new Date(jan1.getTime() + 10 * 60 * 60 * 1000));

      const mentionMessage = createMessage({
        ts: ts1000,
        channel: channelId,
        user: otherUserId,
        text: `<@${userId}> please help`,
      });

      const conversation = createConversation({
        channelId,
        messages: [mentionMessage],
        participants: [otherUserId],
        messageCount: 1,
        userMessageCount: 0,
      });

      const allChannelMessages = [
        createMessage({ ts: ts0900, channel: channelId, user: otherUserId, text: 'Earlier context' }),
        mentionMessage,
      ];

      const result = enrichConversation(conversation, allChannelMessages, userId);

      // Should use mention_lookback, not short_segment_expansion
      expect(result.metadata.reasons).toContain('mention_lookback');
      expect(result.metadata.reasons).not.toContain('short_segment_expansion');
    });
  });

  describe('enrichConversations', () => {
    it('should enrich multiple conversations', () => {
      const jan1 = new Date('2024-01-01T00:00:00Z');
      const ts0900 = toSlackTs(new Date(jan1.getTime() + 9 * 60 * 60 * 1000));
      const ts1000 = toSlackTs(new Date(jan1.getTime() + 10 * 60 * 60 * 1000));
      const ts1100 = toSlackTs(new Date(jan1.getTime() + 11 * 60 * 60 * 1000));

      const conv1 = createConversation({
        id: 'conv-1',
        channelId,
        messages: [
          createMessage({
            ts: ts1000,
            channel: channelId,
            user: otherUserId,
            text: `<@${userId}> help`,
          }),
        ],
        messageCount: 1,
        userMessageCount: 0,
      });

      const conv2 = createConversation({
        id: 'conv-2',
        channelId,
        messages: [createMessage({ ts: ts1100, channel: channelId, user: userId })],
        messageCount: 1,
        userMessageCount: 1,
      });

      const allChannelMessages = [
        createMessage({ ts: ts0900, channel: channelId, user: otherUserId, text: 'Earlier' }),
        ...conv1.messages,
        ...conv2.messages,
      ];

      const results = enrichConversations([conv1, conv2], allChannelMessages, userId);

      expect(results).toHaveLength(2);
      // First should have mention lookback context
      expect(results[0].messages.some((m) => m.subtype === CONTEXT_SUBTYPES.MENTION_CONTEXT)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle empty conversations', () => {
      const conversation = createConversation({
        messages: [],
        messageCount: 0,
        userMessageCount: 0,
      });

      const result = enrichConversation(conversation, [], userId);

      expect(result.metadata.contextMessagesAdded).toBe(0);
      expect(result.conversation.messages).toHaveLength(0);
    });

    it('should deduplicate context messages', () => {
      const jan1 = new Date('2024-01-01T00:00:00Z');
      const ts = toSlackTs(new Date(jan1.getTime() + 10 * 60 * 60 * 1000));

      // Same message appears in both conversation and as potential context
      const msg = createMessage({
        ts,
        channel: channelId,
        user: userId,
        text: 'My message',
      });

      const conversation = createConversation({
        channelId,
        messages: [msg],
        messageCount: 1,
        userMessageCount: 1,
      });

      // This should not add the same message as context
      const result = enrichConversation(conversation, [msg], userId);

      expect(result.conversation.messages).toHaveLength(1);
    });

    it('should only include messages from the same channel', () => {
      const jan1 = new Date('2024-01-01T00:00:00Z');
      const ts1000 = toSlackTs(new Date(jan1.getTime() + 10 * 60 * 60 * 1000));

      const mentionMessage = createMessage({
        ts: ts1000,
        channel: 'C123',
        user: otherUserId,
        text: `<@${userId}> help`,
      });

      const conversation = createConversation({
        channelId: 'C123',
        messages: [mentionMessage],
        messageCount: 1,
        userMessageCount: 0,
      });

      // Message from a different channel should not be included
      const allChannelMessages = [
        createMessage({
          ts: toSlackTs(new Date(jan1.getTime() + 9 * 60 * 60 * 1000)),
          channel: 'C_OTHER_CHANNEL',
          user: otherUserId,
          text: 'Different channel',
        }),
        mentionMessage,
      ];

      const result = enrichConversation(conversation, allChannelMessages, userId);

      // Should not include the message from the other channel
      expect(result.conversation.messages).toHaveLength(1);
      expect(result.metadata.contextMessagesAdded).toBe(0);
    });
  });
});
