import { z } from 'zod';
import { getSlackClient, SlackClient } from '@/core/slack/client.js';
import { fromSlackTimestamp, parseTimespan } from '@/utils/dates.js';
import { createLogger } from '@/utils/logging/index.js';

const logger = createLogger({ component: 'McpPrimitives' });
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Resolves user IDs to display names for enriching MCP responses.
 * Uses on-demand fetching with caching via SlackClient.getUserInfo().
 *
 * @returns Map of user ID to display name (null if resolution failed)
 */
async function resolveUserNames(
  messages: Array<{ user?: string }>,
  slackClient: SlackClient
): Promise<Map<string, string | null>> {
  const userIds = new Set(messages.map((m) => m.user).filter(Boolean) as string[]);
  const userNames = new Map<string, string | null>();

  await Promise.all(
    Array.from(userIds).map(async (userId) => {
      try {
        const user = await slackClient.getUserInfo(userId);
        // Priority: real_name > display_name > name (matches aggregator.ts pattern)
        const displayName = user.real_name || user.display_name || user.name;
        userNames.set(userId, displayName);
      } catch {
        // Only set null on actual API failure
        userNames.set(userId, null);
      }
    })
  );

  return userNames;
}

/**
 * Creates a user object with both ID and resolved name for MCP responses.
 */
function buildUserObject(
  userId: string | undefined,
  userNames: Map<string, string | null>
): { id: string; name: string | null } | null {
  if (!userId) return null;
  return {
    id: userId,
    name: userNames.get(userId) ?? null,
  };
}

// Input schemas for primitive tools
const SearchMessagesInputSchema = z.object({
  query: z.string().optional().default('').describe('Search query (supports Slack search modifiers)'),
  user: z.string().optional().describe('User ID, @handle, display name or full name'),
  channel: z.string().optional().describe('Filter by channel ID'),
  from_date: z.string().optional().describe('Start date (YYYY-MM-DD), inclusive'),
  to_date: z.string().optional().describe('End date (YYYY-MM-DD), inclusive'),
  sort: z.enum(['newest', 'oldest']).optional().default('newest'),
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
      description: `Search Slack messages. Results are newest first unless sort is "oldest".

Filter with the parameters rather than query modifiers where one exists:
- from_date / to_date: inclusive YYYY-MM-DD dates in the configured timezone. Either works alone.
- user: a user ID, @handle, display name or full name ("Jane Doe"). Names resolve to an ID; an ambiguous name returns an error listing the candidate IDs. A display name written as from:@Jane Doe in the query silently matches nothing, because from: only takes a handle.
- channel: a channel ID. For a channel name, put in:#channel-name in the query.

The query is optional when a filter is given: { user: "Jane Doe", from_date: "2026-01-05" } returns everything she sent since then. There is no wildcard; * is a literal term in Slack and matches nothing. The query also accepts Slack modifiers such as in:#channel, has:reaction, has:link and "exact phrase".

Returns up to limit messages, each with channel, user, timestamp, date (ISO, local time) and text.`,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search terms (optional when a filter is given)' },
          user: {
            type: 'string',
            description: 'Sender: user ID, @handle, display name or full name',
          },
          channel: { type: 'string', description: 'Channel ID' },
          from_date: { type: 'string', description: 'Start date (YYYY-MM-DD), inclusive' },
          to_date: { type: 'string', description: 'End date (YYYY-MM-DD), inclusive' },
          sort: {
            type: 'string',
            enum: ['newest', 'oldest'],
            description: 'Result order (default: newest)',
          },
          limit: { type: 'number', description: 'Max results (default: 50)' },
        },
        required: [],
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
        // Either bound may be given alone; parseTimespan throws on a malformed date
        const timeRange = {
          start: input.from_date ? parseTimespan(input.from_date).start : undefined,
          end: input.to_date ? parseTimespan(input.to_date).end : undefined,
        };

        // Slack has no match-all wildcard: a bare * is a literal term that matches nothing
        const terms = input.query.trim() === '*' ? '' : input.query.trim();
        if (!terms && !input.user && !input.channel && !input.from_date && !input.to_date) {
          throw new Error('Provide a query or at least one filter (user, channel, from_date, to_date)');
        }

        const parts = [terms];
        if (input.user) {
          parts.push(`from:<@${await slackClient.resolveUser(input.user)}>`);
        }
        if (input.channel) {
          parts.push(`in:<#${input.channel}>`);
        }
        const query = parts.filter(Boolean).join(' ');

        const messages = await slackClient.searchMessages(query, timeRange, {
          sort: input.sort === 'oldest' ? 'asc' : 'desc',
          maxResults: input.limit,
        });
        const limitedMessages = messages.slice(0, input.limit);

        // Resolve user IDs to display names
        const userNames = await resolveUserNames(limitedMessages, slackClient);

        const results = limitedMessages.map((msg) => ({
          channel: msg.channel,
          user: buildUserObject(msg.user, userNames),
          timestamp: msg.ts,
          date: fromSlackTimestamp(msg.ts).toFormat("yyyy-MM-dd'T'HH:mm:ssZZ"),
          text: msg.text,
        }));

        logger.info({ query, results: results.length }, 'Search completed');

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
        };
      }

      case 'slack_get_channel_history': {
        const input = GetChannelHistoryInputSchema.parse(args);
        const timeRange = parseTimespan(input.timespan);

        const messages = await slackClient.getChannelHistory(input.channel_id, timeRange);
        const limitedMessages = messages.slice(0, input.limit);

        // Resolve user IDs to display names
        const userNames = await resolveUserNames(limitedMessages, slackClient);

        const results = limitedMessages.map((msg) => ({
          timestamp: msg.ts,
          user: buildUserObject(msg.user, userNames),
          text: msg.text,
          thread_ts: msg.thread_ts,
          reply_count: msg.reply_count,
        }));

        logger.info(
          { channel: input.channel_id, messages: results.length },
          'Channel history fetched'
        );

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
        };
      }

      case 'slack_get_thread': {
        const input = GetThreadInputSchema.parse(args);

        const messages = await slackClient.getThreadReplies(input.channel_id, input.thread_ts);

        // Resolve user IDs to display names
        const userNames = await resolveUserNames(messages, slackClient);

        const results = messages.map((msg) => ({
          timestamp: msg.ts,
          user: buildUserObject(msg.user, userNames),
          text: msg.text,
        }));

        logger.info(
          { channel: input.channel_id, thread: input.thread_ts, replies: results.length },
          'Thread fetched'
        );

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

        logger.info({ userId, reactions: results.length }, 'Reactions fetched');

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

        logger.info({ count: results.length }, 'Channels listed');

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
    logger.error(
      { tool: name, error: error instanceof Error ? error.message : String(error) },
      'Primitive tool error'
    );

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
