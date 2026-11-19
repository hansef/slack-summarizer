import { WebClient } from '@slack/web-api';
import { getEnv } from '@/utils/env.js';
import { createLogger, type Logger } from '@/utils/logging/index.js';
import { getRateLimiter, RateLimiter } from './rate-limiter.js';
import {
  SlackChannel,
  SlackChannelSchema,
  SlackMessage,
  SlackMessageSchema,
  SlackUser,
  AuthTestResponse,
  AuthTestResponseSchema,
} from '@/core/models/slack.js';
export type { SlackUser } from '@/core/models/slack.js';
import type { DateRange } from '@/utils/dates.js';
import { toSlackTimestamp } from '@/utils/dates.js';

export interface SlackClientConfig {
  token?: string;
  rateLimiter?: RateLimiter;
}

const CONNECT_LOOKUP_CONCURRENCY = 8;

interface RawSlackUser {
  id?: string;
  name?: string;
  real_name?: string;
  is_bot?: boolean;
  profile?: { real_name?: string; display_name?: string };
}

function toSlackUser(raw: RawSlackUser, fallbackId: string): SlackUser {
  return {
    id: raw.id ?? fallbackId,
    name: raw.name ?? fallbackId,
    // External users may have real_name only in profile, not at top level
    real_name: raw.real_name ?? raw.profile?.real_name,
    display_name: raw.profile?.display_name,
    is_bot: raw.is_bot,
  };
}

/** Maps over items with at most `concurrency` calls in flight, preserving order */
async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface SearchOptions {
  /** Timestamp sort direction; defaults to 'asc' for the summarization pipeline */
  sort?: 'asc' | 'desc';
  /** Stop paging once at least this many matches are collected */
  maxResults?: number;
}

export class SlackClient {
  private client: WebClient;
  private rateLimiter: RateLimiter;
  private userId: string | null = null;
  private userCache = new Map<string, SlackUser>();
  private memo = new Map<string, Promise<unknown>>();
  private logger: Logger;

  constructor(config: SlackClientConfig = {}) {
    const token = config.token ?? getEnv().SLACK_USER_TOKEN;
    this.client = new WebClient(token);
    this.rateLimiter = config.rateLimiter ?? getRateLimiter();
    this.logger = createLogger({ component: 'SlackClient' });
  }

  async authenticate(): Promise<AuthTestResponse> {
    const response = await this.rateLimiter.execute(() => this.client.auth.test());

    const parsed = AuthTestResponseSchema.parse(response);
    this.userId = parsed.user_id;

    this.logger.info(
      { user: parsed.user, team: parsed.team, userId: parsed.user_id },
      'Authenticated with Slack'
    );

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
          this.logger.warn({ channel: ch, error: String(e) }, 'Failed to parse channel');
        }
      }

      cursor = response.response_metadata?.next_cursor;
    } while (cursor);

    this.logger.debug({ count: channels.length }, 'Listed channels');
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
          this.logger.warn({ message: msg, error: String(e) }, 'Failed to parse message');
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
          this.logger.warn({ message: msg, error: String(e) }, 'Failed to parse reply');
        }
      }

      cursor = response.response_metadata?.next_cursor;
    } while (cursor);

    return messages;
  }

  async searchMessages(
    query: string,
    timeRange?: Partial<DateRange>,
    options: SearchOptions = {}
  ): Promise<SlackMessage[]> {
    const { sort = 'asc', maxResults } = options;
    const messages: SlackMessage[] = [];
    let page = 1;

    // Slack's after: and before: are both exclusive, so adjust boundaries
    // after:2025-12-07 before:2025-12-09 captures messages on Dec 8
    const fullQuery = [
      query,
      timeRange?.start && `after:${timeRange.start.minus({ days: 1 }).toFormat('yyyy-MM-dd')}`,
      timeRange?.end && `before:${timeRange.end.plus({ days: 1 }).toFormat('yyyy-MM-dd')}`,
    ]
      .filter(Boolean)
      .join(' ');

    let hasMorePages = true;
    while (hasMorePages) {
      const response = await this.rateLimiter.execute(() =>
        this.client.search.messages({
          query: fullQuery,
          sort: 'timestamp',
          sort_dir: sort,
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
          this.logger.warn({ match, error: String(e) }, 'Failed to parse search result');
        }
      }

      const paging = response.messages?.paging;
      if (maxResults !== undefined && messages.length >= maxResults) {
        hasMorePages = false;
      } else if (!paging || !paging.pages || page >= paging.pages) {
        hasMorePages = false;
      } else {
        page++;
      }
    }

    this.logger.debug({ query: fullQuery, count: messages.length }, 'Search completed');
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

    this.logger.debug({ userId, count: reactions.length }, 'Found reactions given');
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
        this.logger.warn({ messageTs, error: String(e) }, 'Failed to parse fetched message');
        return null;
      }
    } catch (error) {
      this.logger.warn(
        { channelId, messageTs, error: error instanceof Error ? error.message : String(error) },
        'Failed to fetch message'
      );
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

    const user = toSlackUser(response.user, userId);
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

    this.logger.debug({ count: users.length }, 'Listed users');
    return users;
  }

  /**
   * Resolves a user ID, <@ID> mention, @handle, display name or real name to a
   * user ID. Exact matches win over partial ones; ambiguity or no match throws
   * with enough detail for the caller to retry with an ID.
   *
   * users.list omits Slack Connect users from other orgs, so when no workspace
   * member matches exactly, the directory expands to members of shared
   * channels and DMs. That costs one users.info call per external user, once
   * per client.
   */
  async resolveUser(input: string): Promise<string> {
    const trimmed = input.trim();
    const mention = /^<@([UW][A-Z0-9]+)(?:\|[^>]*)?>$/.exec(trimmed);
    if (mention) return mention[1];
    if (/^[UW](?=[A-Z0-9]*\d)[A-Z0-9]{6,}$/.test(trimmed)) return trimmed;

    const needle = trimmed.replace(/^@/, '').toLowerCase();
    const namesOf = (u: SlackUser): string[] =>
      [u.name, u.display_name, u.real_name].filter((n): n is string => !!n).map((n) => n.toLowerCase());

    const workspace = await this.memoized('workspaceUsers', () => this.listUsers());
    const workspaceExact = workspace.filter((u) => namesOf(u).includes(needle));
    if (workspaceExact.length === 1) return workspaceExact[0].id;

    const external = await this.memoized('connectUsers', () =>
      this.listConnectUsers(new Set(workspace.map((u) => u.id)))
    );
    const users = [...workspace, ...external];
    const exact = users.filter((u) => namesOf(u).includes(needle));
    const matches = exact.length > 0 ? exact : users.filter((u) => namesOf(u).some((n) => n.includes(needle)));

    if (matches.length === 1) return matches[0].id;
    if (matches.length === 0) {
      throw new Error(
        `No Slack user matches "${input}". Pass a user ID, @handle, display name or full name.`
      );
    }
    const candidates = matches
      .slice(0, 10)
      .map((u) => `${u.id} (${u.real_name || u.display_name || u.name})`)
      .join(', ');
    throw new Error(`"${input}" matches ${matches.length} Slack users: ${candidates}. Pass one of these IDs.`);
  }

  /**
   * Users from other orgs reachable through Slack Connect channels and DMs.
   *
   * This is a one-off burst of a few hundred calls. It bypasses the serial
   * rate limiter, which would stretch it to about a minute, and relies on
   * WebClient's own Retry-After handling for 429s.
   */
  private async listConnectUsers(known: Set<string>): Promise<SlackUser[]> {
    const ids = new Set<string>();
    const channels = await this.listChannels();

    for (const ch of channels) {
      if (ch.is_im && ch.user && !known.has(ch.user)) ids.add(ch.user);
    }

    await mapConcurrent(
      channels.filter((c) => c.is_ext_shared),
      CONNECT_LOOKUP_CONCURRENCY,
      async (ch) => {
        try {
          let cursor: string | undefined;
          do {
            const response = await this.client.conversations.members({ channel: ch.id, limit: 1000, cursor });
            for (const id of response.members ?? []) {
              if (!known.has(id)) ids.add(id);
            }
            cursor = response.response_metadata?.next_cursor || undefined;
          } while (cursor);
        } catch (e) {
          this.logger.warn({ channel: ch.id, error: String(e) }, 'Failed to list channel members');
        }
      }
    );

    const users = await mapConcurrent(Array.from(ids), CONNECT_LOOKUP_CONCURRENCY, async (id) => {
      const cached = this.userCache.get(id);
      if (cached) return cached;
      try {
        const response = await this.client.users.info({ user: id });
        if (!response.user?.id || response.user.deleted) return null;
        const user = toSlackUser(response.user, id);
        this.userCache.set(id, user);
        return user;
      } catch (e) {
        this.logger.warn({ userId: id, error: String(e) }, 'Failed to get user info');
        return null;
      }
    });

    const found = users.filter((u): u is SlackUser => u !== null);
    this.logger.debug({ count: found.length }, 'Listed Slack Connect users');
    return found;
  }

  /** Caches a fetch for the client's lifetime; a failure is dropped so the next call retries */
  private memoized<T>(key: string, fetch: () => Promise<T>): Promise<T> {
    let pending = this.memo.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = fetch().catch((e: unknown) => {
        this.memo.delete(key);
        throw e;
      });
      this.memo.set(key, pending);
    }
    return pending;
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
