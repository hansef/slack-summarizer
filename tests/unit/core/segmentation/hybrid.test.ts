/**
 * Tests for hybrid segmentation.
 *
 * Hybrid segmentation combines:
 * 1. Thread extraction - threads are converted to separate conversations
 * 2. Time-based segmentation - messages split by time gaps
 * 3. Semantic refinement - LLM analyzes large segments for topic boundaries
 * 4. Context enrichment - adds prior context for @mentions and short segments
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { hybridSegmentation, segmentUserActivity } from '@/core/segmentation/hybrid.js';
import type { SlackMessage, SlackThread } from '@/core/models/slack.js';

// Mock the semantic analyzer to avoid real LLM calls
vi.mock('@/core/segmentation/semantic.js', () => ({
  analyzeConversationBoundaries: vi.fn().mockResolvedValue([]),
  applyBoundaryDecisions: vi.fn().mockReturnValue([]),
}));

// Mock context enricher
vi.mock('@/core/segmentation/context-enricher.js', () => ({
  enrichConversations: vi.fn(<T>(conversations: T): T => conversations),
  DEFAULT_ENRICHMENT_CONFIG: {
    minMessagesForExpansion: 2,
    targetMinMessages: 5,
    maxGapMinutesForExpansion: 60,
    priorContextWindow: 20,
  },
}));

// Mock concurrency - just execute the function directly
vi.mock('@/utils/concurrency.js', () => ({
  mapWithGlobalClaudeLimiter: vi.fn(
    async <T, R>(items: T[], fn: (item: T, index: number) => Promise<R>): Promise<R[]> => {
      return Promise.all(items.map((item, index) => fn(item, index)));
    }
  ),
}));

// Mock env
vi.mock('@/utils/env.js', () => ({
  getEnv: vi.fn(() => ({
    SLACK_SUMMARIZER_CLAUDE_CONCURRENCY: 5,
  })),
}));

// Helper to create messages
function createMessage(ts: string, user: string, text: string, threadTs?: string): SlackMessage {
  return {
    type: 'message',
    ts,
    channel: 'C123',
    text,
    user,
    thread_ts: threadTs,
  };
}

// Helper to create a sequence of messages
function createMessageSequence(
  count: number,
  baseTs: number,
  gapSeconds: number,
  user: string = 'U123'
): SlackMessage[] {
  return Array.from({ length: count }, (_, i) => {
    const ts = baseTs + i * gapSeconds;
    return createMessage(`${ts}.000000`, user, `Message ${i + 1}`);
  });
}

describe('hybridSegmentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('empty input', () => {
    it('should handle empty messages and threads', async () => {
      const result = await hybridSegmentation([], [], 'C123', 'general', 'U123');

      expect(result.conversations).toHaveLength(0);
      expect(result.stats.totalMessages).toBe(0);
      expect(result.stats.threadsExtracted).toBe(0);
    });
  });

  describe('thread extraction', () => {
    it('should convert threads to separate conversations', async () => {
      const thread: SlackThread = {
        threadTs: '1704067200.000000',
        channel: 'C123',
        messages: [
          createMessage('1704067200.000000', 'U123', 'Parent message'),
          createMessage('1704067260.000001', 'U456', 'Reply 1', '1704067200.000000'),
          createMessage('1704067320.000002', 'U123', 'Reply 2', '1704067200.000000'),
        ],
      };

      const result = await hybridSegmentation([], [thread], 'C123', 'general', 'U123');

      expect(result.conversations).toHaveLength(1);
      expect(result.conversations[0].isThread).toBe(true);
      expect(result.conversations[0].threadTs).toBe('1704067200.000000');
      expect(result.conversations[0].messages).toHaveLength(3);
      expect(result.conversations[0].participants).toContain('U123');
      expect(result.conversations[0].participants).toContain('U456');
      expect(result.stats.threadsExtracted).toBe(1);
    });

    it('should count user messages in threads', async () => {
      const thread: SlackThread = {
        threadTs: '1704067200.000000',
        channel: 'C123',
        messages: [
          createMessage('1704067200.000000', 'U123', 'My message'),
          createMessage('1704067260.000001', 'U456', 'Other user'),
          createMessage('1704067320.000002', 'U123', 'My reply'),
        ],
      };

      const result = await hybridSegmentation([], [thread], 'C123', 'general', 'U123');

      expect(result.conversations[0].userMessageCount).toBe(2);
    });
  });

  describe('thread reply filtering', () => {
    it('should filter out thread replies from main messages', async () => {
      const messages = [
        createMessage('1704067200.000000', 'U123', 'Main message'),
        createMessage('1704067260.000000', 'U456', 'Thread reply', '1704067200.000000'),
        createMessage('1704067320.000000', 'U789', 'Another main message'),
      ];

      const result = await hybridSegmentation(messages, [], 'C123', 'general', 'U123');

      // Thread reply should be filtered out, only 2 main messages remain
      const totalMessagesInConversations = result.conversations.reduce(
        (sum, c) => sum + c.messages.length,
        0
      );
      expect(totalMessagesInConversations).toBe(2);
    });
  });

  describe('time-based segmentation', () => {
    it('should split messages by large time gaps', async () => {
      // Create messages with a 2-hour gap in the middle
      const baseTs = 1704067200; // 2024-01-01 00:00:00
      const messages = [
        ...createMessageSequence(3, baseTs, 60, 'U123'), // 3 messages, 1 min apart
        ...createMessageSequence(3, baseTs + 7200, 60, 'U123'), // 3 messages 2 hours later
      ];

      const result = await hybridSegmentation(messages, [], 'C123', 'general', 'U123', [], {
        gapThresholdMinutes: 60,
      });

      // Should be split into 2 conversations
      expect(result.conversations.length).toBeGreaterThanOrEqual(2);
      expect(result.stats.timeGapSplits).toBeGreaterThan(0);
    });

    it('should keep messages together within threshold', async () => {
      // Create messages all within 30 minutes
      const baseTs = 1704067200;
      const messages = createMessageSequence(5, baseTs, 300, 'U123'); // 5 min gaps

      const result = await hybridSegmentation(messages, [], 'C123', 'general', 'U123', [], {
        gapThresholdMinutes: 60,
      });

      // All should be in one conversation
      expect(result.conversations).toHaveLength(1);
      expect(result.conversations[0].messages).toHaveLength(5);
    });
  });

  describe('conversation metadata', () => {
    it('should set correct start and end times', async () => {
      const messages = [
        createMessage('1704067200.000000', 'U123', 'First'),
        createMessage('1704067260.000000', 'U456', 'Middle'),
        createMessage('1704067320.000000', 'U123', 'Last'),
      ];

      const result = await hybridSegmentation(messages, [], 'C123', 'general', 'U123');

      const conv = result.conversations[0];
      // Check that timestamps are valid ISO strings (timezone-agnostic)
      expect(conv.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(conv.endTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      // End time should be >= start time
      expect(new Date(conv.endTime).getTime()).toBeGreaterThanOrEqual(new Date(conv.startTime).getTime());
    });

    it('should include channel info', async () => {
      const messages = [createMessage('1704067200.000000', 'U123', 'Hello')];

      const result = await hybridSegmentation(messages, [], 'C123', 'general', 'U123');

      expect(result.conversations[0].channelId).toBe('C123');
      expect(result.conversations[0].channelName).toBe('general');
    });

    it('should collect unique participants', async () => {
      const messages = [
        createMessage('1704067200.000000', 'U123', 'Hello'),
        createMessage('1704067260.000000', 'U456', 'Hi'),
        createMessage('1704067320.000000', 'U123', 'Bye'),
        createMessage('1704067380.000000', 'U789', 'Later'),
      ];

      const result = await hybridSegmentation(messages, [], 'C123', 'general', 'U123');

      expect(result.conversations[0].participants).toHaveLength(3);
      expect(result.conversations[0].participants).toContain('U123');
      expect(result.conversations[0].participants).toContain('U456');
      expect(result.conversations[0].participants).toContain('U789');
    });
  });

  describe('semantic analysis', () => {
    it('should skip semantic analysis for small segments', async () => {
      // Less than 3 messages
      const messages = [
        createMessage('1704067200.000000', 'U123', 'Hello'),
        createMessage('1704067260.000000', 'U456', 'Hi'),
      ];

      await hybridSegmentation(messages, [], 'C123', 'general', 'U123', [], {
        minMessagesForSemantic: 3,
      });

      // Should not trigger semantic analysis
      const { analyzeConversationBoundaries } = await import(
        '@/core/segmentation/semantic.js'
      );
      expect(analyzeConversationBoundaries).not.toHaveBeenCalled();
    });

    it('should apply semantic analysis to larger segments', async () => {
      // Create 5 messages (exceeds minMessagesForSemantic: 3)
      const messages = createMessageSequence(5, 1704067200, 60, 'U123');

      await hybridSegmentation(messages, [], 'C123', 'general', 'U123', [], {
        minMessagesForSemantic: 3,
      });

      const { analyzeConversationBoundaries } = await import(
        '@/core/segmentation/semantic.js'
      );
      expect(analyzeConversationBoundaries).toHaveBeenCalled();
    });
  });

  describe('sorting', () => {
    it('should sort conversations by start time', async () => {
      const thread1: SlackThread = {
        threadTs: '1704070800.000000', // Later
        channel: 'C123',
        messages: [createMessage('1704070800.000000', 'U123', 'Later thread')],
      };

      const thread2: SlackThread = {
        threadTs: '1704067200.000000', // Earlier
        channel: 'C123',
        messages: [createMessage('1704067200.000000', 'U123', 'Earlier thread')],
      };

      const result = await hybridSegmentation([], [thread1, thread2], 'C123', 'general', 'U123');

      expect(result.conversations).toHaveLength(2);
      // Earlier conversation should come first
      expect(result.conversations[0].startTime < result.conversations[1].startTime).toBe(true);
    });
  });

  describe('stats', () => {
    it('should report accurate statistics', async () => {
      const messages = createMessageSequence(5, 1704067200, 60, 'U123');
      const thread: SlackThread = {
        threadTs: '1704070800.000000',
        channel: 'C123',
        messages: [
          createMessage('1704070800.000000', 'U123', 'Thread start'),
          createMessage('1704070860.000000', 'U456', 'Reply'),
        ],
      };

      const result = await hybridSegmentation(messages, [thread], 'C123', 'general', 'U123');

      expect(result.stats.totalMessages).toBe(5); // Main messages only
      expect(result.stats.threadsExtracted).toBe(1);
      expect(result.stats.totalConversations).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('segmentUserActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should segment multiple channels', async () => {
    const channelMessages = new Map([
      ['C123', createMessageSequence(3, 1704067200, 60, 'U123')],
      ['C456', createMessageSequence(2, 1704067200, 60, 'U123')],
    ]);

    const channelThreads = new Map<string, SlackThread[]>();
    const channelNames = new Map([
      ['C123', 'general'],
      ['C456', 'random'],
    ]);
    const allChannelMessages = new Map<string, SlackMessage[]>();

    const results = await segmentUserActivity(
      channelMessages,
      channelThreads,
      channelNames,
      allChannelMessages,
      'U123'
    );

    expect(results.size).toBe(2);
    expect(results.has('C123')).toBe(true);
    expect(results.has('C456')).toBe(true);

    const c123Result = results.get('C123')!;
    expect(c123Result.conversations.length).toBeGreaterThan(0);
    expect(c123Result.conversations[0].channelName).toBe('general');
  });

  it('should handle empty channels', async () => {
    const channelMessages = new Map([
      ['C123', [] as SlackMessage[]],
    ]);

    const results = await segmentUserActivity(
      channelMessages,
      new Map(),
      new Map([['C123', 'empty']]),
      new Map(),
      'U123'
    );

    expect(results.get('C123')!.conversations).toHaveLength(0);
  });
});
