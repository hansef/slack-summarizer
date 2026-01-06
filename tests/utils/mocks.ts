/**
 * Mock helpers for test isolation.
 *
 * These functions create pre-configured mock objects that match the interface
 * of real dependencies (Slack client, Claude provider, etc.) without making
 * actual API calls.
 */

import { vi } from 'vitest';
import { createSlackUser, createSlackChannel } from './factories.js';

/**
 * Creates a mock Slack client with all methods stubbed.
 * Each method can be configured individually for specific test cases.
 */
export function mockSlackClient() {
  return {
    authenticate: vi.fn().mockResolvedValue({
      ok: true,
      user_id: 'U123456',
      user: 'testuser',
      team_id: 'T123456',
      team: 'Test Team',
    }),
    getCurrentUserId: vi.fn().mockResolvedValue('U123456'),
    searchMessages: vi.fn().mockResolvedValue([]),
    getChannelHistory: vi.fn().mockResolvedValue([]),
    getThreadReplies: vi.fn().mockResolvedValue([]),
    getUserInfo: vi.fn().mockResolvedValue(createSlackUser()),
    getUserById: vi.fn().mockResolvedValue(createSlackUser()),
    getConversationInfo: vi.fn().mockResolvedValue(createSlackChannel()),
    listChannels: vi.fn().mockResolvedValue([createSlackChannel()]),
    listUserChannels: vi.fn().mockResolvedValue([createSlackChannel()]),
    getReactionsForUser: vi.fn().mockResolvedValue([]),
  };
}

/**
 * Creates a mock Claude provider.
 * Can be configured to return specific responses for testing summarization logic.
 */
export function mockClaudeProvider() {
  return {
    getBackend: vi.fn().mockReturnValue({
      createMessage: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '{}' }],
      }),
    }),
    getBackendType: vi.fn().mockReturnValue('sdk'),
  };
}

/**
 * Creates a mock Claude backend (SDK or CLI).
 */
export function mockClaudeBackend() {
  return {
    createMessage: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"narrative": "Test summary"}' }],
    }),
  };
}

/**
 * Creates a mock rate limiter that executes immediately.
 * Useful for testing code that uses rate limiting without actual delays.
 */
export function mockRateLimiter() {
  return {
    execute: vi.fn().mockImplementation(<T>(fn: () => Promise<T>) => fn()),
    getStats: vi.fn().mockReturnValue({ queued: 0, active: 0, completed: 0 }),
  };
}

/**
 * Creates a mock concurrency limiter.
 */
export function mockLimiter() {
  let activeCount = 0;
  const pendingCount = 0;

  return {
    execute: vi.fn().mockImplementation(async <T>(fn: () => Promise<T>) => {
      activeCount++;
      try {
        return await fn();
      } finally {
        activeCount--;
      }
    }),
    get activeCount() { return activeCount; },
    get pendingCount() { return pendingCount; },
  };
}

/**
 * Creates a mock embedding client.
 */
export function mockEmbeddingClient() {
  return {
    getEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0.1)),
    getEmbeddings: vi.fn().mockResolvedValue([new Array(1536).fill(0.1)]),
    isAvailable: vi.fn().mockReturnValue(true),
  };
}

/**
 * Creates a mock database connection for caching tests.
 */
export function mockDatabase() {
  const storage = new Map<string, unknown>();

  return {
    get: vi.fn().mockImplementation((key: string) => storage.get(key)),
    set: vi.fn().mockImplementation((key: string, value: unknown) => storage.set(key, value)),
    delete: vi.fn().mockImplementation((key: string) => storage.delete(key)),
    has: vi.fn().mockImplementation((key: string) => storage.has(key)),
    clear: vi.fn().mockImplementation(() => storage.clear()),
    close: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockResolvedValue({ changes: 1 }),
    all: vi.fn().mockResolvedValue([]),
    exec: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Creates a mock summarization client.
 */
export function mockSummarizationClient() {
  return {
    summarizeConversation: vi.fn().mockResolvedValue({
      narrative: 'Test narrative summary',
      keyEvents: ['Event 1', 'Event 2'],
      references: ['#123'],
      participants: ['@user1'],
      outcome: 'Resolved',
      nextActions: [],
    }),
    summarizeBatch: vi.fn().mockResolvedValue([
      {
        narrative: 'Test narrative summary',
        keyEvents: ['Event 1'],
        references: [],
        participants: [],
        outcome: null,
        nextActions: [],
      },
    ]),
  };
}

/**
 * Creates a mock data fetcher.
 */
export function mockDataFetcher() {
  return {
    fetchUserActivity: vi.fn().mockResolvedValue({
      userId: 'U123456',
      timeRange: { start: '2024-01-01T00:00:00Z', end: '2024-01-01T23:59:59Z' },
      messagesSent: [],
      mentionsReceived: [],
      threadsParticipated: [],
      reactionsGiven: [],
      channels: [],
      allChannelMessages: [],
    }),
  };
}

/**
 * Creates a mock summary aggregator.
 */
export function mockSummaryAggregator() {
  return {
    generateSummary: vi.fn().mockResolvedValue({
      userId: 'U123456',
      timeRange: { start: '2024-01-01', end: '2024-01-01' },
      channels: [],
      consolidationStats: {
        originalConversations: 0,
        consolidatedGroups: 0,
        botConversationsMerged: 0,
        trivialConversationsMerged: 0,
        trivialConversationsDropped: 0,
        adjacentMerged: 0,
        proximityMerged: 0,
        sameAuthorMerged: 0,
        referenceGroupsMerged: 0,
      },
    }),
  };
}

/**
 * Mocks the child_process module for CLI availability checks.
 * Call this at the top of test files that need to test CLI detection.
 */
export function setupChildProcessMock() {
  const execSyncMock = vi.fn();

  vi.mock('child_process', () => ({
    execSync: execSyncMock,
  }));

  return { execSyncMock };
}

/**
 * Creates a mock WebClient for direct Slack API mocking.
 */
export function mockWebClient() {
  return {
    auth: {
      test: vi.fn().mockResolvedValue({
        ok: true,
        user_id: 'U123456',
        user: 'testuser',
        team_id: 'T123456',
        team: 'Test Team',
      }),
    },
    users: {
      conversations: vi.fn().mockResolvedValue({ ok: true, channels: [] }),
      info: vi.fn().mockResolvedValue({ ok: true, user: createSlackUser() }),
    },
    conversations: {
      history: vi.fn().mockResolvedValue({ ok: true, messages: [] }),
      info: vi.fn().mockResolvedValue({ ok: true, channel: createSlackChannel() }),
      replies: vi.fn().mockResolvedValue({ ok: true, messages: [] }),
    },
    search: {
      messages: vi.fn().mockResolvedValue({ ok: true, messages: { matches: [] } }),
    },
    reactions: {
      list: vi.fn().mockResolvedValue({ ok: true, items: [] }),
    },
  };
}

/**
 * Sets up environment variable mocking for config tests.
 * Returns cleanup function to restore original environment.
 */
export function mockEnvironment(overrides: Record<string, string | undefined> = {}) {
  const originalEnv = { ...process.env };

  // Apply overrides
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  // Return cleanup function
  return () => {
    process.env = originalEnv;
  };
}
