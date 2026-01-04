import { z } from 'zod';
import { createSummaryAggregator } from '../../core/summarization/aggregator.js';
import { logger } from '../../utils/logger.js';
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

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(summary, null, 2),
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

async function generateUserSummary(input: GetUserSummaryInput): Promise<unknown> {
  logger.info('Generating user summary via MCP', {
    timespan: input.timespan,
    userId: input.user_id,
    model: input.model,
  });

  const aggregator = createSummaryAggregator();
  const summary = await aggregator.generateSummary(input.timespan, input.user_id);

  return summary;
}
