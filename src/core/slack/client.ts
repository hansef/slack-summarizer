import { WebClient } from '@slack/web-api';
import { getEnv } from '../../utils/env.js';
import { logger } from '../../utils/logger.js';
import { getRateLimiter, RateLimiter } from './rate-limiter.js';
import {
  SlackChannel,
  SlackChannelSchema,
  SlackMessage,
  SlackMessageSchema,
  SlackUser,
  AuthTestResponse,
  AuthTestResponseSchema,
} from '../models/slack.js';
export type { SlackUser } from '../models/slack.js';
import type { DateRange } from '../../utils/dates.js';
import { toSlackTimestamp } from '../../utils/dates.js';

export interface SlackClientConfig {
  token?: string;
  rateLimiter?: RateLimiter;
}

export class SlackClient {
  private client: WebClient;
  private rateLimiter: RateLimiter;
  private userId: string | null = null;
  private userCache = new Map<string, SlackUser>();

  constructor(config: SlackClientConfig = {}) {
    const token = config.token ?? getEnv().SLACK_USER_TOKEN;
    this.client = new WebClient(token);
    this.rateLimiter = config.rateLimiter ?? getRateLimiter();
  }

  async authenticate(): Promise<AuthTestResponse> {
    const response = await this.rateLimiter.execute(() => this.client.auth.test());

    const parsed = AuthTestResponseSchema.parse(response);
    this.userId = parsed.user_id;

    logger.info('Authenticated with Slack', {
      user: parsed.user,
      team: parsed.team,
      userId: parsed.user_id,
    });

    return parsed;
  }

  async getCurrentUserId(): Promise<string> {
    if (this.userId) {
      return this.userId;
    }

    const auth = await this.authenticate();
    return auth.user_id;
  }

  async listChannels(): Promise<SlackChannel[]> {
    const channels: SlackChannel[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.rateLimiter.execute(() =>
        this.client.users.conversations({
          types: 'public_channel,private_channel,im,mpim',
          limit: 200,
          cursor,
        })
      );

      if (!response.ok) {
        throw new Error(`Failed to list channels: ${response.error}`);
      }

      const rawChannels = response.channels ?? [];
      for (const ch of rawChannels) {
        try {
          const parsed = SlackChannelSchema.parse(ch);
          channels.push(parsed);
        } catch (e) {
          logger.warn('Failed to parse channel', { channel: ch, error: String(e) });
        }
      }

      cursor = response.response_metadata?.next_cursor;
    } while (cursor);

    logger.info('Listed channels', { count: channels.length });
    return channels;
  }

  async getChannelHistory(
    channelId: string,
    timeRange: DateRange
  ): Promise<SlackMessage[]> {
    const messages: SlackMessage[] = [];
    let cursor: string | undefined;
    const oldest = toSlackTimestamp(timeRange.start);
    const latest = toSlackTimestamp(timeRange.end);

    do {
      const response = await this.rateLimiter.execute(() =>
        this.client.conversations.history({
          channel: channelId,
          oldest,
          latest,
          limit: 200,
          cursor,
        })
      );

      if (!response.ok) {
        throw new Error(`Failed to get channel history: ${response.error}`);
      }

      const rawMessages = response.messages ?? [];
      for (const msg of rawMessages) {
        try {
          const parsed = SlackMessageSchema.parse({ ...msg, channel: channelId });
          messages.push(parsed);
        } catch (e) {
          logger.warn('Failed to parse message', { message: msg, error: String(e) });
        }
      }

      cursor = response.response_metadata?.next_cursor;
    } while (cursor);

    return messages;
  }

  async getThreadReplies(channelId: string, threadTs: string): Promise<SlackMessage[]> {
    const messages: SlackMessage[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.rateLimiter.execute(() =>
        this.client.conversations.replies({
          channel: channelId,
          ts: threadTs,
          limit: 200,
          cursor,
        })
      );

      if (!response.ok) {
        throw new Error(`Failed to get thread replies: ${response.error}`);
      }

      const rawMessages = response.messages ?? [];
      for (const msg of rawMessages) {
        try {
          const parsed = SlackMessageSchema.parse({ ...msg, channel: channelId });
          messages.push(parsed);
        } catch (e) {
          logger.warn('Failed to parse reply', { message: msg, error: String(e) });
        }
      }

      cursor = response.response_metadata?.next_cursor;
    } while (cursor);

    return messages;
  }

  async searchMessages(
    query: string,
    timeRange?: DateRange
  ): Promise<SlackMessage[]> {
    const messages: SlackMessage[] = [];
    let page = 1;

    // Add time range to query if provided
    let fullQuery = query;
    if (timeRange) {
      const startDate = timeRange.start.toFormat('yyyy-MM-dd');
      // Slack's before: is exclusive, so add 1 day to include messages on the end date
      const endDate = timeRange.end.plus({ days: 1 }).toFormat('yyyy-MM-dd');
      fullQuery += ` after:${startDate} before:${endDate}`;
    }

    let hasMorePages = true;
    while (hasMorePages) {
      const response = await this.rateLimiter.execute(() =>
        this.client.search.messages({
          query: fullQuery,
          sort: 'timestamp',
          sort_dir: 'asc',
          count: 100,
          page,
        })
      );

      if (!response.ok) {
        throw new Error(`Failed to search messages: ${response.error}`);
      }

      const matches = response.messages?.matches ?? [];
      for (const match of matches) {
        try {
          if (!match.ts) continue;
          // Convert search result format to message format
          // Extract thread_ts if this is a thread reply
          const matchRecord = match as Record<string, unknown>;
          const threadTs = typeof matchRecord.thread_ts === 'string' ? matchRecord.thread_ts : undefined;

          const msg: SlackMessage = {
            ts: match.ts,
            text: match.text ?? '',
            user: match.user,
            channel: match.channel?.id ?? '',
            type: 'message',
            thread_ts: threadTs,
          };
          messages.push(msg);
        } catch (e) {
          logger.warn('Failed to parse search result', { match, error: String(e) });
        }
      }

      const paging = response.messages?.paging;
      if (!paging || !paging.pages || page >= paging.pages) {
        hasMorePages = false;
      } else {
        page++;
      }
    }

    logger.info('Search completed', { query: fullQuery, count: messages.length });
    return messages;
  }

  async searchMentions(
    userId: string,
    timeRange: DateRange
  ): Promise<SlackMessage[]> {
    // Use the general search method with mention-specific query
    const query = `<@${userId}>`;
    return this.searchMessages(query, timeRange);
  }

  async searchUserMessages(
    userId: string,
    timeRange: DateRange
  ): Promise<SlackMessage[]> {
    // Search for messages sent by this user
    const query = `from:<@${userId}>`;
    return this.searchMessages(query, timeRange);
  }

  async getReactionsGiven(
    userId: string,
    timeRange: DateRange
  ): Promise<Array<{ messageId: string; channel: string; reaction: string; timestamp: string }>> {
    const reactions: Array<{ messageId: string; channel: string; reaction: string; timestamp: string }> = [];
    let page = 1;

    let hasMorePages = true;
    while (hasMorePages) {
      const response = await this.rateLimiter.execute(() =>
        this.client.reactions.list({
          user: userId,
          count: 100,
          page,
          full: true,
        })
      );

      if (!response.ok) {
        throw new Error(`Failed to get reactions: ${response.error}`);
      }

      const items = response.items ?? [];
      for (const item of items) {
        if (item.type !== 'message' || !item.message) continue;

        const msgTs = item.message.ts;
        if (!msgTs) continue;

        // Filter by time range
        const msgTime = parseFloat(msgTs) * 1000;
        if (msgTime < timeRange.start.toMillis() || msgTime > timeRange.end.toMillis()) {
          continue;
        }

        const msgReactions = item.message.reactions ?? [];
        for (const reaction of msgReactions) {
          // Check if this user gave this reaction
          if (reaction.users?.includes(userId) && reaction.name) {
            reactions.push({
              messageId: msgTs,
              channel: item.channel ?? '',
              reaction: reaction.name,
              timestamp: msgTs,
            });
          }
        }
      }

      const paging = response.paging;
      if (!paging || !paging.pages || page >= paging.pages) {
        hasMorePages = false;
      } else {
        page++;
      }
    }

    logger.info('Found reactions given', { userId, count: reactions.length });
    return reactions;
  }

  async getPermalink(channelId: string, messageTs: string): Promise<string> {
    const response = await this.rateLimiter.execute(() =>
      this.client.chat.getPermalink({
        channel: channelId,
        message_ts: messageTs,
      })
    );

    if (!response.ok || !response.permalink) {
      throw new Error(`Failed to get permalink: ${response.error}`);
    }

    return response.permalink;
  }

  /**
   * Fetch a single message by channel ID and timestamp
   * Uses conversations.replies with the message ts to get the exact message
   */
  async getMessage(channelId: string, messageTs: string): Promise<SlackMessage | null> {
    try {
      const response = await this.rateLimiter.execute(() =>
        this.client.conversations.replies({
          channel: channelId,
          ts: messageTs,
          limit: 1,
          inclusive: true,
        })
      );

      if (!response.ok || !response.messages || response.messages.length === 0) {
        return null;
      }

      // The first message in replies is the parent message itself
      const msg = response.messages[0];
      try {
        return SlackMessageSchema.parse({ ...msg, channel: channelId });
      } catch (e) {
        logger.warn('Failed to parse fetched message', { messageTs, error: String(e) });
        return null;
      }
    } catch (error) {
      logger.warn('Failed to fetch message', {
        channelId,
        messageTs,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async getUserInfo(userId: string): Promise<SlackUser> {
    // Check cache first
    const cached = this.userCache.get(userId);
    if (cached) {
      return cached;
    }

    const response = await this.rateLimiter.execute(() =>
      this.client.users.info({ user: userId })
    );

    if (!response.ok || !response.user || !response.user.id) {
      throw new Error(`Failed to get user info: ${response.error}`);
    }

    const user: SlackUser = {
      id: response.user.id,
      name: response.user.name ?? userId,
      // External users may have real_name only in profile, not at top level
      real_name: response.user.real_name ?? response.user.profile?.real_name,
      display_name: response.user.profile?.display_name,
      is_bot: response.user.is_bot,
    };

    this.userCache.set(userId, user);
    return user;
  }

  async getUserDisplayName(userId: string): Promise<string> {
    try {
      const user = await this.getUserInfo(userId);
      return user.real_name || user.display_name || user.name;
    } catch {
      return userId;
    }
  }

  async listUsers(): Promise<SlackUser[]> {
    const users: SlackUser[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.rateLimiter.execute(() =>
        this.client.users.list({
          limit: 200,
          cursor,
        })
      );

      if (!response.ok) {
        throw new Error(`Failed to list users: ${response.error}`);
      }

      const members = response.members ?? [];
      for (const member of members) {
        if (!member.id || member.deleted) continue;

        const user: SlackUser = {
          id: member.id,
          name: member.name ?? member.id,
          real_name: member.real_name,
          display_name: member.profile?.display_name,
          is_bot: member.is_bot,
        };
        users.push(user);
        // Also populate the cache
        this.userCache.set(user.id, user);
      }

      cursor = response.response_metadata?.next_cursor;
    } while (cursor);

    logger.info('Listed users', { count: users.length });
    return users;
  }

  async getChannelInfo(channelId: string): Promise<SlackChannel> {
    const response = await this.rateLimiter.execute(() =>
      this.client.conversations.info({ channel: channelId })
    );

    if (!response.ok || !response.channel) {
      throw new Error(`Failed to get channel info: ${response.error}`);
    }

    const channel = SlackChannelSchema.parse(response.channel);
    return channel;
  }

  clearUserCache(): void {
    this.userCache.clear();
  }
}

// Singleton instance
let globalClient: SlackClient | null = null;

export function getSlackClient(config?: SlackClientConfig): SlackClient {
  if (!globalClient) {
    globalClient = new SlackClient(config);
  }
  return globalClient;
}

export function resetSlackClient(): void {
  globalClient = null;
}
