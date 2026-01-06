import { describe, it, expect } from 'vitest';
import {
  parseSingleSummaryResponse,
  parseBatchSummaryResponse,
  parseNarrativeSummaryResponse,
  parseNarrativeBatchResponse,
  buildConversationSummaryPrompt,
  buildBatchSummaryPrompt,
  buildNarrativeGroupPrompt,
  buildNarrativeBatchPrompt,
} from '@/core/summarization/prompts.js';
import type { Conversation } from '@/core/models/conversation.js';
import type { ConversationGroup } from '@/core/consolidation/consolidator.js';
import fixtures from '@tests/fixtures/prompts/conversation-groups.json';

describe('Summarization Prompts', () => {
  describe('parseSingleSummaryResponse', () => {
    it('should parse valid JSON response', () => {
      const response = `Here's the summary:
{
  "topic": "Deployment planning for Q1",
  "keyPoints": ["Deploy on Friday", "Need QA approval"],
  "participantUsernames": ["@alice", "@bob"]
}`;

      const result = parseSingleSummaryResponse(response);

      expect(result).not.toBeNull();
      expect(result?.topic).toBe('Deployment planning for Q1');
      expect(result?.keyPoints).toHaveLength(2);
      expect(result?.participantUsernames).toContain('@alice');
    });

    it('should handle response with extra text', () => {
      const response = `I've analyzed the conversation.

{"topic": "Bug fix discussion", "keyPoints": ["Fixed the issue"], "participantUsernames": ["@dev"]}

Hope this helps!`;

      const result = parseSingleSummaryResponse(response);

      expect(result).not.toBeNull();
      expect(result?.topic).toBe('Bug fix discussion');
    });

    it('should return null for invalid JSON', () => {
      const response = 'This is not valid JSON at all';

      const result = parseSingleSummaryResponse(response);

      expect(result).toBeNull();
    });

    it('should handle missing fields with defaults', () => {
      const response = '{"topic": "Test topic"}';

      const result = parseSingleSummaryResponse(response);

      expect(result).not.toBeNull();
      expect(result?.topic).toBe('Test topic');
      expect(result?.keyPoints).toEqual([]);
      expect(result?.participantUsernames).toEqual([]);
    });
  });

  describe('parseBatchSummaryResponse', () => {
    it('should parse valid batch response', () => {
      const response = `[
        {"index": 1, "topic": "Topic 1", "keyPoints": ["Point 1"], "participantUsernames": ["@user1"]},
        {"index": 2, "topic": "Topic 2", "keyPoints": ["Point 2"], "participantUsernames": ["@user2"]}
      ]`;

      const result = parseBatchSummaryResponse(response);

      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);
      expect(result?.[0].topic).toBe('Topic 1');
      expect(result?.[1].topic).toBe('Topic 2');
    });

    it('should handle response with surrounding text', () => {
      const response = `Here are the summaries:
[{"index": 1, "topic": "Test", "keyPoints": [], "participantUsernames": []}]
Done!`;

      const result = parseBatchSummaryResponse(response);

      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
    });

    it('should return null for invalid JSON', () => {
      const response = 'Not a JSON array';

      const result = parseBatchSummaryResponse(response);

      expect(result).toBeNull();
    });

    it('should handle missing fields with defaults', () => {
      const response = '[{"index": 1, "topic": "Only topic"}]';

      const result = parseBatchSummaryResponse(response);

      expect(result).not.toBeNull();
      expect(result?.[0].keyPoints).toEqual([]);
      expect(result?.[0].participantUsernames).toEqual([]);
    });
  });

  describe('parseNarrativeSummaryResponse', () => {
    it('should parse valid narrative response', () => {
      const response = `Here's the summary:
{
  "narrative": "Worked on fixing the deployment bug",
  "keyEvents": ["Identified root cause", "Applied fix"],
  "references": ["PROJ-123"],
  "participants": ["@alice"],
  "outcome": "Bug resolved",
  "nextActions": ["Deploy to staging tomorrow"],
  "timesheetEntry": "Fixed deployment bug in auth service"
}`;

      const result = parseNarrativeSummaryResponse(response);

      expect(result).not.toBeNull();
      expect(result?.narrative).toBe('Worked on fixing the deployment bug');
      expect(result?.keyEvents).toHaveLength(2);
      expect(result?.references).toContain('PROJ-123');
      expect(result?.participants).toContain('@alice');
      expect(result?.outcome).toBe('Bug resolved');
      expect(result?.nextActions).toHaveLength(1);
      expect(result?.timesheetEntry).toBe('Fixed deployment bug in auth service');
    });

    it('should handle missing fields with defaults', () => {
      const response = '{"narrative": "Just a narrative"}';

      const result = parseNarrativeSummaryResponse(response);

      expect(result).not.toBeNull();
      expect(result?.narrative).toBe('Just a narrative');
      expect(result?.keyEvents).toEqual([]);
      expect(result?.references).toEqual([]);
      expect(result?.participants).toEqual([]);
      expect(result?.outcome).toBeNull();
      expect(result?.nextActions).toEqual([]);
      expect(result?.timesheetEntry).toBe('Activity summary');
    });

    it('should return null for invalid JSON', () => {
      const response = 'Not valid JSON';

      const result = parseNarrativeSummaryResponse(response);

      expect(result).toBeNull();
    });

    it('should handle response with extra text', () => {
      const response = `Analysis complete.
{"narrative": "Reviewed PR", "keyEvents": [], "references": [], "participants": [], "outcome": null, "nextActions": [], "timesheetEntry": "PR review"}
Done!`;

      const result = parseNarrativeSummaryResponse(response);

      expect(result).not.toBeNull();
      expect(result?.narrative).toBe('Reviewed PR');
    });
  });

  describe('parseNarrativeBatchResponse', () => {
    it('should parse valid batch narrative response', () => {
      const response = `[
        {
          "index": 1,
          "narrative": "Topic 1 narrative",
          "keyEvents": ["Event 1"],
          "references": ["REF-1"],
          "participants": ["@bob"],
          "outcome": "Completed",
          "nextActions": [],
          "timesheetEntry": "Worked on topic 1"
        },
        {
          "index": 2,
          "narrative": "Topic 2 narrative",
          "keyEvents": [],
          "references": [],
          "participants": [],
          "outcome": null,
          "nextActions": ["Follow up"],
          "timesheetEntry": "Discussed topic 2"
        }
      ]`;

      const result = parseNarrativeBatchResponse(response);

      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);
      expect(result?.[0].narrative).toBe('Topic 1 narrative');
      expect(result?.[1].nextActions).toContain('Follow up');
    });

    it('should handle missing fields with defaults', () => {
      const response = '[{"index": 1, "narrative": "Only narrative"}]';

      const result = parseNarrativeBatchResponse(response);

      expect(result).not.toBeNull();
      expect(result?.[0].keyEvents).toEqual([]);
      expect(result?.[0].outcome).toBeNull();
      expect(result?.[0].timesheetEntry).toBe('Activity summary');
    });

    it('should return null for invalid JSON', () => {
      const response = 'Not a JSON array';

      const result = parseNarrativeBatchResponse(response);

      expect(result).toBeNull();
    });
  });

  describe('buildConversationSummaryPrompt', () => {
    const mockConversation: Conversation = {
      id: 'conv-1',
      channelId: 'C123',
      channelName: 'general',
      messages: [
        { type: 'message', ts: '1', text: 'Hello world', user: 'U123', channel: 'C123' },
        { type: 'message', ts: '2', text: 'Hi there', user: 'U456', channel: 'C123' },
      ],
      startTime: '2024-01-01T10:00:00Z',
      endTime: '2024-01-01T10:30:00Z',
      participants: ['U123', 'U456'],
      messageCount: 2,
      userMessageCount: 1,
      isThread: false,
    };

    const userDisplayNames = new Map([
      ['U123', 'Alice'],
      ['U456', 'Bob'],
    ]);

    it('should include channel name in prompt', () => {
      const prompt = buildConversationSummaryPrompt(mockConversation, userDisplayNames);

      expect(prompt).toContain('#general');
    });

    it('should include time range', () => {
      const prompt = buildConversationSummaryPrompt(mockConversation, userDisplayNames);

      expect(prompt).toContain('2024-01-01T10:00:00Z');
      expect(prompt).toContain('2024-01-01T10:30:00Z');
    });

    it('should include message count', () => {
      const prompt = buildConversationSummaryPrompt(mockConversation, userDisplayNames);

      expect(prompt).toContain('Message Count: 2');
    });

    it('should include participant count', () => {
      const prompt = buildConversationSummaryPrompt(mockConversation, userDisplayNames);

      expect(prompt).toContain('Participants: 2');
    });

    it('should use display names in messages', () => {
      const prompt = buildConversationSummaryPrompt(mockConversation, userDisplayNames);

      expect(prompt).toContain('[Alice]:');
      expect(prompt).toContain('[Bob]:');
    });

    it('should indicate thread conversations', () => {
      const threadConv = { ...mockConversation, isThread: true };
      const prompt = buildConversationSummaryPrompt(threadConv, userDisplayNames);

      expect(prompt).toContain('(Thread)');
    });

    it('should use channel ID when name not available', () => {
      const convNoName = { ...mockConversation, channelName: '' };
      const prompt = buildConversationSummaryPrompt(convNoName, userDisplayNames);

      expect(prompt).toContain('Channel ID: C123');
    });

    it('should request JSON output', () => {
      const prompt = buildConversationSummaryPrompt(mockConversation, userDisplayNames);

      expect(prompt).toContain('JSON response');
      expect(prompt).toContain('"topic"');
      expect(prompt).toContain('"keyPoints"');
    });
  });

  describe('buildBatchSummaryPrompt', () => {
    const mockConversations: Conversation[] = [
      {
        id: 'conv-1',
        channelId: 'C123',
        channelName: 'general',
        messages: [
          { type: 'message', ts: '1', text: 'First message', user: 'U123', channel: 'C123' },
        ],
        startTime: '2024-01-01T10:00:00Z',
        endTime: '2024-01-01T10:30:00Z',
        participants: ['U123'],
        messageCount: 1,
        userMessageCount: 1,
        isThread: false,
      },
      {
        id: 'conv-2',
        channelId: 'C456',
        channelName: 'random',
        messages: [
          { type: 'message', ts: '2', text: 'Second message', user: 'U456', channel: 'C456' },
        ],
        startTime: '2024-01-01T11:00:00Z',
        endTime: '2024-01-01T11:30:00Z',
        participants: ['U456'],
        messageCount: 1,
        userMessageCount: 1,
        isThread: false,
      },
    ];

    const userDisplayNames = new Map([
      ['U123', 'Alice'],
      ['U456', 'Bob'],
    ]);

    it('should include both conversations', () => {
      const prompt = buildBatchSummaryPrompt(mockConversations, userDisplayNames);

      expect(prompt).toContain('Conversation 1');
      expect(prompt).toContain('Conversation 2');
    });

    it('should include channel names', () => {
      const prompt = buildBatchSummaryPrompt(mockConversations, userDisplayNames);

      expect(prompt).toContain('#general');
      expect(prompt).toContain('#random');
    });

    it('should include message counts', () => {
      const prompt = buildBatchSummaryPrompt(mockConversations, userDisplayNames);

      expect(prompt).toContain('1 messages');
    });

    it('should request JSON array output', () => {
      const prompt = buildBatchSummaryPrompt(mockConversations, userDisplayNames);

      expect(prompt).toContain('JSON response');
      expect(prompt).toContain('[');
      expect(prompt).toContain('"index"');
    });
  });

  describe('buildNarrativeGroupPrompt', () => {
    // Helper to convert fixture userDisplayNames object to Map
    function toDisplayMap(obj: Record<string, string>): Map<string, string> {
      return new Map(Object.entries(obj));
    }

    describe('basic conversation group', () => {
      const { group, userDisplayNames } = fixtures.basicGroup;
      const displayMap = toDisplayMap(userDisplayNames);

      it('should include channel name', () => {
        const prompt = buildNarrativeGroupPrompt(group as ConversationGroup, 'Bob', displayMap);
        expect(prompt).toContain('#engineering');
      });

      it('should include time range', () => {
        const prompt = buildNarrativeGroupPrompt(group as ConversationGroup, 'Bob', displayMap);
        expect(prompt).toContain('2024-01-01T10:00:00Z');
        expect(prompt).toContain('2024-01-01T10:02:00Z');
      });

      it('should include message count', () => {
        const prompt = buildNarrativeGroupPrompt(group as ConversationGroup, 'Bob', displayMap);
        expect(prompt).toContain('Total Messages: 3');
      });

      it('should resolve user IDs to display names', () => {
        const prompt = buildNarrativeGroupPrompt(group as ConversationGroup, 'Bob', displayMap);
        expect(prompt).toContain('[Alice]:');
        expect(prompt).toContain('[Bob]:');
      });

      it('should include the target user name in perspective instructions', () => {
        const prompt = buildNarrativeGroupPrompt(group as ConversationGroup, 'Bob', displayMap);
        expect(prompt).toContain("for Bob");
        expect(prompt).toContain("from Bob's perspective");
      });

      it('should request JSON response with narrative structure', () => {
        const prompt = buildNarrativeGroupPrompt(group as ConversationGroup, 'Bob', displayMap);
        expect(prompt).toContain('"narrative"');
        expect(prompt).toContain('"keyEvents"');
        expect(prompt).toContain('"references"');
        expect(prompt).toContain('"participants"');
        expect(prompt).toContain('"outcome"');
        expect(prompt).toContain('"nextActions"');
        expect(prompt).toContain('"timesheetEntry"');
      });
    });

    describe('group with context messages', () => {
      const { group, userDisplayNames } = fixtures.groupWithContextMessages;
      const displayMap = toDisplayMap(userDisplayNames);

      it('should include PRIOR CONTEXT marker for mention_context messages', () => {
        const prompt = buildNarrativeGroupPrompt(group as ConversationGroup, 'Dana', displayMap);
        expect(prompt).toContain('[PRIOR CONTEXT]');
      });

      it('should include context instructions when context messages present', () => {
        const prompt = buildNarrativeGroupPrompt(group as ConversationGroup, 'Dana', displayMap);
        expect(prompt).toContain('IMPORTANT - Context Messages');
        expect(prompt).toContain('[PRIOR CONTEXT]');
        expect(prompt).toContain('NOT Dana\'s activity');
      });

      it('should resolve user mentions in message text', () => {
        const prompt = buildNarrativeGroupPrompt(group as ConversationGroup, 'Dana', displayMap);
        // The message "<@U222222> can you help" should become "@Dana can you help"
        expect(prompt).toContain('@Dana');
      });
    });

    describe('group with attachments', () => {
      const { group, userDisplayNames } = fixtures.groupWithAttachments;
      const displayMap = toDisplayMap(userDisplayNames);

      it('should format attachment from URL', () => {
        const prompt = buildNarrativeGroupPrompt(group as ConversationGroup, 'Grace', displayMap);
        expect(prompt).toContain('[Shared link]');
        expect(prompt).toContain('new metrics panel');
      });

      it('should format shared message attachments with author info', () => {
        const prompt = buildNarrativeGroupPrompt(group as ConversationGroup, 'Grace', displayMap);
        expect(prompt).toContain('[Shared message');
        expect(prompt).toContain('from Elena');
        expect(prompt).toContain('in #product');
      });
    });

    describe('group with bot messages', () => {
      const { group, userDisplayNames } = fixtures.groupWithBotMessages;
      const displayMap = toDisplayMap(userDisplayNames);

      it('should label bot messages as Bot', () => {
        const prompt = buildNarrativeGroupPrompt(group as ConversationGroup, 'Henry', displayMap);
        expect(prompt).toContain('[Bot]:');
      });

      it('should include bot message content', () => {
        const prompt = buildNarrativeGroupPrompt(group as ConversationGroup, 'Henry', displayMap);
        expect(prompt).toContain('CircleCI');
        expect(prompt).toContain('Build #456');
      });

      it('should include shared references', () => {
        const prompt = buildNarrativeGroupPrompt(group as ConversationGroup, 'Henry', displayMap);
        expect(prompt).toContain('Detected references: #456');
      });
    });

    describe('group with threads', () => {
      const { group, userDisplayNames } = fixtures.groupWithThreads;
      const displayMap = toDisplayMap(userDisplayNames);

      it('should indicate thread replies in channel info', () => {
        const prompt = buildNarrativeGroupPrompt(group as ConversationGroup, 'Julia', displayMap);
        expect(prompt).toContain('includes thread replies');
      });
    });

    describe('group with references', () => {
      const { group, userDisplayNames } = fixtures.groupWithReferences;
      const displayMap = toDisplayMap(userDisplayNames);

      it('should include detected references', () => {
        const prompt = buildNarrativeGroupPrompt(group as ConversationGroup, 'Kate', displayMap);
        expect(prompt).toContain('Detected references:');
        expect(prompt).toContain('PROJ-789');
        expect(prompt).toContain('#456');
      });
    });

    describe('edge cases', () => {
      it('should handle missing channel name gracefully', () => {
        const group: ConversationGroup = {
          id: 'test-group',
          conversations: [
            {
              id: 'conv-1',
              channelId: 'C999999',
              messages: [],
              startTime: '2024-01-01T10:00:00Z',
              endTime: '2024-01-01T10:00:00Z',
              participants: [],
              messageCount: 0,
              userMessageCount: 0,
              isThread: false,
            },
          ],
          sharedReferences: [],
          allMessages: [],
          startTime: '2024-01-01T10:00:00Z',
          endTime: '2024-01-01T10:00:00Z',
          participants: [],
          totalMessageCount: 0,
          totalUserMessageCount: 0,
          hasThreads: false,
          originalConversationIds: ['conv-1'],
        };

        const prompt = buildNarrativeGroupPrompt(group, 'TestUser', new Map());
        expect(prompt).toContain('C999999');
      });

      it('should handle unknown user IDs', () => {
        const group: ConversationGroup = {
          id: 'test-group',
          conversations: [],
          sharedReferences: [],
          allMessages: [
            {
              type: 'message',
              ts: '1704067200.000000',
              channel: 'C123',
              text: 'Hello from unknown user',
              user: 'UUNKNOWN',
            },
          ],
          startTime: '2024-01-01T10:00:00Z',
          endTime: '2024-01-01T10:00:00Z',
          participants: ['UUNKNOWN'],
          totalMessageCount: 1,
          totalUserMessageCount: 1,
          hasThreads: false,
          originalConversationIds: [],
        };

        const prompt = buildNarrativeGroupPrompt(group, 'TestUser', new Map());
        // Should fall back to user ID when display name not found
        expect(prompt).toContain('[UUNKNOWN]:');
      });

      it('should handle messages with no text', () => {
        const group: ConversationGroup = {
          id: 'test-group',
          conversations: [],
          sharedReferences: [],
          allMessages: [
            {
              type: 'message',
              ts: '1704067200.000000',
              channel: 'C123',
              user: 'U123',
            },
          ],
          startTime: '2024-01-01T10:00:00Z',
          endTime: '2024-01-01T10:00:00Z',
          participants: ['U123'],
          totalMessageCount: 1,
          totalUserMessageCount: 1,
          hasThreads: false,
          originalConversationIds: [],
        };

        const displayMap = new Map([['U123', 'TestUser']]);
        const prompt = buildNarrativeGroupPrompt(group, 'TestUser', displayMap);
        expect(prompt).toContain('[no text]');
      });
    });
  });

  describe('buildNarrativeBatchPrompt', () => {
    function toDisplayMap(obj: Record<string, string>): Map<string, string> {
      return new Map(Object.entries(obj));
    }

    it('should include multiple groups with topic numbers', () => {
      const group1 = fixtures.basicGroup.group as ConversationGroup;
      const group2 = fixtures.groupWithBotMessages.group as ConversationGroup;

      const combinedDisplayNames = {
        ...fixtures.basicGroup.userDisplayNames,
        ...fixtures.groupWithBotMessages.userDisplayNames,
      };
      const displayMap = toDisplayMap(combinedDisplayNames);

      const prompt = buildNarrativeBatchPrompt([group1, group2], 'TestUser', displayMap);

      expect(prompt).toContain('Topic 1');
      expect(prompt).toContain('Topic 2');
    });

    it('should include channel info for each group', () => {
      const group1 = fixtures.basicGroup.group as ConversationGroup;
      const group2 = fixtures.groupWithReferences.group as ConversationGroup;

      const combinedDisplayNames = {
        ...fixtures.basicGroup.userDisplayNames,
        ...fixtures.groupWithReferences.userDisplayNames,
      };
      const displayMap = toDisplayMap(combinedDisplayNames);

      const prompt = buildNarrativeBatchPrompt([group1, group2], 'TestUser', displayMap);

      expect(prompt).toContain('#engineering');
      expect(prompt).toContain('#eng-frontend');
    });

    it('should include message counts per group', () => {
      const group1 = fixtures.basicGroup.group as ConversationGroup;

      const displayMap = toDisplayMap(fixtures.basicGroup.userDisplayNames);
      const prompt = buildNarrativeBatchPrompt([group1], 'TestUser', displayMap);

      expect(prompt).toContain('3 messages');
    });

    it('should include thread indicator for thread groups', () => {
      const threadGroup = fixtures.groupWithThreads.group as ConversationGroup;

      const displayMap = toDisplayMap(fixtures.groupWithThreads.userDisplayNames);
      const prompt = buildNarrativeBatchPrompt([threadGroup], 'TestUser', displayMap);

      expect(prompt).toContain('(thread)');
    });

    it('should include references hint', () => {
      const refGroup = fixtures.groupWithReferences.group as ConversationGroup;

      const displayMap = toDisplayMap(fixtures.groupWithReferences.userDisplayNames);
      const prompt = buildNarrativeBatchPrompt([refGroup], 'Kate', displayMap);

      expect(prompt).toContain('refs: PROJ-789');
    });

    it('should include context instructions when groups have context messages', () => {
      const contextGroup = fixtures.groupWithContextMessages.group as ConversationGroup;

      const displayMap = toDisplayMap(fixtures.groupWithContextMessages.userDisplayNames);
      const prompt = buildNarrativeBatchPrompt([contextGroup], 'Dana', displayMap);

      expect(prompt).toContain('IMPORTANT - Context Messages');
    });

    it('should request JSON array response', () => {
      const group = fixtures.basicGroup.group as ConversationGroup;

      const displayMap = toDisplayMap(fixtures.basicGroup.userDisplayNames);
      const prompt = buildNarrativeBatchPrompt([group], 'Bob', displayMap);

      expect(prompt).toContain('[');
      expect(prompt).toContain('"index": 1');
      expect(prompt).toContain('"narrative"');
    });

    it('should use target user name in instructions', () => {
      const group = fixtures.basicGroup.group as ConversationGroup;

      const displayMap = toDisplayMap(fixtures.basicGroup.userDisplayNames);
      const prompt = buildNarrativeBatchPrompt([group], 'Bob', displayMap);

      expect(prompt).toContain('for Bob');
      expect(prompt).toContain("Bob's perspective");
    });

    it('should limit messages per group for batch processing', () => {
      // Create a group with many messages
      const manyMessages = Array.from({ length: 50 }, (_, i) => ({
        type: 'message' as const,
        ts: `1704067200.${String(i).padStart(6, '0')}`,
        channel: 'C123',
        text: `Message number ${i}`,
        user: 'U123',
      }));

      const largeGroup: ConversationGroup = {
        id: 'large-group',
        conversations: [],
        sharedReferences: [],
        allMessages: manyMessages,
        startTime: '2024-01-01T10:00:00Z',
        endTime: '2024-01-01T11:00:00Z',
        participants: ['U123'],
        totalMessageCount: 50,
        totalUserMessageCount: 50,
        hasThreads: false,
        originalConversationIds: [],
      };

      const displayMap = new Map([['U123', 'TestUser']]);
      const prompt = buildNarrativeBatchPrompt([largeGroup], 'TestUser', displayMap);

      // Should not contain message 40+ (batch limits to 30 messages)
      expect(prompt).not.toContain('Message number 40');
      // But should contain early messages
      expect(prompt).toContain('Message number 0');
    });
  });
});
