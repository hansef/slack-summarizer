/**
 * Markdown formatter for Slack activity summaries
 * Transforms SummaryOutput into a human-readable markdown document
 */

import { DateTime } from 'luxon';
import type {
  SummaryOutput,
  ChannelSummary,
  ConversationSummary,
} from '@/core/models/summary.js';

/**
 * Channel type display formatting
 */
const CHANNEL_TYPE_DISPLAY: Record<ChannelSummary['channel_type'], string> = {
  public_channel: 'Public Channel',
  private_channel: 'Private Channel',
  im: 'Direct Message',
  mpim: 'Group Message',
};

/**
 * Formats a SummaryOutput as a markdown document organized by day, then by channel.
 */
export function formatSummaryAsMarkdown(summary: SummaryOutput): string {
  const lines: string[] = [];
  const timezone = summary.metadata.request.timezone;

  // Header with metadata
  lines.push('# Slack Activity Summary');
  lines.push('');

  const periodStart = formatDate(summary.metadata.request.period_start, timezone);
  const periodEnd = formatDate(summary.metadata.request.period_end, timezone);
  const periodDisplay =
    periodStart === periodEnd ? periodStart : `${periodStart} to ${periodEnd}`;

  lines.push(`**Period:** ${periodDisplay}`);
  lines.push(`**Timezone:** ${timezone}`);
  lines.push(
    `**Generated:** ${formatDateTime(summary.metadata.generated_at, timezone)}`
  );
  lines.push('');

  // Summary statistics
  lines.push('## Overview');
  lines.push('');
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Channels Active | ${summary.summary.total_channels} |`);
  lines.push(`| Messages Sent | ${summary.summary.total_messages} |`);
  lines.push(`| Mentions Received | ${summary.summary.mentions_received} |`);
  lines.push(
    `| Threads Participated | ${summary.summary.threads_participated} |`
  );
  lines.push(`| Reactions Given | ${summary.summary.reactions_given} |`);
  lines.push('');

  // Group channels by date using topic timestamps (clamped to period)
  const channelsByDate = groupChannelsByDate(
    summary.channels,
    timezone,
    summary.metadata.request.period_start,
    summary.metadata.request.period_end
  );

  // Format each date section
  for (const [date, channels] of channelsByDate) {
    lines.push(`## ${formatDate(date, timezone)}`);
    lines.push('');

    for (const channel of channels) {
      formatChannel(channel, lines, timezone);
    }
  }

  // Handle empty summary
  if (summary.channels.length === 0) {
    lines.push('_No activity found for this period._');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Groups channels by date based on their topic start times.
 * Each channel appears under each date where it has activity,
 * with only the topics from that date included.
 * Channels with no topics are placed under the period start date.
 * Topics with start times before the period are clamped to period start.
 * Topics with start times after the period are clamped to period end.
 * Dates are returned in chronological order.
 */
function groupChannelsByDate(
  channels: ChannelSummary[],
  timezone: string,
  periodStart: string,
  periodEnd: string
): Map<string, ChannelSummary[]> {
  // Map from date string (YYYY-MM-DD) to Map from channelId to topics for that date
  const dateChannelTopics = new Map<string, Map<string, ConversationSummary[]>>();
  // Store channel metadata keyed by channel ID
  const channelMetadata = new Map<string, Omit<ChannelSummary, 'topics'>>();
  // Track channels with no topics (need to place under period start)
  const channelsWithNoTopics: ChannelSummary[] = [];

  // Normalize period boundaries once for clamping
  const periodStartDt = DateTime.fromISO(periodStart, { zone: timezone });
  const periodEndDt = DateTime.fromISO(periodEnd, { zone: timezone });
  const periodStartKey = periodStartDt.isValid
    ? periodStartDt.toFormat('yyyy-MM-dd')
    : periodStart.slice(0, 10);
  const periodEndKey = periodEndDt.isValid
    ? periodEndDt.toFormat('yyyy-MM-dd')
    : periodEnd.slice(0, 10);

  for (const channel of channels) {
    // Store channel metadata (without topics)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { topics: _topics, ...metadata } = channel;
    channelMetadata.set(channel.channel_id, metadata);

    // Handle channels with no topics - they go under period start
    if (channel.topics.length === 0) {
      channelsWithNoTopics.push(channel);
      continue;
    }

    for (const topic of channel.topics) {
      // Get the date from the topic's start_time
      const dt = DateTime.fromISO(topic.start_time, { zone: timezone });
      let dateKey = dt.isValid ? dt.toFormat('yyyy-MM-dd') : topic.start_time.slice(0, 10);

      // Clamp date to be within the requested period
      // Consolidated conversations may have start_time before or after the period
      if (dateKey < periodStartKey) {
        dateKey = periodStartKey;
      } else if (dateKey > periodEndKey) {
        dateKey = periodEndKey;
      }

      // Initialize date bucket if needed
      if (!dateChannelTopics.has(dateKey)) {
        dateChannelTopics.set(dateKey, new Map());
      }

      const channelMap = dateChannelTopics.get(dateKey)!;

      // Initialize channel topics array if needed
      if (!channelMap.has(channel.channel_id)) {
        channelMap.set(channel.channel_id, []);
      }

      channelMap.get(channel.channel_id)!.push(topic);
    }
  }

  // Add channels with no topics to the period start date
  if (channelsWithNoTopics.length > 0) {
    if (!dateChannelTopics.has(periodStartKey)) {
      dateChannelTopics.set(periodStartKey, new Map());
    }
    const channelMap = dateChannelTopics.get(periodStartKey)!;
    for (const channel of channelsWithNoTopics) {
      // These channels keep their empty topics array
      channelMap.set(channel.channel_id, []);
    }
  }

  // Sort dates chronologically
  const sortedDates = Array.from(dateChannelTopics.keys()).sort();

  // Build the result Map with channels for each date
  const result = new Map<string, ChannelSummary[]>();

  for (const dateKey of sortedDates) {
    const channelMap = dateChannelTopics.get(dateKey)!;
    const channelsForDate: ChannelSummary[] = [];

    for (const [channelId, topics] of channelMap) {
      const metadata = channelMetadata.get(channelId)!;
      channelsForDate.push({
        ...metadata,
        topics,
      });
    }

    result.set(dateKey, channelsForDate);
  }

  return result;
}

/**
 * Formats a channel section with its topics
 */
function formatChannel(channel: ChannelSummary, lines: string[], timezone: string): void {
  const prefix = channel.channel_type === 'public_channel' ? '#' : '';
  const typeLabel = CHANNEL_TYPE_DISPLAY[channel.channel_type];

  lines.push(`### ${prefix}${channel.channel_name}`);
  lines.push('');
  lines.push(`*${typeLabel}*`);
  lines.push('');

  // Activity stats
  const stats: string[] = [];
  if (channel.interactions.messages_sent > 0) {
    stats.push(
      `${channel.interactions.messages_sent} message${channel.interactions.messages_sent !== 1 ? 's' : ''} sent`
    );
  }
  if (channel.interactions.mentions_received > 0) {
    stats.push(
      `${channel.interactions.mentions_received} mention${channel.interactions.mentions_received !== 1 ? 's' : ''} received`
    );
  }
  if (channel.interactions.threads > 0) {
    stats.push(
      `${channel.interactions.threads} thread${channel.interactions.threads !== 1 ? 's' : ''}`
    );
  }

  if (stats.length > 0) {
    lines.push(`**Activity:** ${stats.join(' | ')}`);
    lines.push('');
  }

  // Topics
  if (channel.topics.length === 0) {
    lines.push('_No conversation topics captured._');
    lines.push('');
  } else {
    for (const topic of channel.topics) {
      formatTopic(topic, lines, timezone);
    }
  }

  lines.push('---');
  lines.push('');
}

/**
 * Formats a single conversation topic
 */
function formatTopic(topic: ConversationSummary, lines: string[], timezone: string): void {
  // Time range
  const timeRange = formatTimeRange(topic.start_time, topic.end_time, timezone);
  lines.push(`**${timeRange}**`);
  lines.push('');

  // Narrative summary as a blockquote
  lines.push(`> ${topic.narrative_summary}`);
  lines.push('');

  // Message count
  const messageInfo =
    topic.user_messages === topic.message_count
      ? `${topic.message_count} message${topic.message_count !== 1 ? 's' : ''}`
      : `${topic.message_count} message${topic.message_count !== 1 ? 's' : ''} (${topic.user_messages} from you)`;
  lines.push(`**Messages:** ${messageInfo}`);

  // Participants
  if (topic.participants.length > 0) {
    lines.push(`**Participants:** ${topic.participants.join(', ')}`);
  }

  // Key events
  if (topic.key_events.length > 0) {
    lines.push('');
    lines.push('**Key Events:**');
    for (const event of topic.key_events) {
      lines.push(`- ${event}`);
    }
  }

  // References
  if (topic.references.length > 0) {
    lines.push('');
    lines.push(`**References:** ${topic.references.join(', ')}`);
  }

  // Outcome
  if (topic.outcome) {
    lines.push('');
    lines.push(`**Outcome:** ${topic.outcome}`);
  }

  // Next Actions
  if (topic.next_actions && topic.next_actions.length > 0) {
    lines.push('');
    lines.push('**Next Actions:**');
    for (const action of topic.next_actions) {
      lines.push(`- ${action}`);
    }
  }

  // Timesheet Entry
  lines.push('');
  lines.push(`**Timesheet:** ${topic.timesheet_entry}`);

  // Slack link
  lines.push('');
  lines.push(`[View in Slack \u2192](${topic.slack_link})`);

  // Additional links if segments were merged
  if (topic.slack_links && topic.slack_links.length > 1) {
    const additionalLinks = topic.slack_links
      .slice(1)
      .map((url, i) => `[Thread ${i + 2}](${url})`)
      .join(' | ');
    lines.push(`*Related:* ${additionalLinks}`);
  }

  lines.push('');
}

/**
 * Formats an ISO date string as a human-readable date.
 * Uses the specified timezone to ensure correct date display.
 */
function formatDate(isoDate: string, timezone: string): string {
  // Parse the date and set the timezone for correct display
  const dt = DateTime.fromISO(isoDate, { zone: timezone });
  if (!dt.isValid) {
    return isoDate;
  }
  return dt.toFormat('cccc, MMMM d, yyyy');
}

/**
 * Formats an ISO datetime string as a human-readable datetime.
 * Uses the specified timezone to ensure correct time display.
 */
function formatDateTime(isoDateTime: string, timezone: string): string {
  // Parse the datetime and set the timezone for correct display
  const dt = DateTime.fromISO(isoDateTime, { zone: timezone });
  if (!dt.isValid) {
    return isoDateTime;
  }
  return dt.toFormat("MMMM d, yyyy 'at' h:mm a");
}

/**
 * Formats a time range for display.
 * Same-day: "9:30 AM - 11:45 AM"
 * Multi-day: "Dec 15, 9:30 AM - Dec 16, 2:00 PM"
 */
function formatTimeRange(
  startIso: string,
  endIso: string,
  timezone: string
): string {
  const start = DateTime.fromISO(startIso, { zone: timezone });
  const end = DateTime.fromISO(endIso, { zone: timezone });

  if (!start.isValid || !end.isValid) {
    return `${startIso} - ${endIso}`;
  }

  const sameDay = start.hasSame(end, 'day');

  if (sameDay) {
    // Same day: "9:30 AM - 11:45 AM"
    return `${start.toFormat('h:mm a')} - ${end.toFormat('h:mm a')}`;
  } else {
    // Multi-day: "Dec 15, 9:30 AM - Dec 16, 2:00 PM"
    return `${start.toFormat('LLL d, h:mm a')} - ${end.toFormat('LLL d, h:mm a')}`;
  }
}
