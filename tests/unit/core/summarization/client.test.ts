/**
 * Tests for the summarization client.
 *
 * The SummarizationClient:
 * 1. Resolves user IDs to display names
 * 2. Builds prompts for conversation groups
 * 3. Calls Claude for narrative summaries
 * 4. Falls back gracefully on parsing/API failures
 * 5. Batches multiple groups for efficiency
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SummarizationClient,
  getSummarizationClient,
  resetSummarizationClient,
} from '@/core/summarization/client.js';
import type { ConversationGroup } from '@/core/consolidation/consolidator.js';

// Mock the Claude provider
vi.mock('@/core/llm/index.js', () => ({
  getClaudeProvider: vi.fn(() => ({
    getBackend: vi.fn(() => ({
      backendType: 'sdk',
      createMessage: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: `<narrative>Worked on implementing the feature</narrative>
<key_events>
- Started implementation
- Fixed bugs
</key_events>
<references>
- PROJ-123
</references>
<outcome>Feature completed</outcome>
<next_actions>
- Deploy to staging
</next_actions>
<timesheet_entry>Feature implementation work</timesheet_entry>`,
          },
        ],
      }),
    })),
  })),
}));

// Mock the Slack client
vi.mock('@/core/slack/client.js', () => ({
  getSlackClient: vi.fn(() => ({
    getUserDisplayName: vi.fn().mockImplementation((userId: string) => {
      const names: Record<string, string> = {
        U123: 'Alice',
        U456: 'Bob',
        U789: 'Charlie',
      };
      return Promise.resolve(names[userId] ?? userId);
    }),
  })),
}));

// Mock env
vi.mock('@/utils/env.js', () => ({
  getEnv: vi.fn(() => ({
    SLACK_SUMMARIZER_CLAUDE_MODEL: 'claude-haiku-4-5-20251001',
  })),
}));

// Mock prompts
vi.mock('@/core/summarization/prompts.js', () => ({
  buildNarrativeGroupPrompt: vi.fn(() => 'Mock prompt'),
  buildNarrativeBatchPrompt: vi.fn(() => 'Mock batch prompt'),
  parseNarrativeSummaryResponse: vi.fn(() => ({
    narrative: 'Worked on implementing the feature',
    keyEvents: ['Started implementation', 'Fixed bugs'],
    references: ['PROJ-123'],
    outcome: 'Feature completed',
    nextActions: ['Deploy to staging'],
    timesheetEntry: 'Feature implementation work',
  })),
  parseNarrativeBatchResponse: vi.fn((_text: string) => {
    // Return array matching expected count
    return [
      {
        narrative: 'First summary',
        keyEvents: ['Event 1'],
        references: ['REF-1'],
        outcome: 'Done',
        nextActions: [],
        timesheetEntry: 'Work 1',
      },
      {
        narrative: 'Second summary',
        keyEvents: ['Event 2'],
        references: ['REF-2'],
        outcome: 'Done',
        nextActions: [],
        timesheetEntry: 'Work 2',
      },
      {
        narrative: 'Third summary',
        keyEvents: ['Event 3'],
        references: ['REF-3'],
        outcome: 'Done',
        nextActions: [],
        timesheetEntry: 'Work 3',
      },
    ];
  }),
}));

// Mock consolidator helpers
vi.mock('@/core/consolidation/consolidator.js', () => ({
  getGroupSlackLinks: vi.fn(() => ({
    primary: 'https://slack.com/archives/C123/p1704067200',
    all: ['https://slack.com/archives/C123/p1704067200'],
  })),
}));

// Helper to create a conversation group
function createGroup(id: string, overrides: Partial<ConversationGroup> = {}): ConversationGroup {
  return {
    id,
    conversations: [],
    sharedReferences: ['PROJ-123'],
    allMessages: [
      { type: 'message', ts: '1704067200.000000', channel: 'C123', text: 'Hello', user: 'U456' },
    ],
    startTime: '2024-01-01T10:00:00Z',
    endTime: '2024-01-01T10:30:00Z',
    participants: ['U123', 'U456'],
    totalMessageCount: 1,
    totalUserMessageCount: 1,
    originalConversationIds: ['conv-1'],
    hasThreads: false,
    ...overrides,
  };
}

describe('SummarizationClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSummarizationClient();
  });

  describe('construction', () => {
    it('should create client with default config', () => {
      const client = new SummarizationClient();
      expect(client).toBeDefined();
    });

    it('should accept custom config', () => {
      const client = new SummarizationClient({
        model: 'claude-sonnet-4-5-20250929',
      });
      expect(client).toBeDefined();
    });
  });

  describe('summarizeGroup', () => {
    it('should summarize a single group', async () => {
      const client = new SummarizationClient();
      const group = createGroup('test-1');
      const userDisplayNames = new Map([['U123', 'Alice']]);
      const slackLinks = new Map<string, string>();

      const result = await client.summarizeGroup(group, 'U123', userDisplayNames, slackLinks);

      expect(result.narrative_summary).toBe('Worked on implementing the feature');
      expect(result.key_events).toHaveLength(2);
      expect(result.outcome).toBe('Feature completed');
      expect(result.timesheet_entry).toBe('Feature implementation work');
      expect(result.slack_link).toBeDefined();
    });

    it('should resolve participant names', async () => {
      const client = new SummarizationClient();
      const group = createGroup('test-1', {
        participants: ['U123', 'U456', 'U789'],
      });
      const userDisplayNames = new Map([['U123', 'Alice']]);
      const slackLinks = new Map<string, string>();

      const result = await client.summarizeGroup(group, 'U123', userDisplayNames, slackLinks);

      // Should exclude the requesting user and resolve others
      expect(result.participants).toContain('@Bob');
      expect(result.participants).toContain('@Charlie');
      expect(result.participants).not.toContain('@Alice');
    });

    it('should set segments_merged when group has multiple conversations', async () => {
      const client = new SummarizationClient();
      const group = createGroup('test-1', {
        conversations: [{}, {}, {}] as ConversationGroup['conversations'],
      });
      const userDisplayNames = new Map([['U123', 'Alice']]);

      const result = await client.summarizeGroup(group, 'U123', userDisplayNames, new Map());

      expect(result.segments_merged).toBe(3);
    });

    it('should not set segments_merged for single conversation', async () => {
      const client = new SummarizationClient();
      const group = createGroup('test-1', {
        conversations: [{}] as ConversationGroup['conversations'],
      });
      const userDisplayNames = new Map([['U123', 'Alice']]);

      const result = await client.summarizeGroup(group, 'U123', userDisplayNames, new Map());

      expect(result.segments_merged).toBeUndefined();
    });
  });

  describe('summarizeGroupsBatch', () => {
    it('should return empty array for empty input', async () => {
      const client = new SummarizationClient();
      const result = await client.summarizeGroupsBatch([], 'U123', new Map(), new Map());
      expect(result).toHaveLength(0);
    });

    it('should summarize individually for <= 2 groups', async () => {
      const client = new SummarizationClient();
      const groups = [createGroup('g1'), createGroup('g2')];
      const userDisplayNames = new Map([['U123', 'Alice']]);

      const result = await client.summarizeGroupsBatch(groups, 'U123', userDisplayNames, new Map());

      expect(result).toHaveLength(2);
      // Individual summarization uses summarizeGroup which parses single response
      expect(result[0].narrative_summary).toBe('Worked on implementing the feature');
    });

    it('should batch summarize for > 2 groups', async () => {
      const client = new SummarizationClient();
      const groups = [createGroup('g1'), createGroup('g2'), createGroup('g3')];
      const userDisplayNames = new Map([['U123', 'Alice']]);

      const result = await client.summarizeGroupsBatch(groups, 'U123', userDisplayNames, new Map());

      expect(result).toHaveLength(3);
      // Batch summarization uses parseNarrativeBatchResponse
      expect(result[0].narrative_summary).toBe('First summary');
      expect(result[1].narrative_summary).toBe('Second summary');
      expect(result[2].narrative_summary).toBe('Third summary');
    });
  });

  describe('fallback handling', () => {
    it('should create fallback summary on parse failure', async () => {
      const { parseNarrativeSummaryResponse } = await import(
        '@/core/summarization/prompts.js'
      );
      vi.mocked(parseNarrativeSummaryResponse).mockReturnValueOnce(null);

      const client = new SummarizationClient();
      const group = createGroup('test-1', {
        allMessages: [
          { type: 'message', ts: '1704067200', channel: 'C123', text: 'Working on deployment', user: 'U456' },
          { type: 'message', ts: '1704067260', channel: 'C123', text: 'Deployment complete', user: 'U456' },
        ],
      });

      const result = await client.summarizeGroup(group, 'U123', new Map(), new Map());

      expect(result.narrative_summary).toContain('deployment');
      expect(result.timesheet_entry).toBeDefined();
    });

    it('should create fallback on API error', async () => {
      const { getClaudeProvider } = await import('@/core/llm/index.js');
      vi.mocked(getClaudeProvider).mockReturnValueOnce({
        getBackend: () => ({
          backendType: 'sdk' as const,
          createMessage: vi.fn().mockRejectedValue(new Error('API Error')),
        }),
      } as unknown as ReturnType<typeof getClaudeProvider>);

      const client = new SummarizationClient();
      const group = createGroup('test-1', {
        allMessages: [
          { type: 'message', ts: '1704067200', channel: 'C123', text: 'Testing code', user: 'U456' },
        ],
      });

      const result = await client.summarizeGroup(group, 'U123', new Map(), new Map());

      // Should have fallback summary
      expect(result.narrative_summary).toBeDefined();
      expect(result.timesheet_entry).toBeDefined();
    });
  });
});

describe('getSummarizationClient singleton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSummarizationClient();
  });

  it('should return same instance on multiple calls', () => {
    const client1 = getSummarizationClient();
    const client2 = getSummarizationClient();
    expect(client1).toBe(client2);
  });

  it('should create new instance after reset', () => {
    const client1 = getSummarizationClient();
    resetSummarizationClient();
    const client2 = getSummarizationClient();
    expect(client1).not.toBe(client2);
  });
});
