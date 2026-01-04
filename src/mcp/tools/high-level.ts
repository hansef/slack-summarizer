import { z } from 'zod';
import { createSummaryAggregator } from '../../core/summarization/aggregator.js';
import { logger } from '../../utils/logger.js';
import { formatSummaryAsMarkdown } from '../../cli/formatters/markdown.js';
import type { SummaryOutput, ChannelSummary, ConversationSummary } from '../../core/models/summary.js';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// Input schema for slack_get_user_summary
const GetUserSummaryInputSchema = z.object({
  timespan: z
    .string()
    .describe('Time range: today, yesterday, last-week, or YYYY-MM-DD..YYYY-MM-DD'),
  user_id: z.string().optional().describe('Slack user ID (optional, defaults to token owner)'),
  model: z
    .enum(['haiku', 'sonnet'])
    .optional()
    .describe('Claude model for summarization (default: haiku)'),
  format: z
    .enum(['full', 'condensed'])
    .optional()
    .describe('Output detail level: full (all fields) or condensed (shorter, optimized for LLMs). Default: condensed'),
  output_format: z
    .enum(['json', 'markdown'])
    .optional()
    .describe('Output format: json or markdown (more compact). Default: markdown'),
});

type GetUserSummaryInput = z.infer<typeof GetUserSummaryInputSchema>;

export function getHighLevelTools(): Tool[] {
  return [
    {
      name: 'slack_get_user_summary',
      description: `Generate a comprehensive summary of a Slack user's activity over a specified time period.

Returns a channel-by-channel breakdown including:
- Messages sent in each channel
- @mentions received
- Thread participation
- Reactions given

Each conversation includes:
- Topic summary
- Key discussion points
- Participants
- Direct Slack permalink

Use this when you want to understand what someone did in Slack during a specific timeframe.

Examples:
- "What did I do in Slack yesterday?"
- "Summarize my Slack activity for last week"
- "What conversations was I involved in today?"`,
      inputSchema: {
        type: 'object',
        properties: {
          timespan: {
            type: 'string',
            description:
              'Time range: today, yesterday, last-week, or ISO date range (YYYY-MM-DD..YYYY-MM-DD)',
          },
          user_id: {
            type: 'string',
            description: 'Slack user ID (optional, defaults to the token owner)',
          },
          model: {
            type: 'string',
            enum: ['haiku', 'sonnet'],
            description: 'Claude model for summarization quality/speed tradeoff (default: haiku)',
          },
          format: {
            type: 'string',
            enum: ['full', 'condensed'],
            description: 'Output detail level: full (all fields) or condensed (shorter, optimized for LLMs). Default: condensed',
          },
          output_format: {
            type: 'string',
            enum: ['json', 'markdown'],
            description: 'Output format: json or markdown (more compact). Default: markdown',
          },
        },
        required: ['timespan'],
      },
    },
  ];
}

export async function handleHighLevelTool(
  name: string,
  args: Record<string, unknown>
): Promise<CallToolResult | null> {
  if (name !== 'slack_get_user_summary') {
    return null;
  }

  try {
    const input = GetUserSummaryInputSchema.parse(args);
    const summary = await generateUserSummary(input);

    // Apply condensed format if requested (default: condensed)
    const format = input.format ?? 'condensed';
    const processedSummary = format === 'condensed' ? condenseSummary(summary) : summary;

    // Format output (default: markdown)
    const outputFormat = input.output_format ?? 'markdown';
    let outputText: string;

    if (outputFormat === 'markdown') {
      outputText = formatSummaryAsMarkdown(processedSummary);
    } else {
      outputText = JSON.stringify(processedSummary, null, 2);
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: outputText,
        },
      ],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              error: 'Invalid input',
              details: error.errors,
            }),
          },
        ],
        isError: true,
      };
    }
    throw error;
  }
}

async function generateUserSummary(input: GetUserSummaryInput): Promise<SummaryOutput> {
  logger.info('Generating user summary via MCP', {
    timespan: input.timespan,
    userId: input.user_id,
    model: input.model,
    format: input.format,
    outputFormat: input.output_format,
  });

  const aggregator = createSummaryAggregator();
  const summary = await aggregator.generateSummary(input.timespan, input.user_id);

  return summary;
}

/**
 * Condense a summary by removing verbose fields to reduce token count.
 * - Removes slack_links array (keeps primary slack_link)
 * - Limits key_events to 3
 * - Removes consolidation_stats
 * - Removes segments_merged
 */
function condenseSummary(summary: SummaryOutput): SummaryOutput {
  return {
    ...summary,
    channels: summary.channels.map((channel): ChannelSummary => ({
      channel_id: channel.channel_id,
      channel_name: channel.channel_name,
      channel_type: channel.channel_type,
      interactions: channel.interactions,
      topics: channel.topics.map((topic): ConversationSummary => ({
        narrative_summary: topic.narrative_summary,
        start_time: topic.start_time,
        end_time: topic.end_time,
        message_count: topic.message_count,
        user_messages: topic.user_messages,
        participants: topic.participants,
        key_events: topic.key_events.slice(0, 3), // Limit to 3 key events
        references: topic.references,
        outcome: topic.outcome,
        next_actions: topic.next_actions,
        timesheet_entry: topic.timesheet_entry,
        slack_link: topic.slack_link,
        // Omit: slack_links, segments_merged
      })),
      // Omit: consolidation_stats
    })),
  };
}
