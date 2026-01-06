/**
 * Tests for the summary aggregator.
 *
 * The SummaryAggregator:
 * 1. Orchestrates the full summarization pipeline
 * 2. Fetches user activity data via DataFetcher
 * 3. Segments and consolidates conversations
 * 4. Summarizes each channel's topics
 * 5. Produces final SummaryOutput structure
 * 6. Emits progress events during processing
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SummaryAggregator, createSummaryAggregator, type ProgressEvent } from '@/core/summarization/aggregator.js';
import type { UserActivityData, SlackChannel } from '@/core/models/slack.js';
import type { Conversation } from '@/core/models/conversation.js';

// Mock the Slack client
const mockGetCurrentUserId = vi.fn().mockResolvedValue('U123');
const mockListUsers = vi.fn().mockResolvedValue([
  { id: 'U123', name: 'testuser', real_name: 'Test User' },
  { id: 'U456', name: 'otheruser', real_name: 'Other User' },
]);
const mockGetChannelInfo = vi.fn();
const mockGetUserDisplayName = vi.fn().mockResolvedValue('Test User');
const mockGetPermalink = vi.fn().mockResolvedValue('https://slack.com/archives/C123/p1704067200');
const mockGetMessage = vi.fn().mockResolvedValue(null);

vi.mock('@/core/slack/client.js', () => ({
  getSlackClient: vi.fn(() => ({
    getCurrentUserId: mockGetCurrentUserId,
    listUsers: mockListUsers,
    getChannelInfo: mockGetChannelInfo,
    getUserDisplayName: mockGetUserDisplayName,
    getPermalink: mockGetPermalink,
    getMessage: mockGetMessage,
  })),
}));

// Mock the data fetcher
const mockFetchUserActivity = vi.fn();
vi.mock('@/core/slack/fetcher.js', () => ({
  createDataFetcher: vi.fn(() => ({
    fetchUserActivity: mockFetchUserActivity,
  })),
}));

// Mock segmentation
vi.mock('@/core/segmentation/hybrid.js', () => ({
  hybridSegmentation: vi.fn().mockResolvedValue({
    conversations: [
      {
        id: 'conv-1',
        channelId: 'C123',
        channelName: 'general',
        messages: [
          { type: 'message', ts: '1704067200.000000', text: 'Hello', user: 'U123', channel: 'C123' },
        ],
        startTime: '2024-01-01T10:00:00Z',
        endTime: '2024-01-01T10:30:00Z',
        participants: ['U123', 'U456'],
        userMessageCount: 1,
        isThread: false,
      },
    ] as Conversation[],
    stats: {
      totalMessages: 1,
      threadsExtracted: 0,
      timeGapSplits: 0,
      semanticSplits: 0,
      totalConversations: 1,
    },
  }),
}));

// Mock consolidation
vi.mock('@/core/consolidation/consolidator.js', () => ({
  consolidateConversations: vi.fn().mockResolvedValue({
    groups: [
      {
        id: 'group-1',
        conversations: [
          {
            id: 'conv-1',
            channelId: 'C123',
            channelName: 'general',
            messages: [
              { type: 'message', ts: '1704067200.000000', text: 'Hello', user: 'U123', channel: 'C123' },
            ],
            startTime: '2024-01-01T10:00:00Z',
            endTime: '2024-01-01T10:30:00Z',
            participants: ['U123', 'U456'],
            userMessageCount: 1,
            isThread: false,
          },
        ],
        sharedReferences: ['PROJ-123'],
        allMessages: [
          { type: 'message', ts: '1704067200.000000', text: 'Hello', user: 'U123', channel: 'C123' },
        ],
        startTime: '2024-01-01T10:00:00Z',
        endTime: '2024-01-01T10:30:00Z',
        participants: ['U123', 'U456'],
        totalMessageCount: 1,
        totalUserMessageCount: 1,
        originalConversationIds: ['conv-1'],
      },
    ],
    stats: {
      original: 1,
      final: 1,
      botConversationsMerged: 0,
      trivialConversationsMerged: 0,
      trivialConversationsDropped: 0,
      adjacentMerged: 0,
      proximityMerged: 0,
      sameAuthorMerged: 0,
      referenceEmbeddingMerged: 0,
    },
  }),
}));

// Mock reference extractor
vi.mock('@/core/consolidation/reference-extractor.js', () => ({
  parseSlackMessageLinks: vi.fn().mockReturnValue([]),
}));

// Mock summarization client
const mockSummarizeGroupsBatch = vi.fn().mockResolvedValue([
  {
    narrative_summary: 'Worked on the project',
    start_time: '2024-01-01T10:00:00Z',
    end_time: '2024-01-01T10:30:00Z',
    message_count: 1,
    user_messages: 1,
    participants: ['@Other User'],
    key_events: ['Started work'],
    references: ['PROJ-123'],
    outcome: 'Progress made',
    next_actions: ['Continue tomorrow'],
    timesheet_entry: 'Project work',
    slack_link: 'https://slack.com/archives/C123/p1704067200',
  },
]);

vi.mock('@/core/summarization/client.js', () => ({
  getSummarizationClient: vi.fn(() => ({
    summarizeGroupsBatch: mockSummarizeGroupsBatch,
  })),
}));

// Mock concurrency
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
  mapWithGlobalClaudeLimiter: vi.fn(
    async <T, R>(items: T[], fn: (item: T, index: number) => Promise<R>): Promise<R[]> => {
      const results: R[] = [];
      for (let i = 0; i < items.length; i++) {
        results.push(await fn(items[i], i));
      }
      return results;
    }
  ),
}));

// Mock env
vi.mock('@/utils/env.js', () => ({
  getEnv: vi.fn(() => ({
    SLACK_SUMMARIZER_TIMEZONE: 'America/Los_Angeles',
    SLACK_SUMMARIZER_CHANNEL_CONCURRENCY: 10,
    SLACK_SUMMARIZER_CLAUDE_CONCURRENCY: 5,
    SLACK_SUMMARIZER_SLACK_CONCURRENCY: 10,
    SLACK_SUMMARIZER_ENABLE_EMBEDDINGS: false,
    OPENAI_API_KEY: undefined,
  })),
}));

describe('SummaryAggregator', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock setup for a simple channel
    const defaultActivity: UserActivityData = {
      userId: 'U123',
      timeRange: {
        start: '2024-01-01T00:00:00-08:00',
        end: '2024-01-01T23:59:59-08:00',
      },
      messagesSent: [
        { type: 'message', ts: '1704067200.000000', text: 'Hello', user: 'U123', channel: 'C123' },
      ],
      mentionsReceived: [],
      threadsParticipated: [],
      reactionsGiven: [],
      channels: [
        { id: 'C123', name: 'general', is_private: false, is_im: false, is_mpim: false },
      ] as SlackChannel[],
      allChannelMessages: [
        { type: 'message', ts: '1704067200.000000', text: 'Hello', user: 'U123', channel: 'C123' },
      ],
    };

    mockFetchUserActivity.mockResolvedValue(defaultActivity);
  });

  describe('constructor', () => {
    it('should create aggregator with defaults', () => {
      const aggregator = new SummaryAggregator();
      expect(aggregator).toBeDefined();
    });

    it('should accept custom config', () => {
      const onProgress = vi.fn();
      const aggregator = new SummaryAggregator({ onProgress });
      expect(aggregator).toBeDefined();
    });
  });

  describe('generateSummary', () => {
    it('should generate a complete summary', async () => {
      const aggregator = new SummaryAggregator();
      const result = await aggregator.generateSummary('today');

      expect(result).toBeDefined();
      expect(result.metadata).toBeDefined();
      expect(result.metadata.schema_version).toBe('2.0.0');
      expect(result.summary).toBeDefined();
      expect(result.channels).toBeDefined();
    });

    it('should use provided userId', async () => {
      const aggregator = new SummaryAggregator();
      const result = await aggregator.generateSummary('today', 'U789');

      expect(mockGetCurrentUserId).not.toHaveBeenCalled();
      expect(result.metadata.request.user_id).toBe('U789');
    });

    it('should get current user if no userId provided', async () => {
      const aggregator = new SummaryAggregator();
      const result = await aggregator.generateSummary('today');

      expect(mockGetCurrentUserId).toHaveBeenCalled();
      expect(result.metadata.request.user_id).toBe('U123');
    });

    it('should include correct summary statistics', async () => {
      mockFetchUserActivity.mockResolvedValue({
        userId: 'U123',
        timeRange: {
          start: '2024-01-01T00:00:00-08:00',
          end: '2024-01-01T23:59:59-08:00',
        },
        messagesSent: [
          { type: 'message', ts: '1', text: 'Msg1', user: 'U123', channel: 'C123' },
          { type: 'message', ts: '2', text: 'Msg2', user: 'U123', channel: 'C123' },
        ],
        mentionsReceived: [
          { type: 'message', ts: '3', text: '<@U123>', user: 'U456', channel: 'C123' },
        ],
        threadsParticipated: [
          { threadTs: '1', channel: 'C123', messages: [] },
        ],
        reactionsGiven: [
          { messageId: '1', channel: 'C123', reaction: 'thumbsup', timestamp: '1' },
          { messageId: '2', channel: 'C123', reaction: 'heart', timestamp: '2' },
        ],
        channels: [
          { id: 'C123', name: 'general', is_private: false, is_im: false, is_mpim: false },
        ],
        allChannelMessages: [],
      });

      const aggregator = new SummaryAggregator();
      const result = await aggregator.generateSummary('today');

      expect(result.summary.total_messages).toBe(2);
      expect(result.summary.mentions_received).toBe(1);
      expect(result.summary.threads_participated).toBe(1);
      expect(result.summary.reactions_given).toBe(2);
    });

    it('should emit progress events', async () => {
      const progressEvents: ProgressEvent[] = [];
      const onProgress = (event: ProgressEvent) => progressEvents.push(event);

      const aggregator = new SummaryAggregator({ onProgress });
      await aggregator.generateSummary('today');

      expect(progressEvents.length).toBeGreaterThan(0);
      expect(progressEvents.some((e) => e.stage === 'fetching')).toBe(true);
      expect(progressEvents.some((e) => e.stage === 'segmenting')).toBe(true);
      expect(progressEvents.some((e) => e.stage === 'summarizing')).toBe(true);
      expect(progressEvents.some((e) => e.stage === 'complete')).toBe(true);
    });

    it('should handle multiple channels', async () => {
      mockFetchUserActivity.mockResolvedValue({
        userId: 'U123',
        timeRange: {
          start: '2024-01-01T00:00:00-08:00',
          end: '2024-01-01T23:59:59-08:00',
        },
        messagesSent: [
          { type: 'message', ts: '1', text: 'Hello', user: 'U123', channel: 'C123' },
          { type: 'message', ts: '2', text: 'Hi', user: 'U123', channel: 'C456' },
        ],
        mentionsReceived: [],
        threadsParticipated: [],
        reactionsGiven: [],
        channels: [
          { id: 'C123', name: 'general', is_private: false, is_im: false, is_mpim: false },
          { id: 'C456', name: 'random', is_private: false, is_im: false, is_mpim: false },
        ],
        allChannelMessages: [],
      });

      const aggregator = new SummaryAggregator();
      const result = await aggregator.generateSummary('today');

      expect(result.channels.length).toBe(2);
    });

    it('should exclude channels with only mentions (no messages/threads)', async () => {
      mockFetchUserActivity.mockResolvedValue({
        userId: 'U123',
        timeRange: {
          start: '2024-01-01T00:00:00-08:00',
          end: '2024-01-01T23:59:59-08:00',
        },
        messagesSent: [], // No messages sent
        mentionsReceived: [
          { type: 'message', ts: '1', text: '<@U123>', user: 'U456', channel: 'C999' },
        ],
        threadsParticipated: [],
        reactionsGiven: [],
        channels: [
          { id: 'C999', name: 'only-mentions', is_private: false, is_im: false, is_mpim: false },
        ],
        allChannelMessages: [],
      });

      const aggregator = new SummaryAggregator();
      const result = await aggregator.generateSummary('today');

      // Channel with only mentions should be excluded
      expect(result.channels.length).toBe(0);
    });
  });

  describe('channel display names', () => {
    it('should resolve DM channel to user name', async () => {
      mockFetchUserActivity.mockResolvedValue({
        userId: 'U123',
        timeRange: {
          start: '2024-01-01T00:00:00-08:00',
          end: '2024-01-01T23:59:59-08:00',
        },
        messagesSent: [
          { type: 'message', ts: '1', text: 'Hi', user: 'U123', channel: 'D123' },
        ],
        mentionsReceived: [],
        threadsParticipated: [],
        reactionsGiven: [],
        channels: [
          { id: 'D123', name: 'dm-channel', is_private: false, is_im: true, is_mpim: false, user: 'U456' },
        ] as SlackChannel[],
        allChannelMessages: [],
      });

      const aggregator = new SummaryAggregator();
      const result = await aggregator.generateSummary('today');

      // Should show other user's name for DM
      expect(result.channels[0].channel_name).toBe('Other User');
    });

    it('should format MPIM channel as Group with names', async () => {
      mockFetchUserActivity.mockResolvedValue({
        userId: 'U123',
        timeRange: {
          start: '2024-01-01T00:00:00-08:00',
          end: '2024-01-01T23:59:59-08:00',
        },
        messagesSent: [
          { type: 'message', ts: '1', text: 'Group message', user: 'U123', channel: 'G123' },
        ],
        mentionsReceived: [],
        threadsParticipated: [],
        reactionsGiven: [],
        channels: [
          {
            id: 'G123',
            name: 'mpdm-testuser--otheruser--thirduser-1',
            is_private: false,
            is_im: false,
            is_mpim: true,
            members: ['U123', 'U456', 'U789'],
          },
        ] as SlackChannel[],
        allChannelMessages: [],
      });

      // Add third user to mock
      mockListUsers.mockResolvedValueOnce([
        { id: 'U123', name: 'testuser', real_name: 'Test User' },
        { id: 'U456', name: 'otheruser', real_name: 'Other User' },
        { id: 'U789', name: 'thirduser', real_name: 'Third User' },
      ]);

      const aggregator = new SummaryAggregator();
      const result = await aggregator.generateSummary('today');

      // Should show "Group: FirstName1, FirstName2" format
      expect(result.channels[0].channel_name).toContain('Group:');
    });

    it('should use channel name for public channels', async () => {
      const aggregator = new SummaryAggregator();
      const result = await aggregator.generateSummary('today');

      expect(result.channels[0].channel_name).toBe('general');
    });
  });

  describe('error handling', () => {
    it('should handle empty activity gracefully', async () => {
      mockFetchUserActivity.mockResolvedValue({
        userId: 'U123',
        timeRange: {
          start: '2024-01-01T00:00:00-08:00',
          end: '2024-01-01T23:59:59-08:00',
        },
        messagesSent: [],
        mentionsReceived: [],
        threadsParticipated: [],
        reactionsGiven: [],
        channels: [],
        allChannelMessages: [],
      });

      const aggregator = new SummaryAggregator();
      const result = await aggregator.generateSummary('today');

      expect(result.summary.total_messages).toBe(0);
      expect(result.channels).toHaveLength(0);
    });
  });

  describe('consolidation stats', () => {
    it('should include consolidation stats in channel summary', async () => {
      const aggregator = new SummaryAggregator();
      const result = await aggregator.generateSummary('today');

      const channel = result.channels[0];
      expect(channel.consolidation_stats).toBeDefined();
      expect(channel.consolidation_stats!.original_segments).toBeDefined();
      expect(channel.consolidation_stats!.consolidated_topics).toBeDefined();
    });
  });
});

describe('createSummaryAggregator', () => {
  it('should create a new SummaryAggregator instance', () => {
    const aggregator = createSummaryAggregator();
    expect(aggregator).toBeInstanceOf(SummaryAggregator);
  });

  it('should pass config to SummaryAggregator', () => {
    const onProgress = vi.fn();
    const aggregator = createSummaryAggregator({ onProgress });
    expect(aggregator).toBeDefined();
  });
});
