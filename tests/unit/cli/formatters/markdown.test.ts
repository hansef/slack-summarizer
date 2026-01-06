import { describe, it, expect } from 'vitest';
import { formatSummaryAsMarkdown } from '@/cli/formatters/markdown.js';
import type { SummaryOutput } from '@/core/models/summary.js';

describe('Markdown Formatter', () => {
  const baseSummary: SummaryOutput = {
    metadata: {
      generated_at: '2026-01-03T10:30:00Z',
      schema_version: '2.0.0',
      request: {
        user_id: 'U12345',
        period_start: '2026-01-03',
        period_end: '2026-01-03',
        timezone: 'America/Los_Angeles',
      },
    },
    summary: {
      total_channels: 2,
      total_messages: 15,
      mentions_received: 3,
      threads_participated: 2,
      reactions_given: 5,
    },
    channels: [],
  };

  describe('formatSummaryAsMarkdown', () => {
    it('should generate a valid markdown header', () => {
      const result = formatSummaryAsMarkdown(baseSummary);

      expect(result).toContain('# Slack Activity Summary');
      expect(result).toContain('**Period:**');
      expect(result).toContain('**Timezone:** America/Los_Angeles');
      expect(result).toContain('**Generated:**');
    });

    it('should include overview statistics table', () => {
      const result = formatSummaryAsMarkdown(baseSummary);

      expect(result).toContain('## Overview');
      expect(result).toContain('| Metric | Count |');
      expect(result).toContain('| Channels Active | 2 |');
      expect(result).toContain('| Messages Sent | 15 |');
      expect(result).toContain('| Mentions Received | 3 |');
      expect(result).toContain('| Threads Participated | 2 |');
      expect(result).toContain('| Reactions Given | 5 |');
    });

    it('should show message when no channels', () => {
      const result = formatSummaryAsMarkdown(baseSummary);

      expect(result).toContain('_No activity found for this period._');
    });

    it('should format public channels with # prefix', () => {
      const summary: SummaryOutput = {
        ...baseSummary,
        channels: [
          {
            channel_id: 'C123',
            channel_name: 'general',
            channel_type: 'public_channel',
            interactions: {
              messages_sent: 5,
              mentions_received: 1,
              threads: 1,
            },
            topics: [],
          },
        ],
      };

      const result = formatSummaryAsMarkdown(summary);

      expect(result).toContain('### #general');
      expect(result).toContain('*Public Channel*');
    });

    it('should format DMs without # prefix', () => {
      const summary: SummaryOutput = {
        ...baseSummary,
        channels: [
          {
            channel_id: 'D123',
            channel_name: 'John Smith',
            channel_type: 'im',
            interactions: {
              messages_sent: 3,
              mentions_received: 0,
              threads: 0,
            },
            topics: [],
          },
        ],
      };

      const result = formatSummaryAsMarkdown(summary);

      expect(result).toContain('### John Smith');
      expect(result).toContain('*Direct Message*');
      expect(result).not.toContain('### #John Smith');
    });

    it('should format activity stats correctly', () => {
      const summary: SummaryOutput = {
        ...baseSummary,
        channels: [
          {
            channel_id: 'C123',
            channel_name: 'engineering',
            channel_type: 'public_channel',
            interactions: {
              messages_sent: 10,
              mentions_received: 2,
              threads: 3,
            },
            topics: [],
          },
        ],
      };

      const result = formatSummaryAsMarkdown(summary);

      expect(result).toContain('**Activity:** 10 messages sent | 2 mentions received | 3 threads');
    });

    it('should format conversation topics with narrative summary', () => {
      const summary: SummaryOutput = {
        ...baseSummary,
        channels: [
          {
            channel_id: 'C123',
            channel_name: 'engineering',
            channel_type: 'public_channel',
            interactions: {
              messages_sent: 10,
              mentions_received: 2,
              threads: 1,
            },
            topics: [
              {
                narrative_summary:
                  'The team discussed the database migration plan. Alice proposed moving to ClickHouse for analytics workloads.',
                start_time: '2026-01-03T09:30:00-08:00',
                end_time: '2026-01-03T11:45:00-08:00',
                message_count: 15,
                user_messages: 8,
                participants: ['@alice', '@bob', '@carol'],
                key_events: [
                  'Alice proposed ClickHouse migration',
                  'Bob raised concerns about complexity',
                  'Team agreed to prototype',
                ],
                references: ['#1234', 'PROJ-567'],
                outcome: 'Approved for Q1 prototype',
                timesheet_entry: 'Evaluated ClickHouse migration for analytics workloads',
                slack_link: 'https://slack.com/archives/C123/p1234567890',
              },
            ],
          },
        ],
      };

      const result = formatSummaryAsMarkdown(summary);

      // Time range (same day format: "9:30 AM - 11:45 AM")
      expect(result).toContain('**9:30 AM - 11:45 AM**');

      // Narrative as blockquote
      expect(result).toContain(
        '> The team discussed the database migration plan. Alice proposed moving to ClickHouse for analytics workloads.'
      );

      // Message count
      expect(result).toContain('**Messages:** 15 messages (8 from you)');

      // Participants
      expect(result).toContain('**Participants:** @alice, @bob, @carol');

      // Key events
      expect(result).toContain('**Key Events:**');
      expect(result).toContain('- Alice proposed ClickHouse migration');
      expect(result).toContain('- Bob raised concerns about complexity');
      expect(result).toContain('- Team agreed to prototype');

      // References
      expect(result).toContain('**References:** #1234, PROJ-567');

      // Outcome
      expect(result).toContain('**Outcome:** Approved for Q1 prototype');

      // Slack link
      expect(result).toContain('[View in Slack →](https://slack.com/archives/C123/p1234567890)');
    });

    it('should format multi-day conversation time ranges', () => {
      const summary: SummaryOutput = {
        ...baseSummary,
        channels: [
          {
            channel_id: 'C123',
            channel_name: 'engineering',
            channel_type: 'public_channel',
            interactions: {
              messages_sent: 5,
              mentions_received: 0,
              threads: 0,
            },
            topics: [
              {
                narrative_summary: 'Late night debugging session.',
                start_time: '2026-01-03T23:30:00-08:00', // Jan 3, 11:30 PM
                end_time: '2026-01-04T02:15:00-08:00', // Jan 4, 2:15 AM
                message_count: 8,
                user_messages: 4,
                participants: ['@alice'],
                key_events: [],
                references: [],
                outcome: null,
                timesheet_entry: 'Debugged production issue overnight',
                slack_link: 'https://slack.com/archives/C123/p1234567890',
              },
            ],
          },
        ],
      };

      const result = formatSummaryAsMarkdown(summary);

      // Should format as "Jan 3, 11:30 PM - Jan 4, 2:15 AM"
      expect(result).toContain('**Jan 3, 11:30 PM - Jan 4, 2:15 AM**');
    });

    it('should handle consolidated topics with multiple slack links', () => {
      const summary: SummaryOutput = {
        ...baseSummary,
        channels: [
          {
            channel_id: 'C123',
            channel_name: 'engineering',
            channel_type: 'public_channel',
            interactions: {
              messages_sent: 10,
              mentions_received: 0,
              threads: 0,
            },
            topics: [
              {
                narrative_summary: 'A consolidated topic spanning multiple threads.',
                start_time: '2026-01-03T08:00:00-08:00',
                end_time: '2026-01-03T14:30:00-08:00',
                message_count: 25,
                user_messages: 12,
                participants: ['@alice'],
                key_events: ['Event 1'],
                references: [],
                outcome: null,
                timesheet_entry: 'Coordinated multi-thread discussion',
                slack_link: 'https://slack.com/archives/C123/p1111111111',
                slack_links: [
                  'https://slack.com/archives/C123/p1111111111',
                  'https://slack.com/archives/C123/p2222222222',
                  'https://slack.com/archives/C123/p3333333333',
                ],
                segments_merged: 3,
              },
            ],
            consolidation_stats: {
              original_segments: 5,
              consolidated_topics: 1,
              bot_messages_merged: 2,
              trivial_messages_merged: 0,
              adjacent_merged: 0,
              proximity_merged: 0,
              same_author_merged: 0,
            },
          },
        ],
      };

      const result = formatSummaryAsMarkdown(summary);

      // Consolidation stats are no longer shown in output (removed as internal metrics)
      expect(result).not.toContain('segments consolidated');

      // Related threads
      expect(result).toContain('*Related:*');
      expect(result).toContain('[Thread 2](https://slack.com/archives/C123/p2222222222)');
      expect(result).toContain('[Thread 3](https://slack.com/archives/C123/p3333333333)');
    });

    it('should handle multi-day period display', () => {
      const summary: SummaryOutput = {
        ...baseSummary,
        metadata: {
          ...baseSummary.metadata,
          request: {
            ...baseSummary.metadata.request,
            period_start: '2026-01-01',
            period_end: '2026-01-07',
          },
        },
      };

      const result = formatSummaryAsMarkdown(summary);

      // Should show date range
      expect(result).toMatch(/\*\*Period:\*\* .+ to .+/);
    });

    it('should group topics by their actual date for multi-day periods', () => {
      const summary: SummaryOutput = {
        ...baseSummary,
        metadata: {
          ...baseSummary.metadata,
          request: {
            ...baseSummary.metadata.request,
            period_start: '2026-01-01',
            period_end: '2026-01-07',
          },
        },
        channels: [
          {
            channel_id: 'C123',
            channel_name: 'engineering',
            channel_type: 'public_channel',
            interactions: {
              messages_sent: 15,
              mentions_received: 2,
              threads: 2,
            },
            topics: [
              {
                narrative_summary: 'Monday morning standup discussion.',
                start_time: '2026-01-05T09:00:00-08:00', // Monday Jan 5
                end_time: '2026-01-05T09:30:00-08:00',
                message_count: 5,
                user_messages: 3,
                participants: ['@alice', '@bob'],
                key_events: [],
                references: [],
                outcome: null,
                timesheet_entry: 'Attended morning standup',
                slack_link: 'https://slack.com/archives/C123/p1111111111',
              },
              {
                narrative_summary: 'Wednesday code review.',
                start_time: '2026-01-07T14:00:00-08:00', // Wednesday Jan 7
                end_time: '2026-01-07T15:30:00-08:00',
                message_count: 10,
                user_messages: 4,
                participants: ['@alice', '@carol'],
                key_events: [],
                references: [],
                outcome: null,
                timesheet_entry: 'Conducted code review session',
                slack_link: 'https://slack.com/archives/C123/p2222222222',
              },
            ],
          },
          {
            channel_id: 'D456',
            channel_name: 'Alice Smith',
            channel_type: 'im',
            interactions: {
              messages_sent: 3,
              mentions_received: 0,
              threads: 0,
            },
            topics: [
              {
                narrative_summary: 'Quick sync on Tuesday.',
                start_time: '2026-01-06T11:00:00-08:00', // Tuesday Jan 6
                end_time: '2026-01-06T11:15:00-08:00',
                message_count: 3,
                user_messages: 2,
                participants: ['@alice'],
                key_events: [],
                references: [],
                outcome: null,
                timesheet_entry: 'Quick sync with Alice',
                slack_link: 'https://slack.com/archives/D456/p3333333333',
              },
            ],
          },
        ],
      };

      const result = formatSummaryAsMarkdown(summary);

      // Should have separate date headings for each day with activity
      expect(result).toContain('## Monday, January 5, 2026');
      expect(result).toContain('## Tuesday, January 6, 2026');
      expect(result).toContain('## Wednesday, January 7, 2026');

      // Monday's content should be under Monday
      const mondayIndex = result.indexOf('## Monday, January 5, 2026');
      const tuesdayIndex = result.indexOf('## Tuesday, January 6, 2026');
      const wednesdayIndex = result.indexOf('## Wednesday, January 7, 2026');

      // Verify chronological order
      expect(mondayIndex).toBeLessThan(tuesdayIndex);
      expect(tuesdayIndex).toBeLessThan(wednesdayIndex);

      // Monday standup should appear before Tuesday content
      const mondayStandupIndex = result.indexOf('Monday morning standup');
      expect(mondayStandupIndex).toBeGreaterThan(mondayIndex);
      expect(mondayStandupIndex).toBeLessThan(tuesdayIndex);

      // Tuesday sync should appear between Tuesday and Wednesday headings
      const tuesdaySyncIndex = result.indexOf('Quick sync on Tuesday');
      expect(tuesdaySyncIndex).toBeGreaterThan(tuesdayIndex);
      expect(tuesdaySyncIndex).toBeLessThan(wednesdayIndex);

      // Wednesday code review should appear after Wednesday heading
      const wednesdayReviewIndex = result.indexOf('Wednesday code review');
      expect(wednesdayReviewIndex).toBeGreaterThan(wednesdayIndex);

      // Same channel should appear under multiple days
      const engineeringOccurrences = result.split('### #engineering').length - 1;
      expect(engineeringOccurrences).toBe(2); // Monday and Wednesday
    });

    it('should skip empty days in multi-day periods', () => {
      const summary: SummaryOutput = {
        ...baseSummary,
        metadata: {
          ...baseSummary.metadata,
          request: {
            ...baseSummary.metadata.request,
            period_start: '2026-01-01',
            period_end: '2026-01-07',
          },
        },
        channels: [
          {
            channel_id: 'C123',
            channel_name: 'engineering',
            channel_type: 'public_channel',
            interactions: {
              messages_sent: 5,
              mentions_received: 0,
              threads: 0,
            },
            topics: [
              {
                narrative_summary: 'Only activity on Friday.',
                start_time: '2026-01-02T10:00:00-08:00', // Friday Jan 2
                end_time: '2026-01-02T10:30:00-08:00',
                message_count: 5,
                user_messages: 3,
                participants: ['@alice'],
                key_events: [],
                references: [],
                outcome: null,
                timesheet_entry: 'Friday activity session',
                slack_link: 'https://slack.com/archives/C123/p1111111111',
              },
            ],
          },
        ],
      };

      const result = formatSummaryAsMarkdown(summary);

      // Should only show Friday heading (the only day with activity)
      expect(result).toContain('## Friday, January 2, 2026');

      // Should NOT show other days
      expect(result).not.toContain('## Thursday');
      expect(result).not.toContain('## Saturday');
      expect(result).not.toContain('## Sunday');
      expect(result).not.toContain('## Monday');
    });

    it('should clamp topic dates to requested period boundaries', () => {
      // Simulates consolidated conversations that started before the requested period
      const summary: SummaryOutput = {
        ...baseSummary,
        metadata: {
          ...baseSummary.metadata,
          request: {
            ...baseSummary.metadata.request,
            period_start: '2026-01-05', // Monday
            period_end: '2026-01-07', // Wednesday
          },
        },
        channels: [
          {
            channel_id: 'C123',
            channel_name: 'engineering',
            channel_type: 'public_channel',
            interactions: {
              messages_sent: 20,
              mentions_received: 0,
              threads: 0,
            },
            topics: [
              {
                // This topic started in July 2024 but continued into Jan 2026
                narrative_summary: 'A long-running thread that continued into this week.',
                start_time: '2024-07-16T16:47:00-07:00', // Way before period
                end_time: '2026-01-06T12:24:00-08:00', // Within period
                message_count: 10,
                user_messages: 3,
                participants: ['@alice'],
                key_events: [],
                references: [],
                outcome: null,
                timesheet_entry: 'Continued long-running thread discussion',
                slack_link: 'https://slack.com/archives/C123/p1111111111',
              },
              {
                // This topic is within the period
                narrative_summary: 'Normal activity on Tuesday.',
                start_time: '2026-01-06T09:00:00-08:00', // Tuesday
                end_time: '2026-01-06T10:00:00-08:00',
                message_count: 5,
                user_messages: 2,
                participants: ['@bob'],
                key_events: [],
                references: [],
                outcome: null,
                timesheet_entry: 'Regular Tuesday activity',
                slack_link: 'https://slack.com/archives/C123/p2222222222',
              },
            ],
          },
        ],
      };

      const result = formatSummaryAsMarkdown(summary);

      // The old thread should be clamped to period start (Monday)
      expect(result).toContain('## Monday, January 5, 2026');
      // The normal topic should appear on Tuesday
      expect(result).toContain('## Tuesday, January 6, 2026');

      // Should NOT show dates outside the period
      expect(result).not.toContain('## Thursday, July');
      expect(result).not.toContain('2024');

      // Both topics should appear in the output
      expect(result).toContain('A long-running thread that continued into this week.');
      expect(result).toContain('Normal activity on Tuesday.');
    });

    it('should handle topics with no outcome', () => {
      const summary: SummaryOutput = {
        ...baseSummary,
        channels: [
          {
            channel_id: 'C123',
            channel_name: 'general',
            channel_type: 'public_channel',
            interactions: {
              messages_sent: 5,
              mentions_received: 0,
              threads: 0,
            },
            topics: [
              {
                narrative_summary: 'An ongoing discussion.',
                start_time: '2026-01-03T15:00:00-08:00',
                end_time: '2026-01-03T15:30:00-08:00',
                message_count: 5,
                user_messages: 5,
                participants: ['@alice'],
                key_events: [],
                references: [],
                outcome: null,
                timesheet_entry: 'Participated in ongoing discussion',
                slack_link: 'https://slack.com/archives/C123/p1234567890',
              },
            ],
          },
        ],
      };

      const result = formatSummaryAsMarkdown(summary);

      expect(result).not.toContain('**Outcome:**');
    });

    it('should use singular forms when counts are 1', () => {
      const summary: SummaryOutput = {
        ...baseSummary,
        channels: [
          {
            channel_id: 'C123',
            channel_name: 'general',
            channel_type: 'public_channel',
            interactions: {
              messages_sent: 1,
              mentions_received: 1,
              threads: 1,
            },
            topics: [
              {
                narrative_summary: 'A single message.',
                start_time: '2026-01-03T10:00:00-08:00',
                end_time: '2026-01-03T10:00:00-08:00',
                message_count: 1,
                user_messages: 1,
                participants: ['@alice'],
                key_events: [],
                references: [],
                outcome: null,
                timesheet_entry: 'Sent single message',
                slack_link: 'https://slack.com/archives/C123/p1234567890',
              },
            ],
          },
        ],
      };

      const result = formatSummaryAsMarkdown(summary);

      expect(result).toContain('1 message sent');
      expect(result).toContain('1 mention received');
      expect(result).toContain('1 thread');
      expect(result).toContain('**Messages:** 1 message');
    });
  });
});
