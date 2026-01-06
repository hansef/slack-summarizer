/**
 * Tests for MCP tool handlers.
 *
 * Tests verify:
 * - Input validation with Zod schemas
 * - Successful tool execution paths
 * - Error handling and error responses
 * - Unknown tool handling (returns null)
 * - Output formatting (JSON, condensed)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleHighLevelTool } from '@/mcp/tools/high-level.js';
import { handlePrimitiveTool } from '@/mcp/tools/primitives.js';

// Mock dependencies
vi.mock('@/core/summarization/aggregator.js', () => ({
  createSummaryAggregator: vi.fn(() => ({
    generateSummary: vi.fn().mockResolvedValue({
      time_range: {
        start: '2024-01-01T00:00:00Z',
        end: '2024-01-01T23:59:59Z',
      },
      user_id: 'U123',
      channels: [
        {
          channel_id: 'C123',
          channel_name: 'general',
          channel_type: 'channel',
          interactions: { messages_sent: 5, mentions_received: 2 },
          topics: [
            {
              narrative_summary: 'Discussed project plans',
              start_time: '2024-01-01T10:00:00Z',
              end_time: '2024-01-01T10:30:00Z',
              message_count: 5,
              user_messages: 3,
              participants: ['@alice'],
              key_events: ['Started planning', 'Assigned tasks', 'Set deadline', 'Extra event'],
              references: ['PROJ-123'],
              outcome: 'Plan created',
              next_actions: ['Review plan'],
              timesheet_entry: 'Project planning',
              slack_link: 'https://slack.com/archives/C123/p1704067200',
              slack_links: ['https://slack.com/archives/C123/p1704067200'],
              segments_merged: 2,
            },
          ],
          consolidation_stats: { original: 3, final: 1 },
        },
      ],
    }),
  })),
}));

vi.mock('@/cli/formatters/markdown.js', () => ({
  formatSummaryAsMarkdown: vi.fn(() => '# Summary\n\nMarkdown content here'),
}));

vi.mock('@/core/slack/client.js', () => {
  const mockClient = {
    searchMessages: vi.fn().mockResolvedValue([
      { channel: 'C123', user: 'U456', ts: '1704067200.000000', text: 'Hello world' },
    ]),
    getChannelHistory: vi.fn().mockResolvedValue([
      { ts: '1704067200.000000', user: 'U456', text: 'Hello', thread_ts: undefined, reply_count: 0 },
    ]),
    getThreadReplies: vi.fn().mockResolvedValue([
      { ts: '1704067200.000000', user: 'U456', text: 'Thread message' },
    ]),
    getReactionsGiven: vi.fn().mockResolvedValue([
      { channel: 'C123', messageId: '1704067200.000000', reaction: 'thumbsup', timestamp: '2024-01-01' },
    ]),
    listChannels: vi.fn().mockResolvedValue([
      { id: 'C123', name: 'general', is_private: false, is_im: false, is_mpim: false, num_members: 50 },
    ]),
    getCurrentUserId: vi.fn().mockResolvedValue('U123'),
    getUserInfo: vi.fn().mockResolvedValue({
      id: 'U456',
      name: 'testuser',
      real_name: 'Test User',
    }),
  };
  return {
    getSlackClient: vi.fn(() => mockClient),
    SlackClient: vi.fn(() => mockClient),
  };
});

describe('handleHighLevelTool', () => {
  describe('slack_get_user_summary', () => {
    it('should return null for unknown tools', async () => {
      const result = await handleHighLevelTool('unknown_tool', {});
      expect(result).toBeNull();
    });

    it('should handle valid input and return summary', async () => {
      const result = await handleHighLevelTool('slack_get_user_summary', {
        timespan: 'today',
      });

      expect(result).not.toBeNull();
      expect(result?.content).toHaveLength(1);
      expect(result?.content[0].type).toBe('text');
      // Default format is markdown
      const text = (result?.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('# Summary');
    });

    it('should return JSON when output_format is json', async () => {
      const result = await handleHighLevelTool('slack_get_user_summary', {
        timespan: 'today',
        output_format: 'json',
      });

      expect(result).not.toBeNull();
      const text = (result!.content[0] as { type: 'text'; text: string }).text;
      const parsed = JSON.parse(text) as { channels: unknown[] };
      expect(parsed.channels).toBeDefined();
    });

    it('should condense summary by default', async () => {
      const result = await handleHighLevelTool('slack_get_user_summary', {
        timespan: 'today',
        output_format: 'json',
        format: 'condensed',
      });

      expect(result).not.toBeNull();
      const text = (result!.content[0] as { type: 'text'; text: string }).text;
      const parsed = JSON.parse(text) as {
        channels: Array<{
          topics: Array<{ key_events: string[]; segments_merged?: number }>;
          consolidation_stats?: unknown;
        }>;
      };
      // Condensed format limits key_events to 3
      expect(parsed.channels[0].topics[0].key_events.length).toBeLessThanOrEqual(3);
      // Condensed format removes segments_merged
      expect(parsed.channels[0].topics[0].segments_merged).toBeUndefined();
      // Condensed format removes consolidation_stats
      expect(parsed.channels[0].consolidation_stats).toBeUndefined();
    });

    it('should include all fields when format is full', async () => {
      const result = await handleHighLevelTool('slack_get_user_summary', {
        timespan: 'today',
        output_format: 'json',
        format: 'full',
      });

      expect(result).not.toBeNull();
      const text = (result!.content[0] as { type: 'text'; text: string }).text;
      const parsed = JSON.parse(text) as {
        channels: Array<{ topics: Array<{ key_events: string[]; segments_merged: number }> }>;
      };
      // Full format includes segments_merged
      expect(parsed.channels[0].topics[0].segments_merged).toBe(2);
      // Full format includes all key_events
      expect(parsed.channels[0].topics[0].key_events.length).toBe(4);
    });

    it('should return error for invalid input', async () => {
      const result = await handleHighLevelTool('slack_get_user_summary', {
        // Missing required 'timespan'
      });

      expect(result).not.toBeNull();
      expect(result?.isError).toBe(true);
      const text = (result?.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Invalid input');
    });

    it('should accept optional user_id parameter', async () => {
      const result = await handleHighLevelTool('slack_get_user_summary', {
        timespan: 'yesterday',
        user_id: 'U789',
      });

      expect(result).not.toBeNull();
      expect(result?.isError).toBeUndefined();
    });

    it('should accept model parameter', async () => {
      const result = await handleHighLevelTool('slack_get_user_summary', {
        timespan: 'last-week',
        model: 'sonnet',
      });

      expect(result).not.toBeNull();
      expect(result?.isError).toBeUndefined();
    });
  });
});

describe('handlePrimitiveTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('unknown tools', () => {
    it('should return null for unknown tools', async () => {
      const result = await handlePrimitiveTool('unknown_tool', {});
      expect(result).toBeNull();
    });
  });

  describe('slack_search_messages', () => {
    it('should search and return messages', async () => {
      const result = await handlePrimitiveTool('slack_search_messages', {
        query: 'hello',
      });

      expect(result).not.toBeNull();
      const text = (result!.content[0] as { type: 'text'; text: string }).text;
      const parsed = JSON.parse(text) as Array<{
        channel: string;
        text: string;
        user: { id: string; name: string };
      }>;
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].channel).toBe('C123');
      expect(parsed[0].text).toBe('Hello world');
      // User should be resolved to an object with id and name
      expect(parsed[0].user.id).toBe('U456');
      expect(parsed[0].user.name).toBe('Test User');
    });

    it('should handle date range filtering', async () => {
      const result = await handlePrimitiveTool('slack_search_messages', {
        query: 'test',
        from_date: '2024-01-01',
        to_date: '2024-01-02',
      });

      expect(result).not.toBeNull();
      expect(result?.isError).toBeUndefined();
    });

    it('should return error for missing query', async () => {
      const result = await handlePrimitiveTool('slack_search_messages', {});

      expect(result).not.toBeNull();
      expect(result?.isError).toBe(true);
      const text = (result?.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Invalid input');
    });
  });

  describe('slack_get_channel_history', () => {
    it('should get channel history', async () => {
      const result = await handlePrimitiveTool('slack_get_channel_history', {
        channel_id: 'C123',
      });

      expect(result).not.toBeNull();
      const text = (result!.content[0] as { type: 'text'; text: string }).text;
      const parsed = JSON.parse(text) as Array<{ text: string }>;
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].text).toBe('Hello');
    });

    it('should accept timespan parameter', async () => {
      const result = await handlePrimitiveTool('slack_get_channel_history', {
        channel_id: 'C123',
        timespan: 'yesterday',
      });

      expect(result).not.toBeNull();
      expect(result?.isError).toBeUndefined();
    });

    it('should return error for missing channel_id', async () => {
      const result = await handlePrimitiveTool('slack_get_channel_history', {});

      expect(result?.isError).toBe(true);
    });
  });

  describe('slack_get_thread', () => {
    it('should get thread messages', async () => {
      const result = await handlePrimitiveTool('slack_get_thread', {
        channel_id: 'C123',
        thread_ts: '1704067200.000000',
      });

      expect(result).not.toBeNull();
      const text = (result!.content[0] as { type: 'text'; text: string }).text;
      const parsed = JSON.parse(text) as Array<{ text: string }>;
      expect(parsed[0].text).toBe('Thread message');
    });

    it('should return error for missing required fields', async () => {
      const result = await handlePrimitiveTool('slack_get_thread', {
        channel_id: 'C123',
        // Missing thread_ts
      });

      expect(result?.isError).toBe(true);
    });
  });

  describe('slack_get_reactions', () => {
    it('should get reactions with default user', async () => {
      const result = await handlePrimitiveTool('slack_get_reactions', {});

      expect(result).not.toBeNull();
      const text = (result!.content[0] as { type: 'text'; text: string }).text;
      const parsed = JSON.parse(text) as Array<{ reaction: string }>;
      expect(parsed[0].reaction).toBe('thumbsup');
    });

    it('should accept user_id parameter', async () => {
      const result = await handlePrimitiveTool('slack_get_reactions', {
        user_id: 'U789',
        timespan: 'yesterday',
      });

      expect(result).not.toBeNull();
      expect(result?.isError).toBeUndefined();
    });
  });

  describe('slack_list_channels', () => {
    it('should list channels', async () => {
      const result = await handlePrimitiveTool('slack_list_channels', {});

      expect(result).not.toBeNull();
      const text = (result!.content[0] as { type: 'text'; text: string }).text;
      const parsed = JSON.parse(text) as Array<{ id: string; name: string }>;
      expect(parsed[0].id).toBe('C123');
      expect(parsed[0].name).toBe('general');
    });

    it('should accept limit parameter', async () => {
      const result = await handlePrimitiveTool('slack_list_channels', {
        limit: 10,
      });

      expect(result).not.toBeNull();
      expect(result?.isError).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('should handle API errors gracefully', async () => {
      // Import the mocked client and make it throw
      const { getSlackClient } = await import('@/core/slack/client.js');
      const client = getSlackClient();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      vi.mocked(client.searchMessages).mockRejectedValueOnce(new Error('API Error'));

      const result = await handlePrimitiveTool('slack_search_messages', {
        query: 'test',
      });

      expect(result).not.toBeNull();
      expect(result?.isError).toBe(true);
      const text = (result?.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('API Error');
    });
  });
});
