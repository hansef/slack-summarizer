/**
 * Tests for the data fetcher.
 *
 * The DataFetcher:
 * 1. Orchestrates Slack data collection for a user
 * 2. Uses search-first approach to identify active channels
 * 3. Applies day-bucketed caching for historical data
 * 4. Fetches channel history with 24h lookback for context
 * 5. Extracts thread participation from search and history
 * 6. Fetches mentions and reactions with caching
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataFetcher, createDataFetcher } from '@/core/slack/fetcher.js';
import { DateTime } from 'luxon';

// Mock the Slack client
const mockSearchUserMessages = vi.fn();
const mockGetChannelHistory = vi.fn();
const mockGetThreadReplies = vi.fn();
const mockSearchMentions = vi.fn();
const mockGetReactionsGiven = vi.fn();
const mockListChannels = vi.fn();
const mockGetCurrentUserId = vi.fn();

vi.mock('@/core/slack/client.js', () => ({
  getSlackClient: vi.fn(() => ({
    searchUserMessages: mockSearchUserMessages,
    getChannelHistory: mockGetChannelHistory,
    getThreadReplies: mockGetThreadReplies,
    searchMentions: mockSearchMentions,
    getReactionsGiven: mockGetReactionsGiven,
    listChannels: mockListChannels,
    getCurrentUserId: mockGetCurrentUserId,
  })),
}));

// Mock cache functions
const mockIsDayFetched = vi.fn().mockReturnValue(false);
const mockMarkDayFetched = vi.fn();
const mockCacheMessages = vi.fn();
const mockGetCachedMessages = vi.fn().mockReturnValue([]);
const mockCacheMentions = vi.fn();
const mockGetCachedMentions = vi.fn().mockReturnValue([]);
const mockCacheReactions = vi.fn();
const mockGetCachedReactions = vi.fn().mockReturnValue([]);
const mockCacheChannel = vi.fn();
const mockGetCachedChannels = vi.fn().mockReturnValue([]);

vi.mock('@/core/cache/messages.js', () => ({
  isDayFetched: (...args: unknown[]): boolean => mockIsDayFetched(...args) as boolean,
  markDayFetched: (...args: unknown[]): void => mockMarkDayFetched(...args) as void,
  cacheMessages: (...args: unknown[]): void => mockCacheMessages(...args) as void,
  getCachedMessages: (...args: unknown[]): unknown[] => mockGetCachedMessages(...args) as unknown[],
  cacheMentions: (...args: unknown[]): void => mockCacheMentions(...args) as void,
  getCachedMentions: (...args: unknown[]): unknown[] => mockGetCachedMentions(...args) as unknown[],
  cacheReactions: (...args: unknown[]): void => mockCacheReactions(...args) as void,
  getCachedReactions: (...args: unknown[]): unknown[] => mockGetCachedReactions(...args) as unknown[],
  cacheChannel: (...args: unknown[]): void => mockCacheChannel(...args) as void,
  getCachedChannels: (): unknown[] => mockGetCachedChannels() as unknown[],
}));

// Mock env
vi.mock('@/utils/env.js', () => ({
  getEnv: vi.fn(() => ({
    SLACK_SUMMARIZER_SLACK_CONCURRENCY: 2,
    SLACK_SUMMARIZER_TIMEZONE: 'America/Los_Angeles',
  })),
}));

// Mock concurrency - just execute sequentially
vi.mock('@/utils/concurrency.js', () => ({
  mapWithConcurrency: vi.fn(
    async <T, R>(items: T[], fn: (item: T, index: number) => Promise<R>): Promise<R[]> => {
      const results: R[] = [];
      for (let i = 0; i < items.length; i++) {
        results.push(await fn(items[i], i));
      }
      return results;
    }
  ),
}));

describe('DataFetcher', () => {
  // Use Pacific time zone to match the mock env config
  const timeRange = {
    start: DateTime.fromISO('2024-01-02T08:00:00', { zone: 'America/Los_Angeles' }),
    end: DateTime.fromISO('2024-01-02T17:00:00', { zone: 'America/Los_Angeles' }),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock setup
    mockGetCurrentUserId.mockResolvedValue('U123');
    mockSearchUserMessages.mockResolvedValue([]);
    mockGetChannelHistory.mockResolvedValue([]);
    mockGetThreadReplies.mockResolvedValue([]);
    mockSearchMentions.mockResolvedValue([]);
    mockGetReactionsGiven.mockResolvedValue([]);
    mockListChannels.mockResolvedValue([]);
    mockIsDayFetched.mockReturnValue(false);
    mockGetCachedChannels.mockReturnValue([]);
  });

  describe('constructor', () => {
    it('should create fetcher with defaults', () => {
      const fetcher = new DataFetcher();
      expect(fetcher).toBeDefined();
    });

    it('should accept skipCache option', () => {
      const fetcher = new DataFetcher({ skipCache: true });
      expect(fetcher).toBeDefined();
    });
  });

  describe('fetchUserActivity', () => {
    it('should use current user if no userId provided', async () => {
      mockGetCurrentUserId.mockResolvedValue('U123');

      const fetcher = new DataFetcher();
      const result = await fetcher.fetchUserActivity(null, timeRange);

      expect(result.userId).toBe('U123');
      expect(mockGetCurrentUserId).toHaveBeenCalled();
    });

    it('should use provided userId', async () => {
      const fetcher = new DataFetcher();
      const result = await fetcher.fetchUserActivity('U456', timeRange);

      expect(result.userId).toBe('U456');
      expect(mockGetCurrentUserId).not.toHaveBeenCalled();
    });

    it('should return activity data with correct time range', async () => {
      const fetcher = new DataFetcher();
      const result = await fetcher.fetchUserActivity('U123', timeRange);

      // Should contain the date (timezone-agnostic check)
      expect(result.timeRange.start).toMatch(/2024-01-02/);
      expect(result.timeRange.end).toMatch(/2024-01-02/);
    });

    it('should identify active channels from search', async () => {
      mockSearchUserMessages.mockResolvedValue([
        { ts: '1704067200.000000', text: 'Hello', channel: 'C123', user: 'U123' },
      ]);
      mockListChannels.mockResolvedValue([
        { id: 'C123', name: 'general', is_private: false, is_im: false, is_mpim: false },
        { id: 'C456', name: 'random', is_private: false, is_im: false, is_mpim: false },
      ]);

      const fetcher = new DataFetcher();
      const result = await fetcher.fetchUserActivity('U123', timeRange);

      // Should only include channel C123 since that's where user was active
      expect(result.channels).toHaveLength(1);
      expect(result.channels[0].id).toBe('C123');
    });

    it('should fetch channel history for active channels', async () => {
      mockSearchUserMessages.mockResolvedValue([
        { ts: '1704067200.000000', text: 'Hello', channel: 'C123', user: 'U123' },
      ]);
      mockListChannels.mockResolvedValue([
        { id: 'C123', name: 'general', is_private: false, is_im: false, is_mpim: false },
      ]);
      // Return messages only on first call (for the one day bucket)
      mockGetChannelHistory.mockResolvedValueOnce([
        { type: 'message', ts: '1704067200.000000', text: 'Hello', channel: 'C123', user: 'U123' },
        { type: 'message', ts: '1704067260.000000', text: 'Hi', channel: 'C123', user: 'U456' },
      ]);
      // Return empty for subsequent calls (other day buckets from 24h lookback)
      mockGetChannelHistory.mockResolvedValue([]);

      const fetcher = new DataFetcher();
      const result = await fetcher.fetchUserActivity('U123', timeRange);

      expect(mockGetChannelHistory).toHaveBeenCalled();
      expect(result.allChannelMessages).toHaveLength(2);
    });

    it('should separate user messages from all messages', async () => {
      // Use timestamps within the timeRange (Jan 2, 2024 Pacific)
      const msgTs = (timeRange.start.plus({ hours: 1 }).toMillis() / 1000).toFixed(6);
      const otherTs = (timeRange.start.plus({ hours: 2 }).toMillis() / 1000).toFixed(6);

      mockSearchUserMessages.mockResolvedValue([
        { ts: msgTs, text: 'Hello', channel: 'C123', user: 'U123' },
      ]);
      mockListChannels.mockResolvedValue([
        { id: 'C123', name: 'general', is_private: false, is_im: false, is_mpim: false },
      ]);
      mockGetChannelHistory.mockResolvedValueOnce([
        { type: 'message', ts: msgTs, text: 'My message', channel: 'C123', user: 'U123' },
        { type: 'message', ts: otherTs, text: 'Other message', channel: 'C123', user: 'U456' },
      ]);
      mockGetChannelHistory.mockResolvedValue([]);

      const fetcher = new DataFetcher();
      const result = await fetcher.fetchUserActivity('U123', timeRange);

      expect(result.messagesSent).toHaveLength(1);
      expect(result.messagesSent[0].text).toBe('My message');
      expect(result.allChannelMessages).toHaveLength(2);
    });

    it('should identify threads from search results', async () => {
      // Use timestamps within the timeRange
      const parentTs = (timeRange.start.plus({ hours: 1 }).toMillis() / 1000).toFixed(6);
      const replyTs = (timeRange.start.plus({ hours: 2 }).toMillis() / 1000).toFixed(6);

      mockSearchUserMessages.mockResolvedValue([
        { ts: replyTs, text: 'Reply', channel: 'C123', user: 'U123', thread_ts: parentTs },
      ]);
      mockListChannels.mockResolvedValue([
        { id: 'C123', name: 'general', is_private: false, is_im: false, is_mpim: false },
      ]);
      mockGetChannelHistory.mockResolvedValue([]);
      mockGetThreadReplies.mockResolvedValue([
        { type: 'message', ts: parentTs, text: 'Parent', channel: 'C123', user: 'U456' },
        { type: 'message', ts: replyTs, text: 'Reply', channel: 'C123', user: 'U123', thread_ts: parentTs },
      ]);

      const fetcher = new DataFetcher();
      const result = await fetcher.fetchUserActivity('U123', timeRange);

      expect(mockGetThreadReplies).toHaveBeenCalledWith('C123', parentTs);
      expect(result.threadsParticipated).toHaveLength(1);
    });

    it('should fetch mentions', async () => {
      mockSearchMentions.mockResolvedValue([
        { ts: '1704067200.000000', text: '<@U123> check this', channel: 'C123', user: 'U456' },
      ]);

      const fetcher = new DataFetcher();
      const result = await fetcher.fetchUserActivity('U123', timeRange);

      expect(mockSearchMentions).toHaveBeenCalled();
      expect(result.mentionsReceived).toHaveLength(1);
    });

    it('should fetch reactions', async () => {
      mockGetReactionsGiven.mockResolvedValue([
        { messageId: '1704067200.000000', channel: 'C123', reaction: 'thumbsup', timestamp: '1704067200.000000' },
      ]);

      const fetcher = new DataFetcher();
      const result = await fetcher.fetchUserActivity('U123', timeRange);

      expect(mockGetReactionsGiven).toHaveBeenCalled();
      expect(result.reactionsGiven).toHaveLength(1);
    });

    it('should fall back to all channels if search fails', async () => {
      mockSearchUserMessages.mockRejectedValue(new Error('Search API failed'));
      mockListChannels.mockResolvedValue([
        { id: 'C123', name: 'general', is_private: false, is_im: false, is_mpim: false },
        { id: 'C456', name: 'random', is_private: false, is_im: false, is_mpim: false },
      ]);
      mockGetChannelHistory.mockResolvedValue([]);

      const fetcher = new DataFetcher();
      const result = await fetcher.fetchUserActivity('U123', timeRange);

      // Should fall back to all channels
      expect(result.channels).toHaveLength(2);
    });

    it('should return empty channels when no user activity found', async () => {
      mockSearchUserMessages.mockResolvedValue([]);

      const fetcher = new DataFetcher();
      const result = await fetcher.fetchUserActivity('U123', timeRange);

      expect(result.channels).toHaveLength(0);
      expect(result.messagesSent).toHaveLength(0);
    });
  });

  describe('caching', () => {
    it('should use cached channels when available', async () => {
      mockGetCachedChannels.mockReturnValue([
        { id: 'C123', name: 'cached', is_private: false, is_im: false, is_mpim: false },
      ]);
      mockSearchUserMessages.mockResolvedValue([
        { ts: '1704067200.000000', text: 'Hello', channel: 'C123', user: 'U123' },
      ]);
      mockGetChannelHistory.mockResolvedValue([]);

      const fetcher = new DataFetcher();
      await fetcher.fetchUserActivity('U123', timeRange);

      expect(mockListChannels).not.toHaveBeenCalled();
    });

    it('should use cached messages when day is fetched', async () => {
      const cachedTs = (timeRange.start.plus({ hours: 1 }).toMillis() / 1000).toFixed(6);

      mockSearchUserMessages.mockResolvedValue([
        { ts: cachedTs, text: 'Hello', channel: 'C123', user: 'U123' },
      ]);
      mockListChannels.mockResolvedValue([
        { id: 'C123', name: 'general', is_private: false, is_im: false, is_mpim: false },
      ]);
      // All days are cached
      mockIsDayFetched.mockReturnValue(true);
      mockGetCachedMessages.mockReturnValue([
        { type: 'message', ts: cachedTs, text: 'Cached', channel: 'C123', user: 'U123' },
      ]);

      const fetcher = new DataFetcher();
      const result = await fetcher.fetchUserActivity('U123', timeRange);

      expect(mockGetChannelHistory).not.toHaveBeenCalled();
      // There are 2 day buckets (24h lookback + current day), each returns 1 cached message
      expect(result.allChannelMessages!.length).toBeGreaterThanOrEqual(1);
      expect(result.allChannelMessages![0].text).toBe('Cached');
    });

    it('should skip cache when skipCache option is true', async () => {
      mockSearchUserMessages.mockResolvedValue([
        { ts: '1704067200.000000', text: 'Hello', channel: 'C123', user: 'U123' },
      ]);
      mockListChannels.mockResolvedValue([
        { id: 'C123', name: 'general', is_private: false, is_im: false, is_mpim: false },
      ]);
      mockIsDayFetched.mockReturnValue(true);
      mockGetChannelHistory.mockResolvedValue([
        { type: 'message', ts: '1704067200.000000', text: 'Fresh', channel: 'C123', user: 'U123' },
      ]);

      const fetcher = new DataFetcher({ skipCache: true });
      const result = await fetcher.fetchUserActivity('U123', timeRange);

      expect(mockGetChannelHistory).toHaveBeenCalled();
      expect(result.allChannelMessages![0].text).toBe('Fresh');
    });

    it('should cache fetched messages', async () => {
      mockSearchUserMessages.mockResolvedValue([
        { ts: '1704067200.000000', text: 'Hello', channel: 'C123', user: 'U123' },
      ]);
      mockListChannels.mockResolvedValue([
        { id: 'C123', name: 'general', is_private: false, is_im: false, is_mpim: false },
      ]);
      mockGetChannelHistory.mockResolvedValue([
        { type: 'message', ts: '1704067200.000000', text: 'Hello', channel: 'C123', user: 'U123' },
      ]);

      const fetcher = new DataFetcher();
      await fetcher.fetchUserActivity('U123', timeRange);

      expect(mockCacheMessages).toHaveBeenCalled();
      expect(mockMarkDayFetched).toHaveBeenCalled();
    });

    it('should use cached mentions when all days are fetched', async () => {
      mockSearchUserMessages.mockResolvedValue([]);
      mockIsDayFetched.mockImplementation(
        (_userId: string, _channelId: string, _dayBucket: string, dataType: string) => {
          return dataType === 'mentions';
        }
      );
      mockGetCachedMentions.mockReturnValue([
        { ts: '1704067200.000000', text: 'Cached mention', channel: 'C123', user: 'U456' },
      ]);

      const fetcher = new DataFetcher();
      const result = await fetcher.fetchUserActivity('U123', timeRange);

      expect(mockSearchMentions).not.toHaveBeenCalled();
      expect(result.mentionsReceived).toHaveLength(1);
    });

    it('should use cached reactions when all days are fetched', async () => {
      mockSearchUserMessages.mockResolvedValue([]);
      mockIsDayFetched.mockImplementation(
        (_userId: string, _channelId: string, _dayBucket: string, dataType: string) => {
          return dataType === 'reactions';
        }
      );
      mockGetCachedReactions.mockReturnValue([
        { messageId: '1704067200.000000', channel: 'C123', reaction: 'cached', timestamp: '1704067200.000000' },
      ]);

      const fetcher = new DataFetcher();
      const result = await fetcher.fetchUserActivity('U123', timeRange);

      expect(mockGetReactionsGiven).not.toHaveBeenCalled();
      expect(result.reactionsGiven).toHaveLength(1);
    });
  });

  describe('time range handling', () => {
    it('should filter messages to original time range (not 24h lookback)', async () => {
      // Message in the original time range
      const newTs = (timeRange.start.plus({ hours: 2 }).toMillis() / 1000).toFixed(6);

      mockSearchUserMessages.mockResolvedValue([
        { ts: newTs, text: 'Hello', channel: 'C123', user: 'U123' },
      ]);
      mockListChannels.mockResolvedValue([
        { id: 'C123', name: 'general', is_private: false, is_im: false, is_mpim: false },
      ]);

      // Message before the original time range (in the 24h lookback)
      const oldTs = (timeRange.start.minus({ hours: 12 }).toMillis() / 1000).toFixed(6);

      // First day bucket (from 24h lookback - previous day) - has old message
      mockGetChannelHistory.mockResolvedValueOnce([
        { type: 'message', ts: oldTs, text: 'Old context', channel: 'C123', user: 'U123' },
      ]);
      // Second day bucket (current day) - has new message
      mockGetChannelHistory.mockResolvedValueOnce([
        { type: 'message', ts: newTs, text: 'New message', channel: 'C123', user: 'U123' },
      ]);
      mockGetChannelHistory.mockResolvedValue([]);

      const fetcher = new DataFetcher();
      const result = await fetcher.fetchUserActivity('U123', timeRange);

      // messagesSent should only include messages in original range
      expect(result.messagesSent).toHaveLength(1);
      expect(result.messagesSent[0].text).toBe('New message');

      // allChannelMessages includes everything (for context)
      expect(result.allChannelMessages).toHaveLength(2);
    });

    it('should filter thread messages to original time range', async () => {
      // Thread ts within range
      const threadTs = (timeRange.start.plus({ hours: 1 }).toMillis() / 1000).toFixed(6);
      const newTs = (timeRange.start.plus({ hours: 2 }).toMillis() / 1000).toFixed(6);
      const oldTs = (timeRange.start.minus({ days: 1 }).toMillis() / 1000).toFixed(6);

      mockSearchUserMessages.mockResolvedValue([
        { ts: newTs, text: 'Reply', channel: 'C123', user: 'U123', thread_ts: threadTs },
      ]);
      mockListChannels.mockResolvedValue([
        { id: 'C123', name: 'general', is_private: false, is_im: false, is_mpim: false },
      ]);
      mockGetChannelHistory.mockResolvedValue([]);

      // Thread messages - one in range, one out
      mockGetThreadReplies.mockResolvedValue([
        { type: 'message', ts: oldTs, text: 'Old reply', channel: 'C123', user: 'U123' },
        { type: 'message', ts: newTs, text: 'New reply', channel: 'C123', user: 'U123' },
      ]);

      const fetcher = new DataFetcher();
      const result = await fetcher.fetchUserActivity('U123', timeRange);

      // Thread should only have the message in range
      expect(result.threadsParticipated).toHaveLength(1);
      expect(result.threadsParticipated[0].messages).toHaveLength(1);
      expect(result.threadsParticipated[0].messages[0].text).toBe('New reply');
    });

    it('should exclude threads with no messages in time range', async () => {
      const threadTs = (timeRange.start.plus({ hours: 1 }).toMillis() / 1000).toFixed(6);
      const oldTs = (timeRange.start.minus({ days: 1 }).toMillis() / 1000).toFixed(6);

      mockSearchUserMessages.mockResolvedValue([
        { ts: threadTs, text: 'Reply', channel: 'C123', user: 'U123', thread_ts: threadTs },
      ]);
      mockListChannels.mockResolvedValue([
        { id: 'C123', name: 'general', is_private: false, is_im: false, is_mpim: false },
      ]);
      mockGetChannelHistory.mockResolvedValue([]);

      // All thread messages are outside the time range
      mockGetThreadReplies.mockResolvedValue([
        { type: 'message', ts: oldTs, text: 'Old reply', channel: 'C123', user: 'U123' },
      ]);

      const fetcher = new DataFetcher();
      const result = await fetcher.fetchUserActivity('U123', timeRange);

      // Thread should be excluded entirely
      expect(result.threadsParticipated).toHaveLength(0);
    });
  });
});

describe('createDataFetcher', () => {
  it('should create a new DataFetcher instance', () => {
    const fetcher = createDataFetcher();
    expect(fetcher).toBeInstanceOf(DataFetcher);
  });

  it('should pass options to DataFetcher', () => {
    const fetcher = createDataFetcher({ skipCache: true });
    expect(fetcher).toBeDefined();
  });
});
