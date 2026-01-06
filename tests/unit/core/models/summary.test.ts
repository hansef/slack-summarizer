import { describe, it, expect } from 'vitest';
import {
  SummaryOutputSchema,
  ChannelSummarySchema,
  ConversationSummarySchema,
} from '@/core/models/summary.js';

describe('Summary Models', () => {
  describe('ConversationSummarySchema', () => {
    it('should validate a valid conversation summary', () => {
      const summary = {
        narrative_summary:
          'Team discussed deployment planning for v2.3, with focus on Friday 2pm release window. QA sign-off required before deployment can proceed.',
        start_time: '2026-01-03T09:30:00-08:00',
        end_time: '2026-01-03T11:45:00-08:00',
        message_count: 8,
        user_messages: 4,
        participants: ['@alice', '@bob'],
        key_events: ['Deployment scheduled for Friday 2pm', 'QA sign-off identified as blocker'],
        references: ['v2.3', 'deployment'],
        outcome: 'Deployment planned for Friday 2pm pending QA approval',
        timesheet_entry: 'Coordinated v2.3 deployment planning with QA approval requirements',
        slack_link: 'https://workspace.slack.com/archives/C123/p1234567890',
      };

      const result = ConversationSummarySchema.parse(summary);

      expect(result.narrative_summary).toContain('deployment planning');
      expect(result.start_time).toBe('2026-01-03T09:30:00-08:00');
      expect(result.end_time).toBe('2026-01-03T11:45:00-08:00');
      expect(result.message_count).toBe(8);
      expect(result.key_events).toHaveLength(2);
      expect(result.references).toContain('v2.3');
      expect(result.timesheet_entry).toContain('deployment planning');
    });

    it('should accept null outcome', () => {
      const summary = {
        narrative_summary: 'Ongoing discussion about feature implementation.',
        start_time: '2026-01-03T14:00:00-08:00',
        end_time: '2026-01-03T14:30:00-08:00',
        message_count: 3,
        user_messages: 2,
        participants: ['@alice'],
        key_events: ['Feature discussion started'],
        references: [],
        outcome: null,
        timesheet_entry: 'Discussed feature implementation approach',
        slack_link: 'https://workspace.slack.com/archives/C123/p1234567890',
      };

      const result = ConversationSummarySchema.parse(summary);
      expect(result.outcome).toBeNull();
    });

    it('should accept optional fields', () => {
      const summary = {
        narrative_summary: 'Brief discussion.',
        start_time: '2026-01-03T10:00:00-08:00',
        end_time: '2026-01-03T10:15:00-08:00',
        message_count: 2,
        user_messages: 1,
        participants: ['@alice'],
        key_events: [],
        references: [],
        outcome: null,
        timesheet_entry: 'Participated in brief team discussion',
        slack_link: 'https://workspace.slack.com/archives/C123/p1234567890',
        slack_links: [
          'https://workspace.slack.com/archives/C123/p1234567890',
          'https://workspace.slack.com/archives/C123/p1234567891',
        ],
        segments_merged: 2,
      };

      const result = ConversationSummarySchema.parse(summary);
      expect(result.slack_links).toHaveLength(2);
      expect(result.segments_merged).toBe(2);
    });

    it('should reject invalid URL', () => {
      const summary = {
        narrative_summary: 'Test discussion.',
        start_time: '2026-01-03T10:00:00-08:00',
        end_time: '2026-01-03T10:15:00-08:00',
        message_count: 1,
        user_messages: 1,
        participants: [],
        key_events: [],
        references: [],
        outcome: null,
        timesheet_entry: 'Test discussion',
        slack_link: 'not-a-url',
      };

      expect(() => ConversationSummarySchema.parse(summary)).toThrow();
    });
  });

  describe('ChannelSummarySchema', () => {
    it('should validate a valid channel summary', () => {
      const channel = {
        channel_id: 'C123456',
        channel_name: 'engineering',
        channel_type: 'public_channel' as const,
        interactions: {
          messages_sent: 15,
          mentions_received: 4,
          threads: 3,
        },
        topics: [],
      };

      const result = ChannelSummarySchema.parse(channel);

      expect(result.channel_id).toBe('C123456');
      expect(result.channel_type).toBe('public_channel');
    });

    it('should accept consolidation_stats', () => {
      const channel = {
        channel_id: 'C123456',
        channel_name: 'engineering',
        channel_type: 'public_channel' as const,
        interactions: {
          messages_sent: 15,
          mentions_received: 4,
          threads: 3,
        },
        topics: [],
        consolidation_stats: {
          original_segments: 10,
          consolidated_topics: 4,
          bot_messages_merged: 3,
          trivial_messages_merged: 1,
          adjacent_merged: 0,
          proximity_merged: 0,
          same_author_merged: 2,
        },
      };

      const result = ChannelSummarySchema.parse(channel);
      expect(result.consolidation_stats?.original_segments).toBe(10);
    });

    it('should accept all channel types', () => {
      const types = ['public_channel', 'private_channel', 'im', 'mpim'] as const;

      for (const type of types) {
        const channel = {
          channel_id: 'C123',
          channel_name: 'test',
          channel_type: type,
          interactions: { messages_sent: 0, mentions_received: 0, threads: 0 },
          topics: [],
        };

        expect(() => ChannelSummarySchema.parse(channel)).not.toThrow();
      }
    });
  });

  describe('SummaryOutputSchema', () => {
    it('should validate a complete summary output', () => {
      const output = {
        metadata: {
          generated_at: '2026-01-03T18:30:00Z',
          schema_version: '2.0.0' as const,
          request: {
            user_id: 'U123456',
            period_start: '2026-01-03T00:00:00-08:00',
            period_end: '2026-01-03T23:59:59-08:00',
            timezone: 'America/Los_Angeles',
          },
        },
        summary: {
          total_channels: 8,
          total_messages: 47,
          mentions_received: 12,
          threads_participated: 6,
          reactions_given: 23,
        },
        channels: [],
      };

      const result = SummaryOutputSchema.parse(output);

      expect(result.metadata.schema_version).toBe('2.0.0');
      expect(result.summary.total_messages).toBe(47);
    });

    it('should reject wrong schema version', () => {
      const output = {
        metadata: {
          generated_at: '2026-01-03T18:30:00Z',
          schema_version: '1.0.0', // Wrong version - now expecting 2.0.0
          request: {
            user_id: 'U123',
            period_start: '2026-01-03T00:00:00Z',
            period_end: '2026-01-03T23:59:59Z',
            timezone: 'UTC',
          },
        },
        summary: {
          total_channels: 0,
          total_messages: 0,
          mentions_received: 0,
          threads_participated: 0,
          reactions_given: 0,
        },
        channels: [],
      };

      expect(() => SummaryOutputSchema.parse(output)).toThrow();
    });
  });
});
