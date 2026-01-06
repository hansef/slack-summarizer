import { SlackClient, getSlackClient } from './client.js';
import { createLogger, createTimer, type Logger, type Timer } from '@/utils/logging/index.js';
import {
  SlackMessage,
  SlackChannel,
  SlackThread,
  SlackReactionItem,
  UserActivityData,
} from '@/core/models/slack.js';
import { type DateRange, formatISO, getDayBucket } from '@/utils/dates.js';
import {
  isDayFetched,
  markDayFetched,
  cacheMessages,
  getCachedMessages,
  cacheMentions,
  getCachedMentions,
  cacheReactions,
  getCachedReactions,
  cacheChannel,
  getCachedChannels,
} from '@/core/cache/messages.js';
import { DateTime } from 'luxon';
import { getEnv } from '@/utils/env.js';
import { mapWithConcurrency } from '@/utils/concurrency.js';

export interface FetcherOptions {
  client?: SlackClient;
  skipCache?: boolean;
}

export class DataFetcher {
  private client: SlackClient;
  private skipCache: boolean;
  private logger: Logger;
  private timer: Timer;

  constructor(options: FetcherOptions = {}) {
    this.client = options.client ?? getSlackClient();
    this.skipCache = options.skipCache ?? false;
    this.logger = createLogger({ component: 'DataFetcher' });
    this.timer = createTimer(this.logger);
  }

  async fetchUserActivity(
    userId: string | null,
    timeRange: DateRange
  ): Promise<UserActivityData> {
    this.timer.start('fetchUserActivity:total');
    // Get current user if not specified
    const targetUserId = userId ?? (await this.client.getCurrentUserId());

    this.logger.debug(
      { userId: targetUserId, start: formatISO(timeRange.start), end: formatISO(timeRange.end) },
      'Fetching user activity'
    );

    // Step 1: Search for user's messages to identify active channels
    // Also get the search results to detect thread participation
    this.timer.start('fetchUserActivity:fetchActiveChannels');
    const { channels, userSearchMessages } = await this.fetchActiveChannels(
      targetUserId,
      timeRange
    );
    this.timer.end('fetchUserActivity:fetchActiveChannels', {
      channels: channels.length,
      searchMessages: userSearchMessages.length,
    });

    // Step 2: Fetch full channel history with 24h lookback for context
    const messagesSent: SlackMessage[] = [];
    const allMessages: SlackMessage[] = [];
    const threadsParticipated: SlackThread[] = [];
    const threadTsSet = new Set<string>();

    // First, identify threads from search results (this catches thread replies
    // that aren't in channel history)
    for (const msg of userSearchMessages) {
      if (msg.thread_ts && msg.channel) {
        threadTsSet.add(`${msg.channel}:${msg.thread_ts}`);
      }
    }

    this.logger.debug({ threadCount: threadTsSet.size }, 'Identified threads from search');

    // Extend time range by 24 hours for conversation context
    const extendedTimeRange: DateRange = {
      start: timeRange.start.minus({ hours: 24 }),
      end: timeRange.end,
    };

    const totalChannels = channels.length;
    let processedChannels = 0;
    const slackConcurrency = getEnv().SLACK_SUMMARIZER_SLACK_CONCURRENCY;

    this.logger.debug(
      { totalChannels, concurrency: slackConcurrency },
      'Fetching channel messages in parallel'
    );

    // Fetch channel messages in parallel
    this.timer.start('fetchUserActivity:fetchChannelMessages');
    const channelResults = await mapWithConcurrency(
      channels,
      async (channel) => {
        processedChannels++;
        this.logger.info(
          { progress: `${processedChannels}/${totalChannels}`, channelName: channel.name },
          'Fetching channel messages'
        );

        const channelMessages = await this.fetchChannelMessages(
          channel.id,
          targetUserId,
          extendedTimeRange
        );

        return { channelId: channel.id, messages: channelMessages };
      },
      slackConcurrency
    );
    this.timer.end('fetchUserActivity:fetchChannelMessages', { channels: channelResults.length });

    // Process results
    // Note: We fetch with extended time range (24h lookback) for context,
    // but messagesSent should only include messages within the original time range
    const originalStartMs = timeRange.start.toMillis();
    const originalEndMs = timeRange.end.toMillis();

    for (const { channelId, messages: channelMessages } of channelResults) {
      for (const msg of channelMessages.allMessages) {
        allMessages.push(msg);

        // Only count as "sent" if within the ORIGINAL time range (not the 24h lookback)
        const msgTimeMs = parseFloat(msg.ts) * 1000;
        const isWithinOriginalRange = msgTimeMs >= originalStartMs && msgTimeMs <= originalEndMs;

        if (msg.user === targetUserId && isWithinOriginalRange) {
          messagesSent.push(msg);
        }

        // Also track threads from channel history (in case we missed any)
        // Still use extended range for thread discovery to get full context
        if (msg.thread_ts && msg.user === targetUserId) {
          threadTsSet.add(`${channelId}:${msg.thread_ts}`);
        }
      }
    }

    // Step 3: Fetch full threads the user participated in (in parallel)
    this.logger.debug(
      { threadCount: threadTsSet.size, concurrency: slackConcurrency },
      'Fetching thread details in parallel'
    );

    this.timer.start('fetchUserActivity:fetchThreads');
    const threadKeys = Array.from(threadTsSet);
    const threadResults = await mapWithConcurrency(
      threadKeys,
      async (threadKey) => {
        const [channelId, threadTs] = threadKey.split(':');
        const threadMessages = await this.fetchThreadReplies(channelId, threadTs);

        // Filter thread messages to only include those within the original time range
        // This prevents threads that started before the range from polluting the summary
        const filteredMessages = threadMessages.filter((msg) => {
          const msgTimeMs = parseFloat(msg.ts) * 1000;
          return msgTimeMs >= originalStartMs && msgTimeMs <= originalEndMs;
        });

        return {
          threadTs,
          channel: channelId,
          messages: filteredMessages,
        };
      },
      slackConcurrency
    );
    this.timer.end('fetchUserActivity:fetchThreads', { threads: threadResults.length });

    // Only include threads that have messages within the time range
    const filteredThreads = threadResults.filter((t) => t.messages.length > 0);
    threadsParticipated.push(...filteredThreads);

    // Step 4: Fetch @mentions
    this.timer.start('fetchUserActivity:fetchMentions');
    const mentionsReceived = await this.fetchMentions(targetUserId, timeRange);
    this.timer.end('fetchUserActivity:fetchMentions', { mentions: mentionsReceived.length });

    // Step 5: Fetch reactions given
    this.timer.start('fetchUserActivity:fetchReactions');
    const reactionsGiven = await this.fetchReactions(targetUserId, timeRange);
    this.timer.end('fetchUserActivity:fetchReactions', { reactions: reactionsGiven.length });

    const result: UserActivityData = {
      userId: targetUserId,
      timeRange: {
        start: formatISO(timeRange.start),
        end: formatISO(timeRange.end),
      },
      messagesSent,
      mentionsReceived,
      threadsParticipated,
      reactionsGiven,
      channels,
      allChannelMessages: allMessages,
    };

    this.timer.end('fetchUserActivity:total', {
      messagesSent: messagesSent.length,
      mentionsReceived: mentionsReceived.length,
      threadsParticipated: threadsParticipated.length,
      reactionsGiven: reactionsGiven.length,
      channelsActive: channels.length,
    });

    return result;
  }

  private async fetchChannels(): Promise<SlackChannel[]> {
    // Check cache first
    if (!this.skipCache) {
      const cached = getCachedChannels();
      if (cached.length > 0) {
        this.logger.debug({ count: cached.length }, 'Using cached channels');
        return cached;
      }
    }

    // Fetch from API
    const channels = await this.client.listChannels();

    // Cache channels
    for (const channel of channels) {
      cacheChannel(channel);
    }

    return channels;
  }

  private async fetchActiveChannels(
    userId: string,
    timeRange: DateRange
  ): Promise<{
    channels: SlackChannel[];
    channelMap: Map<string, SlackChannel>;
    userSearchMessages: SlackMessage[];
  }> {
    this.logger.debug(
      { userId, start: formatISO(timeRange.start), end: formatISO(timeRange.end) },
      'Searching for user messages to identify active channels'
    );

    // Search for messages sent by this user in the time range
    let userMessages: SlackMessage[];
    try {
      userMessages = await this.client.searchUserMessages(userId, timeRange);
    } catch (error) {
      this.logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'Search API failed, falling back to all channels'
      );
      // Fallback: return all channels if search fails
      const allChannels = await this.fetchChannels();
      const channelMap = new Map<string, SlackChannel>();
      for (const channel of allChannels) {
        channelMap.set(channel.id, channel);
      }
      return { channels: allChannels, channelMap, userSearchMessages: [] };
    }

    // Extract unique channel IDs from search results
    const activeChannelIds = new Set<string>();
    for (const msg of userMessages) {
      if (msg.channel) {
        activeChannelIds.add(msg.channel);
      }
    }

    this.logger.debug(
      { messagesFound: userMessages.length, activeChannelCount: activeChannelIds.size },
      'Identified active channels from search'
    );

    // If no active channels found, return empty (user had no activity)
    if (activeChannelIds.size === 0) {
      this.logger.info('No user activity found in time range');
      return { channels: [], channelMap: new Map(), userSearchMessages: [] };
    }

    // Fetch full channel metadata (uses cache if available)
    const allChannels = await this.fetchChannels();

    // Filter to only active channels and build lookup map
    const channelMap = new Map<string, SlackChannel>();
    const activeChannels: SlackChannel[] = [];

    for (const channel of allChannels) {
      if (activeChannelIds.has(channel.id)) {
        activeChannels.push(channel);
        channelMap.set(channel.id, channel);
      }
    }

    this.logger.debug(
      { totalChannels: allChannels.length, activeChannels: activeChannels.length },
      'Filtered to active channels'
    );

    return { channels: activeChannels, channelMap, userSearchMessages: userMessages };
  }

  private async fetchChannelMessages(
    channelId: string,
    userId: string,
    timeRange: DateRange
  ): Promise<{ allMessages: SlackMessage[]; userMessages: SlackMessage[] }> {
    const allMessages: SlackMessage[] = [];
    const userMessages: SlackMessage[] = [];

    // Iterate through each day in the range
    const days = this.getDayBuckets(timeRange);

    for (const dayBucket of days) {
      const dayRange = this.getDayRange(dayBucket);

      // Check cache for this day
      if (!this.skipCache && isDayFetched(userId, channelId, dayBucket, 'messages')) {
        const cached = getCachedMessages(channelId, dayRange);
        for (const msg of cached) {
          allMessages.push(msg);
          if (msg.user === userId) {
            userMessages.push(msg);
          }
        }
        this.logger.debug({ channelId, dayBucket, count: cached.length }, 'Using cached messages for day');
        continue;
      }

      // Fetch from API
      const messages = await this.client.getChannelHistory(channelId, dayRange);

      // Cache the messages
      cacheMessages(channelId, messages);
      markDayFetched(userId, channelId, dayBucket, 'messages');

      for (const msg of messages) {
        allMessages.push(msg);
        if (msg.user === userId) {
          userMessages.push(msg);
        }
      }
    }

    return { allMessages, userMessages };
  }

  private async fetchThreadReplies(
    channelId: string,
    threadTs: string
  ): Promise<SlackMessage[]> {
    // For threads, we always fetch fresh since they can be updated
    const messages = await this.client.getThreadReplies(channelId, threadTs);
    return messages;
  }

  private async fetchMentions(
    userId: string,
    timeRange: DateRange
  ): Promise<SlackMessage[]> {
    // Check cache for mentions
    if (!this.skipCache) {
      const days = this.getDayBuckets(timeRange);
      let allCached = true;

      for (const dayBucket of days) {
        if (!isDayFetched(userId, 'mentions', dayBucket, 'mentions')) {
          allCached = false;
          break;
        }
      }

      if (allCached) {
        const cached = getCachedMentions(userId, timeRange);
        this.logger.debug({ userId, count: cached.length }, 'Using cached mentions');
        return cached;
      }
    }

    // Fetch from API
    const mentions = await this.client.searchMentions(userId, timeRange);

    // Cache the mentions
    cacheMentions(userId, mentions);

    // Mark days as fetched
    const days = this.getDayBuckets(timeRange);
    for (const dayBucket of days) {
      markDayFetched(userId, 'mentions', dayBucket, 'mentions');
    }

    return mentions;
  }

  private async fetchReactions(
    userId: string,
    timeRange: DateRange
  ): Promise<SlackReactionItem[]> {
    // Check cache for reactions
    if (!this.skipCache) {
      const days = this.getDayBuckets(timeRange);
      let allCached = true;

      for (const dayBucket of days) {
        if (!isDayFetched(userId, 'reactions', dayBucket, 'reactions')) {
          allCached = false;
          break;
        }
      }

      if (allCached) {
        const cached = getCachedReactions(userId, timeRange);
        this.logger.debug({ userId, count: cached.length }, 'Using cached reactions');
        return cached;
      }
    }

    // Fetch from API
    const reactions = await this.client.getReactionsGiven(userId, timeRange);

    // Cache the reactions
    cacheReactions(userId, reactions);

    // Mark days as fetched
    const days = this.getDayBuckets(timeRange);
    for (const dayBucket of days) {
      markDayFetched(userId, 'reactions', dayBucket, 'reactions');
    }

    return reactions;
  }

  private getDayBuckets(timeRange: DateRange): string[] {
    const buckets: string[] = [];
    let current = timeRange.start.startOf('day');
    const end = timeRange.end.startOf('day');

    while (current <= end) {
      buckets.push(getDayBucket(current));
      current = current.plus({ days: 1 });
    }

    return buckets;
  }

  private getDayRange(dayBucket: string): DateRange {
    const day = DateTime.fromISO(dayBucket, {
      zone: getEnv().SLACK_SUMMARIZER_TIMEZONE,
    });

    return {
      start: day.startOf('day'),
      end: day.endOf('day'),
    };
  }
}

// Factory function
export function createDataFetcher(options?: FetcherOptions): DataFetcher {
  return new DataFetcher(options);
}
