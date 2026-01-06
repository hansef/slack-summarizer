/**
 * Tests for the Slack client.
 *
 * The SlackClient:
 * 1. Wraps the Slack WebClient API
 * 2. Provides rate-limited access to Slack APIs
 * 3. Handles pagination for list operations
 * 4. Caches user information
 * 5. Validates responses with Zod schemas
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SlackClient, getSlackClient, resetSlackClient } from '@/core/slack/client.js';
import { DateTime } from 'luxon';

// Mock rate limiter
vi.mock('@/core/slack/rate-limiter.js', () => ({
  getRateLimiter: vi.fn(() => ({
    execute: vi.fn(<T>(fn: () => Promise<T>): Promise<T> => fn()),
  })),
}));

// Mock env
vi.mock('@/utils/env.js', () => ({
  getEnv: vi.fn(() => ({
    SLACK_USER_TOKEN: 'xoxp-test-token',
  })),
}));

// Mock WebClient
const mockAuthTest = vi.fn();
const mockUsersConversations = vi.fn();
const mockConversationsHistory = vi.fn();
const mockConversationsReplies = vi.fn();
const mockSearchMessages = vi.fn();
const mockReactionsList = vi.fn();
const mockChatGetPermalink = vi.fn();
const mockUsersInfo = vi.fn();
const mockUsersList = vi.fn();
const mockConversationsInfo = vi.fn();

vi.mock('@slack/web-api', () => ({
  WebClient: vi.fn().mockImplementation(() => ({
    auth: { test: mockAuthTest },
    users: {
      conversations: mockUsersConversations,
      info: mockUsersInfo,
      list: mockUsersList,
    },
    conversations: {
      history: mockConversationsHistory,
      replies: mockConversationsReplies,
      info: mockConversationsInfo,
    },
    search: { messages: mockSearchMessages },
    reactions: { list: mockReactionsList },
    chat: { getPermalink: mockChatGetPermalink },
  })),
}));

describe('SlackClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSlackClient();
  });

  describe('constructor', () => {
    it('should create client with default token from env', () => {
      const client = new SlackClient();
      expect(client).toBeDefined();
    });

    it('should create client with provided token', () => {
      const client = new SlackClient({ token: 'custom-token' });
      expect(client).toBeDefined();
    });
  });

  describe('authenticate', () => {
    it('should authenticate and store user id', async () => {
      mockAuthTest.mockResolvedValue({
        ok: true,
        user: 'testuser',
        user_id: 'U123',
        team: 'Test Team',
        team_id: 'T123',
        url: 'https://test.slack.com/',
      });

      const client = new SlackClient();
      const result = await client.authenticate();

      expect(result.user_id).toBe('U123');
      expect(result.user).toBe('testuser');
      expect(result.team).toBe('Test Team');
    });
  });

  describe('getCurrentUserId', () => {
    it('should return cached user id if available', async () => {
      mockAuthTest.mockResolvedValue({
        ok: true,
        user: 'testuser',
        user_id: 'U123',
        team: 'Test Team',
        team_id: 'T123',
        url: 'https://test.slack.com/',
      });

      const client = new SlackClient();
      await client.authenticate();

      // Second call should use cached value
      const userId = await client.getCurrentUserId();
      expect(userId).toBe('U123');
      expect(mockAuthTest).toHaveBeenCalledTimes(1);
    });

    it('should authenticate if no cached user id', async () => {
      mockAuthTest.mockResolvedValue({
        ok: true,
        user: 'testuser',
        user_id: 'U456',
        team: 'Test Team',
        team_id: 'T123',
        url: 'https://test.slack.com/',
      });

      const client = new SlackClient();
      const userId = await client.getCurrentUserId();

      expect(userId).toBe('U456');
      expect(mockAuthTest).toHaveBeenCalledTimes(1);
    });
  });

  describe('listChannels', () => {
    it('should list all channels with pagination', async () => {
      // First page
      mockUsersConversations.mockResolvedValueOnce({
        ok: true,
        channels: [
          { id: 'C1', name: 'general', is_private: false, is_im: false, is_mpim: false },
        ],
        response_metadata: { next_cursor: 'cursor123' },
      });

      // Second page
      mockUsersConversations.mockResolvedValueOnce({
        ok: true,
        channels: [
          { id: 'C2', name: 'random', is_private: false, is_im: false, is_mpim: false },
        ],
        response_metadata: {},
      });

      const client = new SlackClient();
      const channels = await client.listChannels();

      expect(channels).toHaveLength(2);
      expect(channels[0].id).toBe('C1');
      expect(channels[1].id).toBe('C2');
      expect(mockUsersConversations).toHaveBeenCalledTimes(2);
    });

    it('should throw on API error', async () => {
      mockUsersConversations.mockResolvedValue({
        ok: false,
        error: 'invalid_auth',
      });

      const client = new SlackClient();
      await expect(client.listChannels()).rejects.toThrow('Failed to list channels');
    });

    it('should skip invalid channel data', async () => {
      mockUsersConversations.mockResolvedValue({
        ok: true,
        channels: [
          { id: 'C1', name: 'valid', is_private: false, is_im: false, is_mpim: false },
          { invalid: 'channel' }, // Missing required fields
        ],
      });

      const client = new SlackClient();
      const channels = await client.listChannels();

      expect(channels).toHaveLength(1);
      expect(channels[0].id).toBe('C1');
    });
  });

  describe('getChannelHistory', () => {
    it('should fetch channel history for time range', async () => {
      mockConversationsHistory.mockResolvedValue({
        ok: true,
        messages: [
          { type: 'message', ts: '1704067200.000000', text: 'Hello', user: 'U123' },
        ],
      });

      const client = new SlackClient();
      const timeRange = {
        start: DateTime.fromISO('2024-01-01T00:00:00Z'),
        end: DateTime.fromISO('2024-01-01T23:59:59Z'),
      };

      const messages = await client.getChannelHistory('C123', timeRange);

      expect(messages).toHaveLength(1);
      expect(messages[0].text).toBe('Hello');
      expect(messages[0].channel).toBe('C123');
    });

    it('should handle pagination in channel history', async () => {
      mockConversationsHistory
        .mockResolvedValueOnce({
          ok: true,
          messages: [{ type: 'message', ts: '1704067200.000000', text: 'First', user: 'U123' }],
          response_metadata: { next_cursor: 'next' },
        })
        .mockResolvedValueOnce({
          ok: true,
          messages: [{ type: 'message', ts: '1704067300.000000', text: 'Second', user: 'U123' }],
        });

      const client = new SlackClient();
      const timeRange = {
        start: DateTime.fromISO('2024-01-01T00:00:00Z'),
        end: DateTime.fromISO('2024-01-01T23:59:59Z'),
      };

      const messages = await client.getChannelHistory('C123', timeRange);

      expect(messages).toHaveLength(2);
      expect(mockConversationsHistory).toHaveBeenCalledTimes(2);
    });

    it('should throw on API error', async () => {
      mockConversationsHistory.mockResolvedValue({
        ok: false,
        error: 'channel_not_found',
      });

      const client = new SlackClient();
      const timeRange = {
        start: DateTime.fromISO('2024-01-01T00:00:00Z'),
        end: DateTime.fromISO('2024-01-01T23:59:59Z'),
      };

      await expect(client.getChannelHistory('C123', timeRange)).rejects.toThrow(
        'Failed to get channel history'
      );
    });
  });

  describe('getThreadReplies', () => {
    it('should fetch thread replies', async () => {
      mockConversationsReplies.mockResolvedValue({
        ok: true,
        messages: [
          { type: 'message', ts: '1704067200.000000', text: 'Parent', user: 'U123' },
          { type: 'message', ts: '1704067260.000000', text: 'Reply', user: 'U456', thread_ts: '1704067200.000000' },
        ],
      });

      const client = new SlackClient();
      const messages = await client.getThreadReplies('C123', '1704067200.000000');

      expect(messages).toHaveLength(2);
      expect(messages[0].text).toBe('Parent');
      expect(messages[1].text).toBe('Reply');
    });

    it('should throw on API error', async () => {
      mockConversationsReplies.mockResolvedValue({
        ok: false,
        error: 'thread_not_found',
      });

      const client = new SlackClient();
      await expect(client.getThreadReplies('C123', '123.456')).rejects.toThrow(
        'Failed to get thread replies'
      );
    });
  });

  describe('searchMessages', () => {
    it('should search messages', async () => {
      mockSearchMessages.mockResolvedValue({
        ok: true,
        messages: {
          matches: [
            { ts: '1704067200.000000', text: 'Hello world', user: 'U123', channel: { id: 'C123' } },
          ],
          paging: { pages: 1, page: 1 },
        },
      });

      const client = new SlackClient();
      const messages = await client.searchMessages('hello');

      expect(messages).toHaveLength(1);
      expect(messages[0].text).toBe('Hello world');
      expect(messages[0].channel).toBe('C123');
    });

    it('should add time range to search query', async () => {
      mockSearchMessages.mockResolvedValue({
        ok: true,
        messages: { matches: [], paging: { pages: 1, page: 1 } },
      });

      const client = new SlackClient();
      const timeRange = {
        start: DateTime.fromISO('2024-01-01T00:00:00Z'),
        end: DateTime.fromISO('2024-01-02T23:59:59Z'),
      };

      await client.searchMessages('test', timeRange);

      expect(mockSearchMessages).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          query: expect.stringContaining('after:'),
        })
      );
    });

    it('should handle pagination in search', async () => {
      mockSearchMessages
        .mockResolvedValueOnce({
          ok: true,
          messages: {
            matches: [{ ts: '1.0', text: 'First', user: 'U1', channel: { id: 'C1' } }],
            paging: { pages: 2, page: 1 },
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          messages: {
            matches: [{ ts: '2.0', text: 'Second', user: 'U2', channel: { id: 'C2' } }],
            paging: { pages: 2, page: 2 },
          },
        });

      const client = new SlackClient();
      const messages = await client.searchMessages('test');

      expect(messages).toHaveLength(2);
      expect(mockSearchMessages).toHaveBeenCalledTimes(2);
    });

    it('should throw on API error', async () => {
      mockSearchMessages.mockResolvedValue({
        ok: false,
        error: 'search_failed',
      });

      const client = new SlackClient();
      await expect(client.searchMessages('test')).rejects.toThrow('Failed to search messages');
    });
  });

  describe('searchMentions', () => {
    it('should search for mentions of user', async () => {
      mockSearchMessages.mockResolvedValue({
        ok: true,
        messages: { matches: [], paging: { pages: 1 } },
      });

      const client = new SlackClient();
      const timeRange = {
        start: DateTime.fromISO('2024-01-01T00:00:00Z'),
        end: DateTime.fromISO('2024-01-01T23:59:59Z'),
      };

      await client.searchMentions('U123', timeRange);

      expect(mockSearchMessages).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          query: expect.stringContaining('<@U123>'),
        })
      );
    });
  });

  describe('searchUserMessages', () => {
    it('should search for messages from user', async () => {
      mockSearchMessages.mockResolvedValue({
        ok: true,
        messages: { matches: [], paging: { pages: 1 } },
      });

      const client = new SlackClient();
      const timeRange = {
        start: DateTime.fromISO('2024-01-01T00:00:00Z'),
        end: DateTime.fromISO('2024-01-01T23:59:59Z'),
      };

      await client.searchUserMessages('U123', timeRange);

      expect(mockSearchMessages).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          query: expect.stringContaining('from:<@U123>'),
        })
      );
    });
  });

  describe('getReactionsGiven', () => {
    it('should fetch reactions given by user', async () => {
      const msgTs = '1704067200.000000'; // Within range
      mockReactionsList.mockResolvedValue({
        ok: true,
        items: [
          {
            type: 'message',
            channel: 'C123',
            message: {
              ts: msgTs,
              reactions: [
                { name: 'thumbsup', users: ['U123'] },
                { name: 'heart', users: ['U456'] }, // Different user
              ],
            },
          },
        ],
        paging: { pages: 1 },
      });

      const client = new SlackClient();
      const timeRange = {
        start: DateTime.fromMillis(1704067000000), // Before msgTs
        end: DateTime.fromMillis(1704068000000), // After msgTs
      };

      const reactions = await client.getReactionsGiven('U123', timeRange);

      expect(reactions).toHaveLength(1);
      expect(reactions[0].reaction).toBe('thumbsup');
      expect(reactions[0].channel).toBe('C123');
    });

    it('should filter reactions outside time range', async () => {
      mockReactionsList.mockResolvedValue({
        ok: true,
        items: [
          {
            type: 'message',
            channel: 'C123',
            message: {
              ts: '1000000000.000000', // Way in the past
              reactions: [{ name: 'thumbsup', users: ['U123'] }],
            },
          },
        ],
        paging: { pages: 1 },
      });

      const client = new SlackClient();
      const timeRange = {
        start: DateTime.fromISO('2024-01-01T00:00:00Z'),
        end: DateTime.fromISO('2024-01-01T23:59:59Z'),
      };

      const reactions = await client.getReactionsGiven('U123', timeRange);

      expect(reactions).toHaveLength(0);
    });

    it('should throw on API error', async () => {
      mockReactionsList.mockResolvedValue({
        ok: false,
        error: 'not_authed',
      });

      const client = new SlackClient();
      const timeRange = {
        start: DateTime.fromISO('2024-01-01T00:00:00Z'),
        end: DateTime.fromISO('2024-01-01T23:59:59Z'),
      };

      await expect(client.getReactionsGiven('U123', timeRange)).rejects.toThrow(
        'Failed to get reactions'
      );
    });
  });

  describe('getPermalink', () => {
    it('should fetch permalink for message', async () => {
      mockChatGetPermalink.mockResolvedValue({
        ok: true,
        permalink: 'https://slack.com/archives/C123/p1704067200000000',
      });

      const client = new SlackClient();
      const link = await client.getPermalink('C123', '1704067200.000000');

      expect(link).toBe('https://slack.com/archives/C123/p1704067200000000');
    });

    it('should throw on API error', async () => {
      mockChatGetPermalink.mockResolvedValue({
        ok: false,
        error: 'message_not_found',
      });

      const client = new SlackClient();
      await expect(client.getPermalink('C123', '123.456')).rejects.toThrow(
        'Failed to get permalink'
      );
    });
  });

  describe('getMessage', () => {
    it('should fetch a single message', async () => {
      mockConversationsReplies.mockResolvedValue({
        ok: true,
        messages: [
          { type: 'message', ts: '1704067200.000000', text: 'Test message', user: 'U123' },
        ],
      });

      const client = new SlackClient();
      const message = await client.getMessage('C123', '1704067200.000000');

      expect(message).not.toBeNull();
      expect(message?.text).toBe('Test message');
      expect(message?.channel).toBe('C123');
    });

    it('should return null on API error', async () => {
      mockConversationsReplies.mockRejectedValue(new Error('API Error'));

      const client = new SlackClient();
      const message = await client.getMessage('C123', '123.456');

      expect(message).toBeNull();
    });

    it('should return null when message not found', async () => {
      mockConversationsReplies.mockResolvedValue({
        ok: true,
        messages: [],
      });

      const client = new SlackClient();
      const message = await client.getMessage('C123', '123.456');

      expect(message).toBeNull();
    });
  });

  describe('getUserInfo', () => {
    it('should fetch user info', async () => {
      mockUsersInfo.mockResolvedValue({
        ok: true,
        user: {
          id: 'U123',
          name: 'testuser',
          real_name: 'Test User',
          profile: { display_name: 'testy' },
        },
      });

      const client = new SlackClient();
      const user = await client.getUserInfo('U123');

      expect(user.id).toBe('U123');
      expect(user.name).toBe('testuser');
      expect(user.real_name).toBe('Test User');
      expect(user.display_name).toBe('testy');
    });

    it('should cache user info', async () => {
      mockUsersInfo.mockResolvedValue({
        ok: true,
        user: {
          id: 'U123',
          name: 'testuser',
          real_name: 'Test User',
        },
      });

      const client = new SlackClient();

      // First call
      await client.getUserInfo('U123');
      // Second call - should use cache
      await client.getUserInfo('U123');

      expect(mockUsersInfo).toHaveBeenCalledTimes(1);
    });

    it('should throw on API error', async () => {
      mockUsersInfo.mockResolvedValue({
        ok: false,
        error: 'user_not_found',
      });

      const client = new SlackClient();
      await expect(client.getUserInfo('U999')).rejects.toThrow('Failed to get user info');
    });
  });

  describe('getUserDisplayName', () => {
    it('should return real_name if available', async () => {
      mockUsersInfo.mockResolvedValue({
        ok: true,
        user: {
          id: 'U123',
          name: 'username',
          real_name: 'Real Name',
          profile: { display_name: 'display' },
        },
      });

      const client = new SlackClient();
      const name = await client.getUserDisplayName('U123');

      expect(name).toBe('Real Name');
    });

    it('should fall back to display_name', async () => {
      mockUsersInfo.mockResolvedValue({
        ok: true,
        user: {
          id: 'U123',
          name: 'username',
          profile: { display_name: 'Display Name' },
        },
      });

      const client = new SlackClient();
      const name = await client.getUserDisplayName('U123');

      expect(name).toBe('Display Name');
    });

    it('should fall back to username', async () => {
      mockUsersInfo.mockResolvedValue({
        ok: true,
        user: {
          id: 'U123',
          name: 'username',
        },
      });

      const client = new SlackClient();
      const name = await client.getUserDisplayName('U123');

      expect(name).toBe('username');
    });

    it('should return user id on error', async () => {
      mockUsersInfo.mockRejectedValue(new Error('API Error'));

      const client = new SlackClient();
      const name = await client.getUserDisplayName('U123');

      expect(name).toBe('U123');
    });
  });

  describe('listUsers', () => {
    it('should list all users with pagination', async () => {
      mockUsersList
        .mockResolvedValueOnce({
          ok: true,
          members: [
            { id: 'U1', name: 'user1', real_name: 'User One' },
          ],
          response_metadata: { next_cursor: 'next' },
        })
        .mockResolvedValueOnce({
          ok: true,
          members: [
            { id: 'U2', name: 'user2', real_name: 'User Two' },
          ],
        });

      const client = new SlackClient();
      const users = await client.listUsers();

      expect(users).toHaveLength(2);
      expect(users[0].name).toBe('user1');
      expect(users[1].name).toBe('user2');
    });

    it('should skip deleted users', async () => {
      mockUsersList.mockResolvedValue({
        ok: true,
        members: [
          { id: 'U1', name: 'active', real_name: 'Active User' },
          { id: 'U2', name: 'deleted', real_name: 'Deleted User', deleted: true },
        ],
      });

      const client = new SlackClient();
      const users = await client.listUsers();

      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('active');
    });

    it('should throw on API error', async () => {
      mockUsersList.mockResolvedValue({
        ok: false,
        error: 'not_authed',
      });

      const client = new SlackClient();
      await expect(client.listUsers()).rejects.toThrow('Failed to list users');
    });
  });

  describe('getChannelInfo', () => {
    it('should fetch channel info', async () => {
      mockConversationsInfo.mockResolvedValue({
        ok: true,
        channel: {
          id: 'C123',
          name: 'general',
          is_private: false,
          is_im: false,
          is_mpim: false,
        },
      });

      const client = new SlackClient();
      const channel = await client.getChannelInfo('C123');

      expect(channel.id).toBe('C123');
      expect(channel.name).toBe('general');
    });

    it('should throw on API error', async () => {
      mockConversationsInfo.mockResolvedValue({
        ok: false,
        error: 'channel_not_found',
      });

      const client = new SlackClient();
      await expect(client.getChannelInfo('C999')).rejects.toThrow('Failed to get channel info');
    });
  });

  describe('clearUserCache', () => {
    it('should clear the user cache', async () => {
      mockUsersInfo.mockResolvedValue({
        ok: true,
        user: {
          id: 'U123',
          name: 'testuser',
        },
      });

      const client = new SlackClient();

      // Populate cache
      await client.getUserInfo('U123');
      expect(mockUsersInfo).toHaveBeenCalledTimes(1);

      // Clear cache
      client.clearUserCache();

      // Should fetch again
      await client.getUserInfo('U123');
      expect(mockUsersInfo).toHaveBeenCalledTimes(2);
    });
  });
});

describe('getSlackClient singleton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSlackClient();
  });

  it('should return same instance on multiple calls', () => {
    const client1 = getSlackClient();
    const client2 = getSlackClient();
    expect(client1).toBe(client2);
  });

  it('should create new instance after reset', () => {
    const client1 = getSlackClient();
    resetSlackClient();
    const client2 = getSlackClient();
    expect(client1).not.toBe(client2);
  });
});
