import { z } from 'zod';
import { getSlackClient } from '../../core/slack/client.js';
import { parseTimespan } from '../../utils/dates.js';
import { logger } from '../../utils/logger.js';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// Input schemas for primitive tools
const SearchMessagesInputSchema = z.object({
  query: z.string().describe('Search query (supports Slack search modifiers)'),
  user: z.string().optional().describe('Filter by user ID'),
  channel: z.string().optional().describe('Filter by channel ID'),
  from_date: z.string().optional().describe('Start date (YYYY-MM-DD)'),
  to_date: z.string().optional().describe('End date (YYYY-MM-DD)'),
  limit: z.number().optional().default(50).describe('Maximum results to return'),
});

const GetChannelHistoryInputSchema = z.object({
  channel_id: z.string().describe('Slack channel ID'),
  timespan: z
    .string()
    .optional()
    .default('today')
    .describe('Time range: today, yesterday, or YYYY-MM-DD'),
  limit: z.number().optional().default(100).describe('Maximum messages to return'),
});

const GetThreadInputSchema = z.object({
  channel_id: z.string().describe('Channel ID where the thread is located'),
  thread_ts: z.string().describe('Thread timestamp (parent message ts)'),
});

const GetReactionsInputSchema = z.object({
  user_id: z.string().optional().describe('User ID (defaults to token owner)'),
  timespan: z.string().optional().default('today').describe('Time range'),
  limit: z.number().optional().default(50).describe('Maximum reactions to return'),
});

const ListChannelsInputSchema = z.object({
  types: z
    .string()
    .optional()
    .default('public_channel,private_channel')
    .describe('Channel types: public_channel, private_channel, im, mpim'),
  limit: z.number().optional().default(100).describe('Maximum channels to return'),
});

export function getPrimitiveTools(): Tool[] {
  return [
    {
      name: 'slack_search_messages',
      description: `Search for Slack messages using a query.

Supports Slack search modifiers:
- from:@user - Messages from a specific user
- in:#channel - Messages in a specific channel
- has:reaction - Messages with reactions
- before:date, after:date - Date filtering

Returns matching messages with channel, user, timestamp, and text.`,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          user: { type: 'string', description: 'Filter by user ID' },
          channel: { type: 'string', description: 'Filter by channel ID' },
          from_date: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
          to_date: { type: 'string', description: 'End date (YYYY-MM-DD)' },
          limit: { type: 'number', description: 'Max results (default: 50)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'slack_get_channel_history',
      description: `Get message history for a specific Slack channel.

Returns messages in chronological order with user, timestamp, text, and thread info.
Useful for understanding what happened in a channel during a time period.`,
      inputSchema: {
        type: 'object',
        properties: {
          channel_id: { type: 'string', description: 'Slack channel ID' },
          timespan: { type: 'string', description: 'Time range (default: today)' },
          limit: { type: 'number', description: 'Max messages (default: 100)' },
        },
        required: ['channel_id'],
      },
    },
    {
      name: 'slack_get_thread',
      description: `Get all messages in a Slack thread.

Returns the parent message and all replies in order.
Useful for getting full context of a conversation thread.`,
      inputSchema: {
        type: 'object',
        properties: {
          channel_id: { type: 'string', description: 'Channel ID' },
          thread_ts: { type: 'string', description: 'Thread timestamp' },
        },
        required: ['channel_id', 'thread_ts'],
      },
    },
    {
      name: 'slack_get_reactions',
      description: `Get all reactions given by a user.

Returns messages the user reacted to along with the reaction emoji.
Useful for understanding what content a user found interesting or important.`,
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'User ID (optional)' },
          timespan: { type: 'string', description: 'Time range (default: today)' },
          limit: { type: 'number', description: 'Max reactions (default: 50)' },
        },
        required: [],
      },
    },
    {
      name: 'slack_list_channels',
      description: `List all Slack channels the user is a member of.

Returns channel ID, name, type, and member count.
Useful for discovering which channels to query for more details.`,
      inputSchema: {
        type: 'object',
        properties: {
          types: {
            type: 'string',
            description: 'Channel types (default: public_channel,private_channel)',
          },
          limit: { type: 'number', description: 'Max channels (default: 100)' },
        },
        required: [],
      },
    },
  ];
}

export async function handlePrimitiveTool(
  name: string,
  args: Record<string, unknown>
): Promise<CallToolResult | null> {
  const slackClient = getSlackClient();

  try {
    switch (name) {
      case 'slack_search_messages': {
        const input = SearchMessagesInputSchema.parse(args);
        const timeRange =
          input.from_date && input.to_date
            ? parseTimespan(`${input.from_date}..${input.to_date}`)
            : undefined;

        // Build search query with modifiers
        let query = input.query;
        if (input.user) {
          query += ` from:<@${input.user}>`;
        }
        if (input.channel) {
          query += ` in:<#${input.channel}>`;
        }

        const messages = await slackClient.searchMessages(query, timeRange);
        const results = messages.slice(0, input.limit).map((msg) => ({
          channel: msg.channel,
          user: msg.user,
          timestamp: msg.ts,
          text: msg.text,
        }));

        logger.info('Search completed', { query, results: results.length });

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
        };
      }

      case 'slack_get_channel_history': {
        const input = GetChannelHistoryInputSchema.parse(args);
        const timeRange = parseTimespan(input.timespan);

        const messages = await slackClient.getChannelHistory(input.channel_id, timeRange);
        const results = messages.slice(0, input.limit).map((msg) => ({
          timestamp: msg.ts,
          user: msg.user,
          text: msg.text,
          thread_ts: msg.thread_ts,
          reply_count: msg.reply_count,
        }));

        logger.info('Channel history fetched', {
          channel: input.channel_id,
          messages: results.length,
        });

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
        };
      }

      case 'slack_get_thread': {
        const input = GetThreadInputSchema.parse(args);

        const messages = await slackClient.getThreadReplies(input.channel_id, input.thread_ts);
        const results = messages.map((msg) => ({
          timestamp: msg.ts,
          user: msg.user,
          text: msg.text,
        }));

        logger.info('Thread fetched', {
          channel: input.channel_id,
          thread: input.thread_ts,
          replies: results.length,
        });

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
        };
      }

      case 'slack_get_reactions': {
        const input = GetReactionsInputSchema.parse(args);
        const timeRange = parseTimespan(input.timespan);

        const userId = input.user_id ?? (await slackClient.getCurrentUserId());
        const reactions = await slackClient.getReactionsGiven(userId, timeRange);
        const results = reactions.slice(0, input.limit).map((r) => ({
          channel: r.channel,
          message_ts: r.messageId,
          reaction: r.reaction,
          timestamp: r.timestamp,
        }));

        logger.info('Reactions fetched', { userId, reactions: results.length });

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
        };
      }

      case 'slack_list_channels': {
        const input = ListChannelsInputSchema.parse(args);

        const channels = await slackClient.listChannels();
        const results = channels.slice(0, input.limit).map((ch) => ({
          id: ch.id,
          name: ch.name,
          is_private: ch.is_private,
          is_im: ch.is_im,
          is_mpim: ch.is_mpim,
          num_members: ch.num_members,
        }));

        logger.info('Channels listed', { count: results.length });

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
        };
      }

      default:
        return null;
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ error: 'Invalid input', details: error.errors }),
          },
        ],
        isError: true,
      };
    }

    // Handle all other errors gracefully
    logger.error('Primitive tool error', {
      tool: name,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: error instanceof Error ? error.message : 'An unexpected error occurred',
          }),
        },
      ],
      isError: true,
    };
  }
}
