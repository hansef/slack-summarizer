/**
 * Tests for the conversation consolidation algorithm.
 *
 * The consolidator uses a Union-Find data structure to group related conversations.
 * It applies multiple merge strategies in sequence:
 * 1. Bot conversation merging - bots merge into adjacent human conversations
 * 2. Trivial conversation handling - short ack messages merge or get dropped
 * 3. Adjacent merge - very close conversations (<15 min) merge unconditionally
 * 4. Proximity merge - same author + close time + min similarity
 * 5. Same-author merge - user participated in both + longer time + min similarity
 * 6. Reference/embedding merge - shared references/similarity above threshold
 */

import { describe, it, expect } from 'vitest';
import { consolidateConversations } from '@/core/consolidation/consolidator.js';
import type { Conversation } from '@/core/models/conversation.js';
import type { SlackMessage } from '@/core/models/slack.js';

// Config to disable trivial dropping for cleaner tests
// Most tests want to focus on merge strategies, not trivial filtering
const noTrivialDropping = {
  trivial: {
    dropOrphans: false,
  },
};

// Helper to create a conversation
function createConv(
  id: string,
  startTime: string,
  endTime: string,
  text: string,
  opts?: { user?: string; participants?: string[]; isBot?: boolean; messageCount?: number }
): Conversation {
  const user = opts?.user ?? 'U123';
  const messages: SlackMessage[] = [];
  const count = opts?.messageCount ?? 1;

  for (let i = 0; i < count; i++) {
    messages.push({
      type: 'message',
      ts: `1704067200.${String(i).padStart(6, '0')}`,
      channel: 'C123',
      text: count > 1 ? `${text} (${i + 1})` : text,
      user,
      subtype: opts?.isBot ? 'bot_message' : undefined,
    });
  }

  return {
    id,
    channelId: 'C123',
    channelName: 'general',
    isThread: false,
    messages,
    startTime,
    endTime,
    participants: opts?.participants ?? [user],
    messageCount: count,
    userMessageCount: count,
  };
}

describe('consolidateConversations', () => {
  describe('empty and single conversation', () => {
    it('should handle empty input', async () => {
      const result = await consolidateConversations([]);
      expect(result.groups).toHaveLength(0);
      expect(result.stats.originalConversations).toBe(0);
    });

    it('should handle single conversation (not trivial due to multiple messages)', async () => {
      // Conversations with 3+ messages are not trivial regardless of text length
      const conv = createConv(
        'test',
        '2024-01-01T10:00:00Z',
        '2024-01-01T10:05:00Z',
        'Discussion',
        { messageCount: 3 }
      );
      const result = await consolidateConversations([conv]);
      expect(result.groups).toHaveLength(1);
      expect(result.stats.originalConversations).toBe(1);
    });

    it('should handle single conversation with noTrivialDropping', async () => {
      const conv = createConv('test', '2024-01-01T10:00:00Z', '2024-01-01T10:05:00Z', 'Hi');
      const result = await consolidateConversations([conv], noTrivialDropping);
      expect(result.groups).toHaveLength(1);
    });
  });

  describe('bot conversation merging', () => {
    it('should merge bot conversation into adjacent human conversation', async () => {
      const human = createConv(
        'human-1',
        '2024-01-01T10:00:00Z',
        '2024-01-01T10:05:00Z',
        'Deploy to production - this is a longer message to avoid trivial handling',
        { messageCount: 3 }
      );

      const bot = createConv(
        'bot-1',
        '2024-01-01T10:06:00Z',
        '2024-01-01T10:08:00Z',
        'Deployment complete',
        { isBot: true, user: 'B123', participants: ['B123'], messageCount: 2 }
      );

      const result = await consolidateConversations([human, bot]);

      expect(result.groups).toHaveLength(1);
      expect(result.stats.botConversationsMerged).toBe(1);
      expect(result.groups[0].totalMessageCount).toBe(5);
    });

    it('should keep isolated bot conversation separate', async () => {
      const human1 = createConv(
        'human-1',
        '2024-01-01T08:00:00Z',
        '2024-01-01T08:10:00Z',
        'Morning standup discussion',
        { messageCount: 5 }
      );

      // Bot 2+ hours later - outside merge window
      const bot = createConv(
        'bot-1',
        '2024-01-01T10:30:00Z',
        '2024-01-01T10:31:00Z',
        'Scheduled backup complete',
        { isBot: true, user: 'B123', participants: ['B123'] }
      );

      const human2 = createConv(
        'human-2',
        '2024-01-01T13:00:00Z',
        '2024-01-01T13:10:00Z',
        'Afternoon planning meeting',
        { messageCount: 5 }
      );

      const result = await consolidateConversations([human1, bot, human2], noTrivialDropping);
      expect(result.stats.botConversationsMerged).toBe(0);
    });
  });

  describe('trivial conversation handling', () => {
    it('should merge trivial into adjacent substantive', async () => {
      const substantive = createConv(
        'substantive',
        '2024-01-01T10:00:00Z',
        '2024-01-01T10:10:00Z',
        'Working on the feature',
        { messageCount: 5 }
      );

      const trivial = createConv(
        'trivial',
        '2024-01-01T10:15:00Z',
        '2024-01-01T10:15:00Z',
        'ok'
      );

      const result = await consolidateConversations([substantive, trivial]);

      expect(result.groups).toHaveLength(1);
      expect(result.stats.trivialConversationsMerged).toBe(1);
    });

    it('should drop orphan trivial messages', async () => {
      const conv1 = createConv(
        'conv-1',
        '2024-01-01T08:00:00Z',
        '2024-01-01T08:10:00Z',
        'Morning work',
        { messageCount: 5 }
      );

      // Trivial far from others
      const trivial = createConv(
        'trivial-orphan',
        '2024-01-01T14:00:00Z',
        '2024-01-01T14:00:00Z',
        'k'
      );

      const conv2 = createConv(
        'conv-2',
        '2024-01-01T18:00:00Z',
        '2024-01-01T18:10:00Z',
        'Evening work',
        { messageCount: 5 }
      );

      const result = await consolidateConversations([conv1, trivial, conv2]);
      expect(result.stats.trivialConversationsDropped).toBe(1);
    });

    it('should preserve trivial with work indicators', async () => {
      const conv = createConv(
        'conv-1',
        '2024-01-01T08:00:00Z',
        '2024-01-01T08:10:00Z',
        'Working on the feature',
        { messageCount: 5 }
      );

      const workIndicator = createConv(
        'work',
        '2024-01-01T14:00:00Z',
        '2024-01-01T14:00:00Z',
        'merged' // Work indicator pattern
      );

      const result = await consolidateConversations([conv, workIndicator]);
      expect(result.stats.trivialConversationsDropped).toBe(0);
    });
  });

  describe('adjacent merge', () => {
    it('should merge conversations within 15 min gap', async () => {
      const conv1 = createConv(
        'conv-1',
        '2024-01-01T10:00:00Z',
        '2024-01-01T10:05:00Z',
        'Topic A',
        { messageCount: 3 }
      );

      // 10 minutes later
      const conv2 = createConv(
        'conv-2',
        '2024-01-01T10:15:00Z',
        '2024-01-01T10:20:00Z',
        'Topic B',
        { user: 'U456', participants: ['U456'], messageCount: 3 }
      );

      const result = await consolidateConversations([conv1, conv2], noTrivialDropping);

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].originalConversationIds).toContain('conv-1');
      expect(result.groups[0].originalConversationIds).toContain('conv-2');
    });

    it('should NOT merge with gap > 15 min', async () => {
      const conv1 = createConv(
        'conv-1',
        '2024-01-01T10:00:00Z',
        '2024-01-01T10:05:00Z',
        'Topic A',
        { messageCount: 3 }
      );

      // 30 minutes later
      const conv2 = createConv(
        'conv-2',
        '2024-01-01T10:35:00Z',
        '2024-01-01T10:40:00Z',
        'Unrelated topic',
        { user: 'U456', participants: ['U456'], messageCount: 3 }
      );

      const result = await consolidateConversations([conv1, conv2], noTrivialDropping);
      expect(result.groups).toHaveLength(2);
    });
  });

  describe('same-author / proximity merge', () => {
    it('should merge requesting user conversations with shared references', async () => {
      const conv1 = createConv(
        'conv-1',
        '2024-01-01T10:00:00Z',
        '2024-01-01T10:15:00Z',
        'Working on #123',
        { messageCount: 3 }
      );

      const conv2 = createConv(
        'conv-2',
        '2024-01-01T12:00:00Z',
        '2024-01-01T12:15:00Z',
        'Continuing #123 work',
        { messageCount: 3 }
      );

      const result = await consolidateConversations([conv1, conv2], {
        ...noTrivialDropping,
        requestingUserId: 'U123',
      });

      expect(result.groups).toHaveLength(1);
    });
  });

  describe('reference-based merge', () => {
    it('should group conversations with shared references', async () => {
      const conv1 = createConv(
        'conv-1',
        '2024-01-01T10:00:00Z',
        '2024-01-01T10:15:00Z',
        'Started PROJ-456',
        { messageCount: 3 }
      );

      const conv2 = createConv(
        'conv-2',
        '2024-01-01T13:00:00Z',
        '2024-01-01T13:15:00Z',
        'PROJ-456 is ready for review',
        { user: 'U456', participants: ['U456'], messageCount: 3 }
      );

      const result = await consolidateConversations([conv1, conv2], noTrivialDropping);
      expect(result.groups).toHaveLength(1);
    });

    it('should keep unrelated conversations separate', async () => {
      const conv1 = createConv(
        'conv-1',
        '2024-01-01T10:00:00Z',
        '2024-01-01T10:15:00Z',
        'Working on #100',
        { messageCount: 3 }
      );

      const conv2 = createConv(
        'conv-2',
        '2024-01-01T14:00:00Z',
        '2024-01-01T14:15:00Z',
        'Different topic #200',
        { user: 'U456', participants: ['U456'], messageCount: 3 }
      );

      const result = await consolidateConversations([conv1, conv2], noTrivialDropping);
      expect(result.groups).toHaveLength(2);
    });
  });

  describe('Union-Find correctness', () => {
    it('should properly group transitive relationships', async () => {
      // A shares #123 with B, B shares AUTH-456 with C
      // All should end up in same group
      const convA = createConv(
        'A',
        '2024-01-01T10:00:00Z',
        '2024-01-01T10:15:00Z',
        'Working on #123',
        { messageCount: 3 }
      );

      const convB = createConv(
        'B',
        '2024-01-01T11:00:00Z',
        '2024-01-01T11:15:00Z',
        'Fixed #123, found issue AUTH-456',
        { messageCount: 3 }
      );

      const convC = createConv(
        'C',
        '2024-01-01T12:00:00Z',
        '2024-01-01T12:15:00Z',
        'AUTH-456 deployed',
        { user: 'U456', participants: ['U456'], messageCount: 3 }
      );

      const result = await consolidateConversations([convA, convB, convC], {
        ...noTrivialDropping,
        requestingUserId: 'U123',
      });

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].originalConversationIds).toContain('A');
      expect(result.groups[0].originalConversationIds).toContain('B');
      expect(result.groups[0].originalConversationIds).toContain('C');
    });
  });

  describe('output structure', () => {
    it('should include all required fields in group', async () => {
      const conv = createConv(
        'test',
        '2024-01-01T10:00:00Z',
        '2024-01-01T10:30:00Z',
        'Test #123 message',
        { messageCount: 3, participants: ['U123', 'U456'] }
      );

      const result = await consolidateConversations([conv], noTrivialDropping);
      const group = result.groups[0];

      expect(group.id).toBeDefined();
      expect(group.conversations).toHaveLength(1);
      expect(group.sharedReferences).toBeDefined();
      expect(group.allMessages).toBeDefined();
      expect(group.startTime).toBe('2024-01-01T10:00:00Z');
      expect(group.endTime).toBe('2024-01-01T10:30:00Z');
      expect(group.participants).toContain('U123');
      expect(group.totalMessageCount).toBe(3);
      expect(group.originalConversationIds).toContain('test');
    });

    it('should aggregate references across merged conversations', async () => {
      const conv1 = createConv(
        'conv-1',
        '2024-01-01T10:00:00Z',
        '2024-01-01T10:10:00Z',
        'Working on #100 and PROJ-200',
        { messageCount: 3 }
      );

      const conv2 = createConv(
        'conv-2',
        '2024-01-01T10:15:00Z',
        '2024-01-01T10:20:00Z',
        '#100 done, also #300',
        { messageCount: 3 }
      );

      const result = await consolidateConversations([conv1, conv2], {
        ...noTrivialDropping,
        requestingUserId: 'U123',
      });

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].sharedReferences).toContain('#100');
    });
  });
});
