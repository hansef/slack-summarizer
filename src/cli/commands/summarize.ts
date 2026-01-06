import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DateTime } from 'luxon';
import { createSummaryAggregator } from '@/core/summarization/aggregator.js';
import { logger } from '@/utils/logger.js';
import { output } from '../output.js';
import { formatSummaryAsMarkdown } from '../formatters/markdown.js';

interface SummarizeOptions {
  date: string;
  span: string;
  format: 'json' | 'markdown';
  output?: string;
  model: string;
  user?: string;
}

function buildTimespan(date: string, span: string): string {
  // If span is an explicit date range (YYYY-MM-DD..YYYY-MM-DD), use it directly
  if (span.includes('..')) {
    return span;
  }

  // Handle relative dates
  if (date === 'today') {
    return span === 'week' ? 'last-week' : 'today';
  }
  if (date === 'yesterday') {
    return 'yesterday';
  }

  // Handle ISO date format - just return the date for day span
  if (span === 'day') {
    return date;
  }

  // For week span with a specific date, calculate 7 days starting from that date
  if (span === 'week') {
    const startDate = DateTime.fromISO(date);
    if (startDate.isValid) {
      const endDate = startDate.plus({ days: 6 });
      return `${startDate.toFormat('yyyy-MM-dd')}..${endDate.toFormat('yyyy-MM-dd')}`;
    }
  }

  return date;
}

export async function summarizeCommand(options: SummarizeOptions): Promise<void> {
  const startTime = Date.now();
  const useStdout = options.output === '-';

  // Always enable progress mode in batch command - shows single updating ⏳ line
  // This suppresses verbose logs (unless --verbose flag sets level to debug)
  logger.enableProgressMode();

  if (!useStdout) {
    output.info('Starting Slack activity summary...');
    output.info(`Date: ${options.date}, Span: ${options.span}, Format: ${options.format}`);
    output.info(`Model: ${options.model}`);
  }

  try {
    const timespan = buildTimespan(options.date, options.span);
    const aggregator = createSummaryAggregator();

    if (!useStdout) {
      output.progress('Fetching Slack data and generating summary...');
    }

    const summary = await aggregator.generateSummary(timespan, options.user);

    // Format content based on format option
    const isMarkdown = options.format === 'markdown';
    const content = isMarkdown
      ? formatSummaryAsMarkdown(summary)
      : JSON.stringify(summary, null, 2);

    if (useStdout) {
      // Disable progress mode before writing output
      logger.disableProgressMode();
      // Write to stdout
      process.stdout.write(content);
      if (!content.endsWith('\n')) {
        process.stdout.write('\n');
      }
    } else {
      // Write to file
      const defaultPath = isMarkdown ? './slack-summary.md' : './slack-summary.json';
      const outputPath = resolve(options.output ?? defaultPath);
      writeFileSync(outputPath, content, 'utf-8');

      output.success(`Summary written to: ${outputPath}`);

      // Display summary statistics
      output.divider();
      output.header('Summary Statistics');
      output.stat('Channels', summary.summary.total_channels);
      output.stat('Messages Sent', summary.summary.total_messages);
      output.stat('Mentions Received', summary.summary.mentions_received);
      output.stat('Threads Participated', summary.summary.threads_participated);
      output.stat('Reactions Given', summary.summary.reactions_given);

      if (summary.channels.length > 0) {
        output.divider();
        output.header('Top Channels');

        // Show top 5 channels by activity
        const topChannels = summary.channels.slice(0, 5);
        for (const channel of topChannels) {
          const activity =
            channel.interactions.messages_sent +
            channel.interactions.mentions_received +
            channel.interactions.threads;
          output.channelSummary(channel.channel_name, activity, channel.topics.length);
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      output.divider();
      output.success(`Completed in ${duration}s`);
    }
  } catch (error) {
    // Ensure progress mode is disabled before showing error
    logger.disableProgressMode();
    logger.error('Summarization failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    output.error(
      'Failed to generate summary',
      error instanceof Error ? error.message : 'Unknown error'
    );
    process.exit(1);
  }
}
