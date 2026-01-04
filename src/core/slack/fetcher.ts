import { SlackClient, getSlackClient } from './client.js';
import { logger } from '../../utils/logger.js';
import {
  SlackMessage,
  SlackChannel,
  SlackThread,
  SlackReactionItem,
  UserActivityData,
} from '../models/slack.js';
import { type DateRange, formatISO, getDayBucket } from '../../utils/dates.js';
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
} from '../cache/messages.js';
import { DateTime } from 'luxon';
import { getEnv } from '../../utils/env.js';
import { mapWithConcurrency } from '../../utils/concurrency.js';

export interface FetcherOptions {
  client?: SlackClient;
  skipCache?: boolean;
}

export class DataFetcher {
  private client: SlackClient;
  private skipCache: boolean;

  constructor(options: FetcherOptions = {}) {
    this.client = options.client ?? getSlackClient();
    this.skipCache = options.skipCache ?? false;
  }

  async fetchUserActivity(
    userId: string | null,
    timeRange: DateRange
  ): Promise<UserActivityData> {
    // Get current user if not specified
    const targetUserId = userId ?? (await this.client.getCurrentUserId());

    logger.info('Fetching user activity', {
      userId: targetUserId,
      start: formatISO(timeRange.start),
      end: formatISO(timeRange.end),
    });

    // Step 1: Search for user's messages to identify active channels
    // Also get the search results to detect thread participation
    const { channels, userSearchMessages } = await this.fetchActiveChannels(
      targetUserId,
      timeRange
    );

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

    logger.info('Identified threads from search', {
      threadCount: threadTsSet.size,
    });

    // Extend time range by 24 hours for conversation context
    const extendedTimeRange: DateRange = {
      start: timeRange.start.minus({ hours: 24 }),
      end: timeRange.end,
    };

    const totalChannels = channels.length;
    let processedChannels = 0;
    const slackConcurrency = getEnv().SLACK_SUMMARIZER_SLACK_CONCURRENCY;

    logger.info('Fetching channel messages in parallel', {
      totalChannels,
      concurrency: slackConcurrency,
    });

    // Fetch channel messages in parallel
    const channelResults = await mapWithConcurrency(
      channels,
      async (channel) => {
        processedChannels++;
        logger.info('Fetching channel messages', {
          progress: `${processedChannels}/${totalChannels}`,
          channelName: channel.name,
        });

        const channelMessages = await this.fetchChannelMessages(
          channel.id,
          targetUserId,
          extendedTimeRange
        );

        return { channelId: channel.id, messages: channelMessages };
      },
      slackConcurrency
    );

    // Process results
    for (const { channelId, messages: channelMessages } of channelResults) {
      for (const msg of channelMessages.allMessages) {
        allMessages.push(msg);
        if (msg.user === targetUserId) {
          messagesSent.push(msg);
        }

        // Also track threads from channel history (in case we missed any)
        if (msg.thread_ts && msg.user === targetUserId) {
          threadTsSet.add(`${channelId}:${msg.thread_ts}`);
        }
      }
    }

    // Step 3: Fetch full threads the user participated in (in parallel)
    logger.info('Fetching thread details in parallel', {
      threadCount: threadTsSet.size,
      concurrency: slackConcurrency,
    });

    const threadKeys = Array.from(threadTsSet);
    const threadResults = await mapWithConcurrency(
      threadKeys,
      async (threadKey) => {
        const [channelId, threadTs] = threadKey.split(':');
        const threadMessages = await this.fetchThreadReplies(channelId, threadTs);
        return {
          threadTs,
          channel: channelId,
          messages: threadMessages,
        };
      },
      slackConcurrency
    );

    threadsParticipated.push(...threadResults);

    // Step 4: Fetch @mentions
    const mentionsReceived = await this.fetchMentions(targetUserId, timeRange);

    // Step 5: Fetch reactions given
    const reactionsGiven = await this.fetchReactions(targetUserId, timeRange);

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

    logger.info('Fetched user activity', {
      userId: targetUserId,
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
        logger.debug('Using cached channels', { count: cached.length });
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
    logger.info('Searching for user messages to identify active channels', {
      userId,
      start: formatISO(timeRange.start),
      end: formatISO(timeRange.end),
    });

    // Search for messages sent by this user in the time range
    let userMessages: SlackMessage[];
    try {
      userMessages = await this.client.searchUserMessages(userId, timeRange);
    } catch (error) {
      logger.warn('Search API failed, falling back to all channels', {
        error: error instanceof Error ? error.message : String(error),
      });
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

    logger.info('Identified active channels from search', {
      messagesFound: userMessages.length,
      activeChannelCount: activeChannelIds.size,
    });

    // If no active channels found, return empty (user had no activity)
    if (activeChannelIds.size === 0) {
      logger.info('No user activity found in time range');
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

    logger.info('Filtered to active channels', {
      totalChannels: allChannels.length,
      activeChannels: activeChannels.length,
    });

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
        logger.debug('Using cached messages for day', { channelId, dayBucket, count: cached.length });
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
        logger.debug('Using cached mentions', { userId, count: cached.length });
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
        logger.debug('Using cached reactions', { userId, count: cached.length });
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
