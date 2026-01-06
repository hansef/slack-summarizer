import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync, mkdirSync } from 'fs';
import { DateTime } from 'luxon';
import {
  cacheMessages,
  getCachedMessages,
  getCachedMessagesByUser,
  isDayFetched,
  markDayFetched,
  cacheMentions,
  getCachedMentions,
  cacheReactions,
  getCachedReactions,
  cacheChannel,
  getCachedChannel,
  clearCache,
  getCacheStats,
} from '@/core/cache/messages.js';
import { resetDatabase } from '@/core/cache/db.js';
import { resetEnvCache } from '@/utils/env.js';
import type { SlackMessage, SlackChannel, SlackReactionItem } from '@/core/models/slack.js';

const TEST_DB_PATH = './test-cache/test.db';

describe('Cache Messages', () => {
  beforeEach(() => {
    resetEnvCache();
    resetDatabase();

    // Set up test environment
    process.env.SLACK_USER_TOKEN = 'xoxp-test-token';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    process.env.SLACK_SUMMARIZER_DB_PATH = TEST_DB_PATH;
    process.env.SLACK_SUMMARIZER_TIMEZONE = 'America/Los_Angeles';

    // Ensure test directory exists
    if (!existsSync('./test-cache')) {
      mkdirSync('./test-cache', { recursive: true });
    }
  });

  afterEach(() => {
    resetDatabase();
    resetEnvCache();

    // Clean up test database
    if (existsSync(TEST_DB_PATH)) {
      try {
        unlinkSync(TEST_DB_PATH);
      } catch {
        // Ignore errors
      }
    }
  });

  describe('cacheMessages / getCachedMessages', () => {
    it('should cache and retrieve messages', () => {
      const messages: SlackMessage[] = [
        {
          ts: '1704067200.000000', // 2024-01-01 00:00:00 UTC
          user: 'U123',
          text: 'Hello',
          channel: 'C123',
          type: 'message',
        },
        {
          ts: '1704070800.000000', // 2024-01-01 01:00:00 UTC
          user: 'U456',
          text: 'World',
          channel: 'C123',
          type: 'message',
        },
      ];

      cacheMessages('C123', messages);

      const timeRange = {
        start: DateTime.fromMillis(1704067200000),
        end: DateTime.fromMillis(1704153600000),
      };

      const cached = getCachedMessages('C123', timeRange);
      expect(cached).toHaveLength(2);
      expect(cached[0].text).toBe('Hello');
      expect(cached[1].text).toBe('World');
    });

    it('should filter messages by time range', () => {
      const messages: SlackMessage[] = [
        {
          ts: '1704067200.000000', // Day 1
          user: 'U123',
          text: 'Day 1',
          channel: 'C123',
          type: 'message',
        },
        {
          ts: '1704153600.000000', // Day 2
          user: 'U123',
          text: 'Day 2',
          channel: 'C123',
          type: 'message',
        },
      ];

      cacheMessages('C123', messages);

      // Only get Day 1
      const timeRange = {
        start: DateTime.fromMillis(1704067200000),
        end: DateTime.fromMillis(1704100000000),
      };

      const cached = getCachedMessages('C123', timeRange);
      expect(cached).toHaveLength(1);
      expect(cached[0].text).toBe('Day 1');
    });
  });

  describe('getCachedMessagesByUser', () => {
    it('should filter messages by user', () => {
      const messages: SlackMessage[] = [
        { ts: '1704067200.000000', user: 'U123', text: 'From U123', channel: 'C123', type: 'message' },
        { ts: '1704070800.000000', user: 'U456', text: 'From U456', channel: 'C123', type: 'message' },
        { ts: '1704074400.000000', user: 'U123', text: 'Also from U123', channel: 'C123', type: 'message' },
      ];

      cacheMessages('C123', messages);

      const timeRange = {
        start: DateTime.fromMillis(1704067200000),
        end: DateTime.fromMillis(1704153600000),
      };

      const cached = getCachedMessagesByUser('U123', 'C123', timeRange);
      expect(cached).toHaveLength(2);
      expect(cached[0].text).toBe('From U123');
      expect(cached[1].text).toBe('Also from U123');
    });
  });

  describe('isDayFetched / markDayFetched', () => {
    it('should track fetched days', () => {
      const userId = 'U123';
      const channelId = 'C123';
      const dayBucket = '2024-01-01';

      expect(isDayFetched(userId, channelId, dayBucket, 'messages')).toBe(false);

      markDayFetched(userId, channelId, dayBucket, 'messages');

      expect(isDayFetched(userId, channelId, dayBucket, 'messages')).toBe(true);
      // Different data type should still be unfetched
      expect(isDayFetched(userId, channelId, dayBucket, 'mentions')).toBe(false);
    });
  });

  describe('cacheMentions / getCachedMentions', () => {
    it('should cache and retrieve mentions', () => {
      const mentions: SlackMessage[] = [
        { ts: '1704067200.000000', user: 'U456', text: '<@U123> hello', channel: 'C123', type: 'message' },
      ];

      cacheMentions('U123', mentions);

      const timeRange = {
        start: DateTime.fromMillis(1704067200000),
        end: DateTime.fromMillis(1704153600000),
      };

      const cached = getCachedMentions('U123', timeRange);
      expect(cached).toHaveLength(1);
      expect(cached[0].text).toContain('@U123');
    });
  });

  describe('cacheReactions / getCachedReactions', () => {
    it('should cache and retrieve reactions', () => {
      const reactions: SlackReactionItem[] = [
        { messageId: '1704067200.000000', channel: 'C123', reaction: 'thumbsup', timestamp: '1704067200.000000' },
        { messageId: '1704070800.000000', channel: 'C123', reaction: 'heart', timestamp: '1704070800.000000' },
      ];

      cacheReactions('U123', reactions);

      const timeRange = {
        start: DateTime.fromMillis(1704067200000),
        end: DateTime.fromMillis(1704153600000),
      };

      const cached = getCachedReactions('U123', timeRange);
      expect(cached).toHaveLength(2);
      expect(cached[0].reaction).toBe('thumbsup');
    });
  });

  describe('cacheChannel / getCachedChannel', () => {
    it('should cache and retrieve channel', () => {
      const channel: SlackChannel = {
        id: 'C123',
        name: 'general',
        is_channel: true,
        is_private: false,
        num_members: 50,
      };

      cacheChannel(channel);

      const cached = getCachedChannel('C123');
      expect(cached).not.toBeNull();
      expect(cached?.name).toBe('general');
      expect(cached?.num_members).toBe(50);
    });

    it('should return null for non-existent channel', () => {
      const cached = getCachedChannel('NONEXISTENT');
      expect(cached).toBeNull();
    });
  });

  describe('clearCache', () => {
    it('should clear all cached data', () => {
      const messages: SlackMessage[] = [
        { ts: '1704067200.000000', user: 'U123', text: 'Test', channel: 'C123', type: 'message' },
      ];
      cacheMessages('C123', messages);

      const channel: SlackChannel = { id: 'C123', name: 'test' };
      cacheChannel(channel);

      clearCache();

      const stats = getCacheStats();
      expect(stats.messages).toBe(0);
      expect(stats.channels).toBe(0);
    });
  });

  describe('getCacheStats', () => {
    it('should return correct statistics', () => {
      const messages: SlackMessage[] = [
        { ts: '1704067200.000000', user: 'U123', text: 'Test', channel: 'C123', type: 'message' },
        { ts: '1704070800.000000', user: 'U123', text: 'Test2', channel: 'C123', type: 'message' },
      ];
      cacheMessages('C123', messages);

      const channel: SlackChannel = { id: 'C123', name: 'test' };
      cacheChannel(channel);

      const stats = getCacheStats();
      expect(stats.messages).toBe(2);
      expect(stats.channels).toBe(1);
    });
  });
});
