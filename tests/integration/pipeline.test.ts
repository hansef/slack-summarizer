/**
 * Integration tests for the core summarization pipeline.
 *
 * These tests validate the full flow from data fetching through summarization,
 * mocking only external APIs (Slack and Claude) while using real in-memory
 * SQLite for caching.
 *
 * Test strategy:
 * - Slack API: Mocked with realistic response fixtures
 * - Claude API: Mocked with realistic narrative responses
 * - SQLite cache: Real in-memory database for each test
 * - All internal processing: Real implementation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import type { SlackMessage, SlackChannel, UserActivityData } from '@/core/models/slack.js';
import type { ConversationGroup } from '@/core/consolidation/consolidator.js';
import { resetEnvCache } from '@/utils/env.js';

// ============================================================================
// Test Fixtures
// ============================================================================

const TEST_USER_ID = 'U111111';
const TEST_CHANNEL_ID = 'C123456';
const TEST_CHANNEL_NAME = 'engineering';

const testUsers = [
  { id: 'U111111', name: 'alice', real_name: 'Alice Johnson', display_name: 'alice' },
  { id: 'U222222', name: 'bob', real_name: 'Bob Smith', display_name: 'bob' },
  { id: 'U333333', name: 'charlie', real_name: 'Charlie Brown', display_name: 'charlie' },
];

const testChannels: SlackChannel[] = [
  {
    id: 'C123456',
    name: 'engineering',
    is_channel: true,
    is_group: false,
    is_im: false,
    is_mpim: false,
    is_private: false,
  },
];

const testMessages: SlackMessage[] = [
  {
    type: 'message',
    ts: '1704067200.000000', // 2024-01-01 10:00:00 UTC
    channel: TEST_CHANNEL_ID,
    text: 'Hey team, the deploy pipeline is failing on the main branch',
    user: TEST_USER_ID,
  },
  {
    type: 'message',
    ts: '1704067260.000000', // 10:01:00
    channel: TEST_CHANNEL_ID,
    text: 'Let me take a look at the build logs',
    user: 'U222222',
  },
  {
    type: 'message',
    ts: '1704067320.000000', // 10:02:00
    channel: TEST_CHANNEL_ID,
    text: 'Found it - there is a typo in the config file for PROJ-123',
    user: 'U222222',
  },
  {
    type: 'message',
    ts: '1704067380.000000', // 10:03:00
    channel: TEST_CHANNEL_ID,
    text: 'Great catch! Can you submit a PR?',
    user: TEST_USER_ID,
  },
  {
    type: 'message',
    ts: '1704067440.000000', // 10:04:00
    channel: TEST_CHANNEL_ID,
    text: 'PR #456 is up for review',
    user: 'U222222',
  },
];

const testActivityData: UserActivityData = {
  messagesSent: testMessages.filter((m) => m.user === TEST_USER_ID),
  allChannelMessages: new Map([[TEST_CHANNEL_ID, testMessages]]),
  channels: testChannels,
  threadsParticipated: [],
  mentionsReceived: [],
  reactionsGiven: [],
};

const mockNarrativeResponse = JSON.stringify({
  narrative: 'Investigated a failing deploy pipeline issue on the main branch with Bob. Bob identified a configuration typo related to PROJ-123 and submitted PR #456 for review.',
  keyEvents: [
    'Reported deploy pipeline failure',
    'Bob found config typo for PROJ-123',
    'PR #456 submitted for review',
  ],
  references: ['PROJ-123', '#456'],
  participants: ['@Bob'],
  outcome: 'Fix submitted, awaiting review',
  nextActions: ['Review PR #456'],
  timesheetEntry: 'Debugged deploy pipeline failure with team',
});

// ============================================================================
// Mock Setup
// ============================================================================

// Mock state using vi.hoisted to ensure proper initialization order
const mockState = vi.hoisted(() => ({
  db: null as Database.Database | null,
  slackClient: {
    getCurrentUserId: vi.fn(),
    listUsers: vi.fn(),
    listChannels: vi.fn(),
    searchMessages: vi.fn(),
    getChannelHistory: vi.fn(),
    getThreadReplies: vi.fn(),
    getUserReactions: vi.fn(),
    getPermalink: vi.fn(),
    getUserDisplayName: vi.fn(),
  },
  claudeBackend: {
    createMessage: vi.fn(),
    backendType: 'sdk' as const,
  },
}));

// Mock database
vi.mock('@/core/cache/db.js', () => ({
  getDatabase: vi.fn(() => {
    if (!mockState.db) {
      throw new Error('Test database not initialized');
    }
    return mockState.db;
  }),
  closeDatabase: vi.fn(),
  resetDatabase: vi.fn(),
  transaction: vi.fn((fn) => {
    if (!mockState.db) {
      throw new Error('Test database not initialized');
    }
    return mockState.db.transaction(fn)(mockState.db);
  }),
}));

// Mock Slack client singleton
vi.mock('@/core/slack/client.js', () => ({
  getSlackClient: vi.fn(() => mockState.slackClient),
  SlackClient: vi.fn(() => mockState.slackClient),
}));

// Mock Claude provider
vi.mock('@/core/llm/index.js', () => ({
  getClaudeProvider: vi.fn(() => ({
    getBackend: () => mockState.claudeBackend,
    getBackendType: () => 'sdk',
  })),
  resetClaudeProvider: vi.fn(),
}));

// Import test utilities and modules after mocking
import { createTestDatabase } from '@tests/utils/test-db.js';
import { SummaryAggregator } from '@/core/summarization/aggregator.js';
import { hybridSegmentation } from '@/core/segmentation/hybrid.js';
import { consolidateConversations } from '@/core/consolidation/consolidator.js';

// ============================================================================
// Tests
// ============================================================================

describe('Pipeline Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEnvCache();

    // Set required environment variables
    process.env.SLACK_USER_TOKEN = 'xoxp-test-token';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    process.env.SLACK_SUMMARIZER_TIMEZONE = 'UTC';
    process.env.SLACK_SUMMARIZER_LOG_LEVEL = 'error'; // Quiet for tests

    // Initialize test database
    mockState.db = createTestDatabase();

    // Configure default mock responses
    mockState.slackClient.getCurrentUserId.mockResolvedValue(TEST_USER_ID);
    mockState.slackClient.listUsers.mockResolvedValue(testUsers);
    mockState.slackClient.listChannels.mockResolvedValue(testChannels);
    mockState.slackClient.searchMessages.mockResolvedValue([]);
    mockState.slackClient.getChannelHistory.mockResolvedValue(testMessages);
    mockState.slackClient.getThreadReplies.mockResolvedValue([]);
    mockState.slackClient.getUserReactions.mockResolvedValue([]);
    mockState.slackClient.getPermalink.mockResolvedValue('https://slack.com/archives/C123/p1234');
    mockState.slackClient.getUserDisplayName.mockImplementation((userId: string) => {
      const user = testUsers.find((u) => u.id === userId);
      return Promise.resolve(user?.real_name ?? userId);
    });

    mockState.claudeBackend.createMessage.mockResolvedValue({
      content: [{ type: 'text', text: mockNarrativeResponse }],
    });
  });

  afterEach(() => {
    if (mockState.db) {
      mockState.db.close();
      mockState.db = null;
    }
    resetEnvCache();
  });

  describe('Segmentation Pipeline', () => {
    it('should segment messages into conversations', async () => {
      const result = await hybridSegmentation(
        testMessages,
        [], // threads
        TEST_CHANNEL_ID,
        TEST_CHANNEL_NAME,
        TEST_USER_ID,
        testMessages // allChannelMessages
      );

      expect(result.conversations.length).toBeGreaterThan(0);
      expect(result.stats.totalMessages).toBe(testMessages.length);
    });

    it('should identify user participation in conversations', async () => {
      const result = await hybridSegmentation(
        testMessages,
        [], // threads
        TEST_CHANNEL_ID,
        TEST_CHANNEL_NAME,
        TEST_USER_ID,
        testMessages
      );

      // All messages are in the same time window, so should be one conversation
      expect(result.conversations.length).toBe(1);
      expect(result.conversations[0].participants).toContain(TEST_USER_ID);
    });

    it('should handle time gap splitting', async () => {
      // Create messages with large time gaps
      const messagesWithGaps: SlackMessage[] = [
        {
          type: 'message',
          ts: '1704067200.000000', // 10:00:00
          channel: TEST_CHANNEL_ID,
          text: 'Morning standup',
          user: TEST_USER_ID,
        },
        {
          type: 'message',
          ts: '1704074400.000000', // 12:00:00 (2 hour gap)
          channel: TEST_CHANNEL_ID,
          text: 'Lunch meeting notes',
          user: TEST_USER_ID,
        },
      ];

      const result = await hybridSegmentation(
        messagesWithGaps,
        [], // threads
        TEST_CHANNEL_ID,
        TEST_CHANNEL_NAME,
        TEST_USER_ID,
        messagesWithGaps
      );

      // Should split into separate conversations due to time gap
      expect(result.conversations.length).toBe(2);
      expect(result.stats.timeGapSplits).toBe(1);
    });
  });

  describe('Consolidation Pipeline', () => {
    it('should consolidate related conversations', async () => {
      const segmentResult = await hybridSegmentation(
        testMessages,
        [],
        TEST_CHANNEL_ID,
        TEST_CHANNEL_NAME,
        TEST_USER_ID,
        testMessages
      );
      const channelNames = new Map([[TEST_CHANNEL_ID, TEST_CHANNEL_NAME]]);

      const consolidationResult = await consolidateConversations(
        segmentResult.conversations,
        channelNames
      );

      expect(consolidationResult.groups.length).toBeGreaterThan(0);
      expect(consolidationResult.stats.originalConversations).toBe(segmentResult.conversations.length);
    });

    it('should extract shared references from messages', async () => {
      // Create messages with references
      const messagesWithRefs: SlackMessage[] = [
        {
          type: 'message',
          ts: '1704067200.000000',
          channel: TEST_CHANNEL_ID,
          text: 'Working on PROJ-123',
          user: TEST_USER_ID,
        },
        {
          type: 'message',
          ts: '1704067260.000000',
          channel: TEST_CHANNEL_ID,
          text: 'Related to PROJ-123 fix',
          user: 'U222222',
        },
      ];

      const segmentResult = await hybridSegmentation(
        messagesWithRefs,
        [],
        TEST_CHANNEL_ID,
        TEST_CHANNEL_NAME,
        TEST_USER_ID,
        messagesWithRefs
      );
      const channelNames = new Map([[TEST_CHANNEL_ID, TEST_CHANNEL_NAME]]);

      const consolidationResult = await consolidateConversations(
        segmentResult.conversations,
        channelNames
      );

      // Should have extracted PROJ-123 reference
      const hasProjectRef = consolidationResult.groups.some((g) =>
        g.sharedReferences.some((r) => r.includes('PROJ-123'))
      );
      expect(hasProjectRef).toBe(true);
    });
  });

  describe('Full Pipeline with Aggregator', () => {
    it('should generate a complete summary output', async () => {
      // Create a mock DataFetcher
      const mockDataFetcher = {
        fetchUserActivity: vi.fn().mockResolvedValue(testActivityData),
      };

      // Create aggregator with mocked dependencies
      const aggregator = new SummaryAggregator({
        slackClient: mockState.slackClient as any,
        dataFetcher: mockDataFetcher as any,
      });

      const result = await aggregator.generateSummary('today', TEST_USER_ID);

      // Verify structure
      expect(result).toHaveProperty('metadata');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('channels');

      // Verify metadata
      expect(result.metadata.schema_version).toBe('2.0.0');
      expect(result.metadata.request.user_id).toBe(TEST_USER_ID);

      // Verify summary stats
      expect(result.summary.total_channels).toBeGreaterThanOrEqual(0);
    });

    it('should call Claude for narrative summarization', async () => {
      const mockDataFetcher = {
        fetchUserActivity: vi.fn().mockResolvedValue(testActivityData),
      };

      const aggregator = new SummaryAggregator({
        slackClient: mockState.slackClient as any,
        dataFetcher: mockDataFetcher as any,
      });

      await aggregator.generateSummary('today', TEST_USER_ID);

      // Claude should have been called for summarization
      expect(mockState.claudeBackend.createMessage).toHaveBeenCalled();
    });

    it('should emit progress events', async () => {
      const progressEvents: any[] = [];
      const mockDataFetcher = {
        fetchUserActivity: vi.fn().mockResolvedValue(testActivityData),
      };

      const aggregator = new SummaryAggregator({
        slackClient: mockState.slackClient as any,
        dataFetcher: mockDataFetcher as any,
        onProgress: (event) => progressEvents.push(event),
      });

      await aggregator.generateSummary('today', TEST_USER_ID);

      // Should have emitted progress events for each stage
      expect(progressEvents.some((e) => e.stage === 'fetching')).toBe(true);
      expect(progressEvents.some((e) => e.stage === 'segmenting')).toBe(true);
      expect(progressEvents.some((e) => e.stage === 'complete')).toBe(true);
    });

    it('should resolve user display names', async () => {
      const mockDataFetcher = {
        fetchUserActivity: vi.fn().mockResolvedValue(testActivityData),
      };

      const aggregator = new SummaryAggregator({
        slackClient: mockState.slackClient as any,
        dataFetcher: mockDataFetcher as any,
      });

      await aggregator.generateSummary('today', TEST_USER_ID);

      // Should have called listUsers to build display names map
      expect(mockState.slackClient.listUsers).toHaveBeenCalled();
    });

    it('should handle empty activity gracefully', async () => {
      const emptyActivityData: UserActivityData = {
        messagesSent: [],
        allChannelMessages: new Map(),
        channels: [],
        threadsParticipated: [],
        mentionsReceived: [],
        reactionsGiven: [],
      };

      const mockDataFetcher = {
        fetchUserActivity: vi.fn().mockResolvedValue(emptyActivityData),
      };

      const aggregator = new SummaryAggregator({
        slackClient: mockState.slackClient as any,
        dataFetcher: mockDataFetcher as any,
      });

      const result = await aggregator.generateSummary('today', TEST_USER_ID);

      // Should produce valid output with empty channels
      expect(result.channels).toHaveLength(0);
      expect(result.summary.total_messages).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle Claude API errors gracefully', async () => {
      mockState.claudeBackend.createMessage.mockRejectedValue(new Error('API rate limit'));

      const mockDataFetcher = {
        fetchUserActivity: vi.fn().mockResolvedValue(testActivityData),
      };

      const aggregator = new SummaryAggregator({
        slackClient: mockState.slackClient as any,
        dataFetcher: mockDataFetcher as any,
      });

      // Should still produce output (with fallback summaries)
      await expect(aggregator.generateSummary('today', TEST_USER_ID)).resolves.toBeDefined();
    });

    it('should handle malformed Claude responses', async () => {
      mockState.claudeBackend.createMessage.mockResolvedValue({
        content: [{ type: 'text', text: 'Not valid JSON response' }],
      });

      const mockDataFetcher = {
        fetchUserActivity: vi.fn().mockResolvedValue(testActivityData),
      };

      const aggregator = new SummaryAggregator({
        slackClient: mockState.slackClient as any,
        dataFetcher: mockDataFetcher as any,
      });

      // Should produce output with fallback handling
      const result = await aggregator.generateSummary('today', TEST_USER_ID);
      expect(result).toBeDefined();
      expect(result.channels).toBeDefined();
    });
  });

  describe('Cache Integration', () => {
    it('should use SQLite database for operations', async () => {
      // The test database should be initialized
      expect(mockState.db).not.toBeNull();

      // Verify the database has the expected tables
      const tables = mockState.db!.prepare(
        "SELECT name FROM sqlite_master WHERE type='table'"
      ).all() as { name: string }[];

      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain('messages');
      expect(tableNames).toContain('conversation_embeddings');
    });
  });
});
