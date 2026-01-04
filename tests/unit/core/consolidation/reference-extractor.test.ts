import { describe, it, expect } from 'vitest';
import {
  extractReferencesFromMessage,
  extractReferencesFromConversation,
  calculateReferenceSimilarity,
  getRefsForSimilarity,
  parseSlackMessageLinks,
} from '../../../../src/core/consolidation/reference-extractor.js';
import { SlackMessage } from '../../../../src/core/models/slack.js';
import { Conversation } from '../../../../src/core/models/conversation.js';

function createMessage(text: string, ts = '1234.5678'): SlackMessage {
  return {
    type: 'message',
    ts,
    channel: 'C123',
    text,
    user: 'U123',
  };
}

function createConversation(messages: SlackMessage[]): Conversation {
  return {
    id: 'conv-1',
    channelId: 'C123',
    channelName: 'general',
    isThread: false,
    messages,
    startTime: '2024-01-01T10:00:00Z',
    endTime: '2024-01-01T10:30:00Z',
    participants: ['U123'],
    messageCount: messages.length,
    userMessageCount: messages.length,
  };
}

describe('Reference Extractor', () => {
  describe('extractReferencesFromMessage', () => {
    describe('user mentions', () => {
      it('should extract mention with display name', () => {
        const msg = createMessage('Hey <@U12345|Chelsea> can you help?');
        const refs = extractReferencesFromMessage(msg);

        expect(refs).toContainEqual({
          type: 'user_mention',
          value: 'U12345',
          raw: '<@U12345|Chelsea>',
          messageTs: '1234.5678',
        });
      });

      it('should extract mention without display name', () => {
        const msg = createMessage('CC <@U67890>');
        const refs = extractReferencesFromMessage(msg);

        expect(refs).toContainEqual({
          type: 'user_mention',
          value: 'U67890',
          raw: '<@U67890>',
          messageTs: '1234.5678',
        });
      });

      it('should extract multiple mentions', () => {
        const msg = createMessage('<@U111> and <@U222|Bob> discuss');
        const refs = extractReferencesFromMessage(msg);

        const mentions = refs.filter((r) => r.type === 'user_mention');
        expect(mentions).toHaveLength(2);
        expect(mentions.map((m) => m.value)).toEqual(['U111', 'U222']);
      });

      it('should not match plain @username text', () => {
        const msg = createMessage('Email @chelsea.com or @team');
        const refs = extractReferencesFromMessage(msg);

        const mentions = refs.filter((r) => r.type === 'user_mention');
        expect(mentions).toHaveLength(0);
      });

      it('should extract Slackbot mentions', () => {
        const msg = createMessage('<@USLACKBOT|slackbot> reminder');
        const refs = extractReferencesFromMessage(msg);

        expect(refs).toContainEqual({
          type: 'user_mention',
          value: 'USLACKBOT',
          raw: '<@USLACKBOT|slackbot>',
          messageTs: '1234.5678',
        });
      });
    });

    describe('GitHub issues', () => {
      it('should extract #123 style issues', () => {
        const msg = createMessage('Fixed #123');
        const refs = extractReferencesFromMessage(msg);

        expect(refs).toContainEqual({
          type: 'github_issue',
          value: '#123',
          raw: '#123',
          messageTs: '1234.5678',
        });
      });

      it('should extract repo#123 style issues', () => {
        const msg = createMessage('See org/repo#456');
        const refs = extractReferencesFromMessage(msg);

        expect(refs).toContainEqual({
          type: 'github_issue',
          value: '#456',
          raw: 'org/repo#456',
          messageTs: '1234.5678',
        });
      });
    });

    describe('Jira tickets', () => {
      it('should extract JIRA-123 style tickets', () => {
        const msg = createMessage('Working on AUTH-456');
        const refs = extractReferencesFromMessage(msg);

        expect(refs).toContainEqual({
          type: 'jira_ticket',
          value: 'AUTH-456',
          raw: 'AUTH-456',
          messageTs: '1234.5678',
        });
      });
    });

    describe('error patterns', () => {
      it('should extract PascalCase errors', () => {
        const msg = createMessage('Got NetworkError');
        const refs = extractReferencesFromMessage(msg);

        expect(refs).toContainEqual({
          type: 'error_pattern',
          value: 'networkerror',
          raw: 'NetworkError',
          messageTs: '1234.5678',
        });
      });
    });

    describe('combined extraction', () => {
      it('should extract all reference types from a message', () => {
        const msg = createMessage(
          '<@U123|Alice> the #456 issue caused NetworkError, see AUTH-789'
        );
        const refs = extractReferencesFromMessage(msg);

        expect(refs.filter((r) => r.type === 'user_mention')).toHaveLength(1);
        expect(refs.filter((r) => r.type === 'github_issue')).toHaveLength(1);
        expect(refs.filter((r) => r.type === 'error_pattern')).toHaveLength(1);
        expect(refs.filter((r) => r.type === 'jira_ticket')).toHaveLength(1);
      });
    });
  });

  describe('extractReferencesFromConversation', () => {
    it('should extract references from all messages', () => {
      const conv = createConversation([
        createMessage('<@U111> can you check?', '1000.0'),
        createMessage('<@U222> also look at #123', '1001.0'),
      ]);

      const result = extractReferencesFromConversation(conv);

      expect(result.conversationId).toBe('conv-1');
      expect(result.uniqueRefs.has('U111')).toBe(true);
      expect(result.uniqueRefs.has('U222')).toBe(true);
      expect(result.uniqueRefs.has('#123')).toBe(true);
    });

    it('should deduplicate references', () => {
      const conv = createConversation([
        createMessage('<@U111> first message', '1000.0'),
        createMessage('<@U111> second message', '1001.0'),
      ]);

      const result = extractReferencesFromConversation(conv);

      expect(result.uniqueRefs.size).toBe(1);
      expect(result.uniqueRefs.has('U111')).toBe(true);
      expect(result.references).toHaveLength(2); // Still tracks both occurrences
    });
  });

  describe('calculateReferenceSimilarity', () => {
    it('should return 1.0 for identical references', () => {
      const refs1 = {
        conversationId: '1',
        references: [
          { type: 'github_issue' as const, value: '#123', raw: '#123', messageTs: '1' },
        ],
        uniqueRefs: new Set(['#123']),
      };
      const refs2 = {
        conversationId: '2',
        references: [
          { type: 'github_issue' as const, value: '#123', raw: '#123', messageTs: '2' },
        ],
        uniqueRefs: new Set(['#123']),
      };

      const similarity = calculateReferenceSimilarity(refs1, refs2);

      expect(similarity).toBe(1.0);
    });

    it('should return 0 for no overlap', () => {
      const refs1 = {
        conversationId: '1',
        references: [
          { type: 'github_issue' as const, value: '#111', raw: '#111', messageTs: '1' },
        ],
        uniqueRefs: new Set(['#111']),
      };
      const refs2 = {
        conversationId: '2',
        references: [
          { type: 'github_issue' as const, value: '#222', raw: '#222', messageTs: '2' },
        ],
        uniqueRefs: new Set(['#222']),
      };

      const similarity = calculateReferenceSimilarity(refs1, refs2);

      expect(similarity).toBe(0);
    });

    it('should return 0.5 for partial overlap', () => {
      // Jaccard: intersection(1) / union(2) = 0.5
      const refs1 = {
        conversationId: '1',
        references: [
          { type: 'github_issue' as const, value: '#111', raw: '#111', messageTs: '1' },
        ],
        uniqueRefs: new Set(['#111']),
      };
      const refs2 = {
        conversationId: '2',
        references: [
          { type: 'github_issue' as const, value: '#111', raw: '#111', messageTs: '2' },
          { type: 'jira_ticket' as const, value: 'AUTH-123', raw: 'AUTH-123', messageTs: '2' },
        ],
        uniqueRefs: new Set(['#111', 'AUTH-123']),
      };

      const similarity = calculateReferenceSimilarity(refs1, refs2);

      expect(similarity).toBe(0.5);
    });

    it('should return 0 for both empty', () => {
      const refs1 = { conversationId: '1', references: [], uniqueRefs: new Set<string>() };
      const refs2 = { conversationId: '2', references: [], uniqueRefs: new Set<string>() };

      const similarity = calculateReferenceSimilarity(refs1, refs2);

      expect(similarity).toBe(0);
    });

    it('should exclude user mentions from similarity calculation', () => {
      // Two conversations mentioning the same person should NOT have similarity
      // because user mentions don't indicate topic relatedness
      const refs1 = {
        conversationId: '1',
        references: [{ type: 'user_mention' as const, value: 'U123', raw: '<@U123>', messageTs: '1' }],
        uniqueRefs: new Set(['U123']),
      };
      const refs2 = {
        conversationId: '2',
        references: [{ type: 'user_mention' as const, value: 'U123', raw: '<@U123>', messageTs: '2' }],
        uniqueRefs: new Set(['U123']),
      };

      const similarity = calculateReferenceSimilarity(refs1, refs2);

      // User mentions are excluded, so no overlap
      expect(similarity).toBe(0);
    });

    it('should include non-user-mention references in similarity', () => {
      // GitHub issues and Jira tickets should still contribute to similarity
      const refs1 = {
        conversationId: '1',
        references: [
          { type: 'github_issue' as const, value: '#123', raw: '#123', messageTs: '1' },
          { type: 'user_mention' as const, value: 'U111', raw: '<@U111>', messageTs: '1' },
        ],
        uniqueRefs: new Set(['#123', 'U111']),
      };
      const refs2 = {
        conversationId: '2',
        references: [
          { type: 'github_issue' as const, value: '#123', raw: '#123', messageTs: '2' },
          { type: 'user_mention' as const, value: 'U222', raw: '<@U222>', messageTs: '2' },
        ],
        uniqueRefs: new Set(['#123', 'U222']),
      };

      const similarity = calculateReferenceSimilarity(refs1, refs2);

      // Only #123 is compared (user mentions excluded)
      // Jaccard: 1 / 1 = 1.0
      expect(similarity).toBe(1.0);
    });
  });

  describe('getRefsForSimilarity', () => {
    it('should exclude user mentions', () => {
      const refs = {
        conversationId: '1',
        references: [
          { type: 'user_mention' as const, value: 'U123', raw: '<@U123>', messageTs: '1' },
          { type: 'github_issue' as const, value: '#456', raw: '#456', messageTs: '1' },
          { type: 'jira_ticket' as const, value: 'AUTH-789', raw: 'AUTH-789', messageTs: '1' },
        ],
        uniqueRefs: new Set(['U123', '#456', 'AUTH-789']),
      };

      const filtered = getRefsForSimilarity(refs);

      expect(filtered.has('U123')).toBe(false);
      expect(filtered.has('#456')).toBe(true);
      expect(filtered.has('AUTH-789')).toBe(true);
      expect(filtered.size).toBe(2);
    });
  });

  describe('Slack message links', () => {
    describe('extractReferencesFromMessage', () => {
      it('should extract Slack message links', () => {
        const msg = createMessage(
          'Check this out: https://bletchley.slack.com/archives/C02FD7EU6/p1764713610112079'
        );
        const refs = extractReferencesFromMessage(msg);

        const slackRefs = refs.filter((r) => r.type === 'slack_message');
        expect(slackRefs).toHaveLength(1);
        expect(slackRefs[0].value).toBe('slack:C02FD7EU6:1764713610.112079');
      });

      it('should extract multiple Slack links from same message', () => {
        const msg = createMessage(
          'See https://foo.slack.com/archives/C123/p1234567890123456 and https://foo.slack.com/archives/C456/p9876543210987654'
        );
        const refs = extractReferencesFromMessage(msg);

        const slackRefs = refs.filter((r) => r.type === 'slack_message');
        expect(slackRefs).toHaveLength(2);
      });

      it('should handle Slack links with query parameters', () => {
        const msg = createMessage(
          'https://bletchley.slack.com/archives/D02FD7EU6/p1765839337388999?thread_ts=1765839276.224419&cid=D02FD7EU6'
        );
        const refs = extractReferencesFromMessage(msg);

        const slackRefs = refs.filter((r) => r.type === 'slack_message');
        expect(slackRefs).toHaveLength(1);
        expect(slackRefs[0].value).toBe('slack:D02FD7EU6:1765839337.388999');
      });
    });

    describe('parseSlackMessageLinks', () => {
      it('should parse Slack message links from text', () => {
        const links = parseSlackMessageLinks(
          'Check https://bletchley.slack.com/archives/C123/p1234567890123456'
        );

        expect(links).toHaveLength(1);
        expect(links[0].channelId).toBe('C123');
        expect(links[0].messageTs).toBe('1234567890.123456');
      });

      it('should return empty array for text without links', () => {
        const links = parseSlackMessageLinks('No links here');
        expect(links).toHaveLength(0);
      });

      it('should handle multiple links', () => {
        const links = parseSlackMessageLinks(
          'Link 1: https://a.slack.com/archives/C111/p1111111111111111 ' +
            'Link 2: https://b.slack.com/archives/C222/p2222222222222222'
        );

        expect(links).toHaveLength(2);
        expect(links[0].channelId).toBe('C111');
        expect(links[1].channelId).toBe('C222');
      });
    });

    describe('similarity with Slack links', () => {
      it('should group conversations sharing the same Slack link', () => {
        const refs1 = {
          conversationId: '1',
          references: [
            {
              type: 'slack_message' as const,
              value: 'slack:C123:1234567890.123456',
              raw: 'https://foo.slack.com/archives/C123/p1234567890123456',
              messageTs: '1',
            },
          ],
          uniqueRefs: new Set(['slack:C123:1234567890.123456']),
        };
        const refs2 = {
          conversationId: '2',
          references: [
            {
              type: 'slack_message' as const,
              value: 'slack:C123:1234567890.123456',
              raw: 'https://foo.slack.com/archives/C123/p1234567890123456',
              messageTs: '2',
            },
          ],
          uniqueRefs: new Set(['slack:C123:1234567890.123456']),
        };

        const similarity = calculateReferenceSimilarity(refs1, refs2);
        expect(similarity).toBe(1.0);
      });
    });
  });
});
