import { SlackClient, getSlackClient } from '@/core/slack/client.js';
import { DataFetcher, createDataFetcher } from '@/core/slack/fetcher.js';
import { hybridSegmentation } from '@/core/segmentation/hybrid.js';
import { consolidateConversations, ConversationGroup } from '@/core/consolidation/consolidator.js';
import { parseSlackMessageLinks } from '@/core/consolidation/reference-extractor.js';
import { SummarizationClient, getSummarizationClient } from './client.js';
import { logger } from '@/utils/logger.js';
import { getEnv } from '@/utils/env.js';
import { parseTimespan, formatISO, now } from '@/utils/dates.js';
import { mapWithConcurrency, mapWithGlobalClaudeLimiter } from '@/utils/concurrency.js';
import {
  SummaryOutput,
  ChannelSummary,
  ConversationSummary,
} from '@/core/models/summary.js';
import {
  UserActivityData,
  getChannelType,
  SlackChannel,
  SlackAttachment,
} from '@/core/models/slack.js';

export interface ProgressEvent {
  stage: 'fetching' | 'segmenting' | 'consolidating' | 'summarizing' | 'complete';
  message: string;
  current?: number;
  total?: number;
}

export type ProgressCallback = (event: ProgressEvent) => void;
export interface AggregatorConfig {
  slackClient?: SlackClient;
  summarizationClient?: SummarizationClient;
  dataFetcher?: DataFetcher;
  onProgress?: ProgressCallback;
}

export class SummaryAggregator {
  private slackClient: SlackClient;
  private summarizationClient: SummarizationClient;
  private dataFetcher: DataFetcher;
  private onProgress?: ProgressCallback;

  constructor(config: AggregatorConfig = {}) {
    this.slackClient = config.slackClient ?? getSlackClient();
    this.summarizationClient = config.summarizationClient ?? getSummarizationClient();
    this.dataFetcher = config.dataFetcher ?? createDataFetcher();
    this.onProgress = config.onProgress;
  }

  private emitProgress(event: ProgressEvent): void {
    this.onProgress?.(event);
  }

  async generateSummary(
    timespan: string,
    userId?: string
  ): Promise<SummaryOutput> {
    logger.timeStart('generateSummary:total');
    const timeRange = parseTimespan(timespan);
    const targetUserId = userId ?? (await this.slackClient.getCurrentUserId());
    const timezone = getEnv().SLACK_SUMMARIZER_TIMEZONE;

    logger.debug('Generating summary', {
      userId: targetUserId,
      timespan,
      start: formatISO(timeRange.start),
      end: formatISO(timeRange.end),
    });

    // Step 1: Fetch all user activity
    this.emitProgress({ stage: 'fetching', message: 'Searching for Slack activity...' });
    logger.timeStart('generateSummary:fetchUserActivity');
    const activity = await this.dataFetcher.fetchUserActivity(targetUserId, timeRange);
    logger.timeEnd('generateSummary:fetchUserActivity', {
      messagesSent: activity.messagesSent.length,
      channels: activity.channels.length,
      threads: activity.threadsParticipated.length,
    });

    // Step 2: Build user display names map (bulk fetch all workspace users)
    logger.timeStart('generateSummary:buildUserDisplayNames');
    const userDisplayNames = await this.buildUserDisplayNames();
    logger.timeEnd('generateSummary:buildUserDisplayNames', { count: userDisplayNames.size });

    // Step 3: Group messages by channel, segment, consolidate, and summarize
    this.emitProgress({ stage: 'segmenting', message: 'Processing conversations...', total: activity.channels.length });
    logger.debug('Segmenting, consolidating, and summarizing conversations...');
    logger.timeStart('generateSummary:buildChannelSummaries');
    const channelSummaries = await this.buildChannelSummaries(
      activity,
      targetUserId,
      userDisplayNames
    );
    logger.timeEnd('generateSummary:buildChannelSummaries', { channels: channelSummaries.length });

    // Step 4: Calculate aggregate statistics
    const summary = this.calculateAggregateStats(activity);

    // Step 5: Build final output
    const output: SummaryOutput = {
      metadata: {
        generated_at: formatISO(now()),
        schema_version: '2.0.0',
        request: {
          user_id: targetUserId,
          period_start: formatISO(timeRange.start),
          period_end: formatISO(timeRange.end),
          timezone,
        },
      },
      summary: {
        total_channels: channelSummaries.length,
        total_messages: summary.totalMessages,
        mentions_received: summary.mentionsReceived,
        threads_participated: summary.threadsParticipated,
        reactions_given: summary.reactionsGiven,
      },
      channels: channelSummaries,
    };

    this.emitProgress({ stage: 'complete', message: 'Summary complete' });
    logger.timeEnd('generateSummary:total', {
      channels: output.summary.total_channels,
      messages: output.summary.total_messages,
    });

    return output;
  }

  private async buildUserDisplayNames(): Promise<Map<string, string>> {
    // Bulk fetch all users from the workspace
    const users = await this.slackClient.listUsers();

    const displayNames = new Map<string, string>();
    for (const user of users) {
      // Priority: real_name > display_name > name
      const displayName = user.real_name || user.display_name || user.name;
      displayNames.set(user.id, displayName);
    }

    return displayNames;
  }

  /**
   * Parses usernames from an MPIM channel name format.
   * Format: "mpdm-stephanie.walker--kyle.hughes--amanda.cadet--hansef-1"
   * Returns: ["Stephanie", "Kyle", "Amanda", "Hansef"]
   */
  private parseMpimChannelName(channelName: string): string[] {
    // Remove "mpdm-" prefix and trailing "-N" suffix
    const match = channelName.match(/^mpdm-(.+)-\d+$/);
    if (!match) return [];

    const usernamesPart = match[1];
    const usernames = usernamesPart.split('--');

    // Convert each username to a capitalized first name
    return usernames.map((username) => {
      // Handle email-style usernames (user@domain.com)
      const namePart = username.split('@')[0];
      // Take first part if dot-separated (e.g., "stephanie.walker" -> "stephanie")
      const firstName = namePart.split('.')[0];
      // Capitalize first letter
      return firstName.charAt(0).toUpperCase() + firstName.slice(1);
    });
  }

  private async resolveChannelDisplayName(
    channel: SlackChannel | undefined,
    channelId: string,
    currentUserId: string,
    userDisplayNames: Map<string, string>
  ): Promise<string> {
    if (!channel) {
      return channelId;
    }

    // DM channels - show other user's name
    if (channel.is_im) {
      // Try to get the user field from channel info
      let otherUserId = channel.user;

      // If not available, fetch channel info to get the user field
      if (!otherUserId) {
        try {
          const fullChannelInfo = await this.slackClient.getChannelInfo(channelId);
          otherUserId = fullChannelInfo.user;
        } catch (error) {
          logger.warn('Failed to get DM channel info', {
            channelId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (otherUserId) {
        const userName = userDisplayNames.get(otherUserId);
        if (userName) {
          return userName;
        }
        // Fallback: try to fetch the user directly
        try {
          return await this.slackClient.getUserDisplayName(otherUserId);
        } catch {
          return otherUserId;
        }
      }
    }

    // MPIM channels - show "Group: FirstName1, FirstName2, ..."
    if (channel.is_mpim) {
      let memberIds = channel.members;

      // If not available, fetch channel info to get the members
      if (!memberIds || memberIds.length === 0) {
        try {
          const fullChannelInfo = await this.slackClient.getChannelInfo(channelId);
          memberIds = fullChannelInfo.members;
        } catch (error) {
          logger.warn('Failed to get MPIM channel info', {
            channelId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (memberIds && memberIds.length > 0) {
        // Get first names of all members except current user
        const firstNames: string[] = [];
        for (const memberId of memberIds) {
          if (memberId === currentUserId) continue;

          let fullName = userDisplayNames.get(memberId);
          if (!fullName) {
            try {
              fullName = await this.slackClient.getUserDisplayName(memberId);
            } catch {
              // API lookup failed - will use parsed name fallback below
              fullName = undefined;
            }
          }

          if (fullName) {
            // Extract first name from display name
            const firstName = fullName.split(' ')[0];
            firstNames.push(firstName);
          }
        }

        if (firstNames.length > 0) {
          return `Group: ${firstNames.join(', ')}`;
        }
      }

      // Fallback: parse names from the MPIM channel name (handles external/departed users)
      if (channel.name) {
        let parsedNames = this.parseMpimChannelName(channel.name);

        // Filter out the current user's name from the parsed list
        const currentUserName = userDisplayNames.get(currentUserId);
        if (currentUserName) {
          const currentUserFirstName = currentUserName.split(' ')[0].toLowerCase();
          parsedNames = parsedNames.filter(
            (name) => name.toLowerCase() !== currentUserFirstName
          );
        }

        if (parsedNames.length > 0) {
          return `Group: ${parsedNames.join(', ')}`;
        }
      }

      // Current user is the only member in the group or no names could be resolved
      return 'Group Chat';
    }

    // Regular channels with names - use the name directly
    if (channel.name) {
      return channel.name;
    }

    // Fallback to channel ID
    return channelId;
  }

  private async buildChannelSummaries(
    activity: UserActivityData,
    userId: string,
    userDisplayNames: Map<string, string>
  ): Promise<ChannelSummary[]> {
    const channelSummaries: ChannelSummary[] = [];

    // Group messages by channel
    const messagesByChannel = new Map<string, typeof activity.messagesSent>();
    const mentionsByChannel = new Map<string, typeof activity.mentionsReceived>();
    const threadsByChannel = new Map<string, typeof activity.threadsParticipated>();
    const allMessagesByChannel = new Map<string, typeof activity.messagesSent>();

    for (const msg of activity.messagesSent) {
      const existing = messagesByChannel.get(msg.channel) ?? [];
      existing.push(msg);
      messagesByChannel.set(msg.channel, existing);
    }

    for (const msg of activity.mentionsReceived) {
      const existing = mentionsByChannel.get(msg.channel) ?? [];
      existing.push(msg);
      mentionsByChannel.set(msg.channel, existing);
    }

    for (const thread of activity.threadsParticipated) {
      const existing = threadsByChannel.get(thread.channel) ?? [];
      existing.push(thread);
      threadsByChannel.set(thread.channel, existing);
    }

    // Group all channel messages (for context enrichment)
    if (activity.allChannelMessages) {
      for (const msg of activity.allChannelMessages) {
        const existing = allMessagesByChannel.get(msg.channel) ?? [];
        existing.push(msg);
        allMessagesByChannel.set(msg.channel, existing);
      }
    }

    // Get all unique channel IDs
    const channelIds = new Set([
      ...messagesByChannel.keys(),
      ...mentionsByChannel.keys(),
      ...threadsByChannel.keys(),
    ]);

    // Build channel info map
    const channelInfoMap = new Map<string, SlackChannel>();
    for (const channel of activity.channels) {
      channelInfoMap.set(channel.id, channel);
    }

    const totalChannels = channelIds.size;
    let processedChannels = 0;
    const env = getEnv();
    const channelConcurrency = env.SLACK_SUMMARIZER_CHANNEL_CONCURRENCY;

    logger.debug('Processing channels in parallel', {
      totalChannels,
      concurrency: channelConcurrency,
    });

    // Process channels in parallel with concurrency limit
    const channelIdArray = Array.from(channelIds);
    const results = await mapWithConcurrency(
      channelIdArray,
      async (channelId) => {
        const channelStartTime = performance.now();
        const channelInfo = channelInfoMap.get(channelId);
        const channelType = channelInfo ? getChannelType(channelInfo) : 'public_channel';
        const channelName = await this.resolveChannelDisplayName(
          channelInfo,
          channelId,
          userId,
          userDisplayNames
        );

        processedChannels++;
        this.emitProgress({
          stage: 'summarizing',
          message: `#${channelName}`,
          current: processedChannels,
          total: totalChannels,
        });
        logger.info('Processing channel', {
          progress: `${processedChannels}/${totalChannels}`,
          channel: channelName,
        });

        const messages = messagesByChannel.get(channelId) ?? [];
        const mentions = mentionsByChannel.get(channelId) ?? [];
        const threads = threadsByChannel.get(channelId) ?? [];
        const allChannelMsgs = allMessagesByChannel.get(channelId) ?? [];

        // Step 1: Segment conversations using hybrid approach
        // Pass all channel messages for context enrichment
        const segmentStart = performance.now();
        const segmentResult = await hybridSegmentation(
          messages,
          threads,
          channelId,
          channelName,
          userId,
          allChannelMsgs
        );
        const segmentDuration = performance.now() - segmentStart;

        logger.debug('Segmented channel', {
          channel: channelName,
          conversations: segmentResult.conversations.length,
          durationMs: Math.round(segmentDuration),
        });

        // Step 2: Consolidate related conversations (with optional embedding-based similarity)
        const consolidateStart = performance.now();
        const enableEmbeddings = env.SLACK_SUMMARIZER_ENABLE_EMBEDDINGS && !!env.OPENAI_API_KEY;
        if (env.SLACK_SUMMARIZER_ENABLE_EMBEDDINGS && !env.OPENAI_API_KEY) {
          logger.warn('Embeddings enabled but OPENAI_API_KEY not set, falling back to reference-only');
        }
        const consolidationResult = await consolidateConversations(segmentResult.conversations, {
          embeddings: {
            enabled: enableEmbeddings,
            referenceWeight: env.SLACK_SUMMARIZER_EMBEDDING_REF_WEIGHT,
            embeddingWeight: env.SLACK_SUMMARIZER_EMBEDDING_EMB_WEIGHT,
          },
          requestingUserId: userId,
        });
        const consolidateDuration = performance.now() - consolidateStart;

        logger.debug('Consolidated channel', {
          channel: channelName,
          originalSegments: segmentResult.conversations.length,
          consolidatedTopics: consolidationResult.groups.length,
          botsMerged: consolidationResult.stats.botConversationsMerged,
          trivialsDropped: consolidationResult.stats.trivialConversationsDropped,
          durationMs: Math.round(consolidateDuration),
        });

        // Step 3: Generate permalinks for each group
        const linksStart = performance.now();
        const slackLinks = await this.generateGroupSlackLinks(
          consolidationResult.groups,
          channelId
        );

        // Step 3.5: Enrich Slack links by fetching linked message content
        await this.enrichSlackLinks(consolidationResult.groups);
        const linksDuration = performance.now() - linksStart;

        // Step 4: Summarize consolidated groups
        const summarizeStart = performance.now();
        const topicSummaries = await this.summarizeGroups(
          consolidationResult.groups,
          userId,
          userDisplayNames,
          slackLinks
        );
        const summarizeDuration = performance.now() - summarizeStart;

        const channelTotalDuration = performance.now() - channelStartTime;
        logger.debug('[PERF] Channel processing complete', {
          channel: channelName,
          segmentMs: Math.round(segmentDuration),
          consolidateMs: Math.round(consolidateDuration),
          linksMs: Math.round(linksDuration),
          summarizeMs: Math.round(summarizeDuration),
          totalMs: Math.round(channelTotalDuration),
          groups: consolidationResult.groups.length,
        });

        // Only include channels where user actively participated (sent messages or threads)
        // Exclude channels where user was only mentioned but didn't participate
        if (messages.length > 0 || threads.length > 0) {
          return {
            channel_id: channelId,
            channel_name: channelName,
            channel_type: channelType,
            interactions: {
              messages_sent: messages.length,
              mentions_received: mentions.length,
              threads: threads.length,
            },
            topics: topicSummaries,
            consolidation_stats: {
              original_segments: segmentResult.conversations.length,
              consolidated_topics: consolidationResult.groups.length,
              bot_messages_merged: consolidationResult.stats.botConversationsMerged,
              trivial_messages_merged: consolidationResult.stats.trivialConversationsMerged,
              adjacent_merged: consolidationResult.stats.adjacentMerged,
              proximity_merged: consolidationResult.stats.proximityMerged,
              same_author_merged: consolidationResult.stats.sameAuthorMerged,
            },
          } as ChannelSummary;
        }
        return null;
      },
      channelConcurrency
    );

    // Filter out nulls and add to channelSummaries
    for (const result of results) {
      if (result !== null) {
        channelSummaries.push(result);
      }
    }

    // Sort by activity (most active first)
    channelSummaries.sort(
      (a, b) =>
        b.interactions.messages_sent + b.interactions.mentions_received + b.interactions.threads -
        (a.interactions.messages_sent + a.interactions.mentions_received + a.interactions.threads)
    );

    return channelSummaries;
  }

  private async generateGroupSlackLinks(
    groups: ConversationGroup[],
    channelId: string
  ): Promise<Map<string, string>> {
    const slackLinks = new Map<string, string>();
    const fallbackLink = `https://slack.com/archives/${channelId}`;
    const slackConcurrency = getEnv().SLACK_SUMMARIZER_SLACK_CONCURRENCY;

    // Collect all conversations that need permalinks
    const conversationsToLink: Array<{ convId: string; messageTs: string }> = [];
    for (const group of groups) {
      for (const conv of group.conversations) {
        const firstMessage = conv.messages[0];
        if (firstMessage) {
          conversationsToLink.push({ convId: conv.id, messageTs: firstMessage.ts });
        } else {
          slackLinks.set(conv.id, fallbackLink);
        }
      }
    }

    // Fetch permalinks in parallel
    await mapWithConcurrency(
      conversationsToLink,
      async ({ convId, messageTs }) => {
        try {
          const link = await this.slackClient.getPermalink(channelId, messageTs);
          slackLinks.set(convId, link);
        } catch (error) {
          logger.warn('Failed to get permalink', {
            channelId,
            conversationId: convId,
            error: error instanceof Error ? error.message : String(error),
          });
          slackLinks.set(convId, fallbackLink);
        }
      },
      slackConcurrency
    );

    return slackLinks;
  }

  private async summarizeGroups(
    groups: ConversationGroup[],
    userId: string,
    userDisplayNames: Map<string, string>,
    slackLinks: Map<string, string>
  ): Promise<ConversationSummary[]> {
    if (groups.length === 0) {
      return [];
    }

    // Summarize in batches of 5, processed in parallel
    const batchSize = 5;
    const totalBatches = Math.ceil(groups.length / batchSize);
    const claudeConcurrency = getEnv().SLACK_SUMMARIZER_CLAUDE_CONCURRENCY;

    // Create batches
    const batches: ConversationGroup[][] = [];
    for (let i = 0; i < groups.length; i += batchSize) {
      batches.push(groups.slice(i, i + batchSize));
    }

    logger.debug('Summarizing topics in parallel', {
      totalBatches,
      totalGroups: groups.length,
      concurrency: claudeConcurrency,
    });

    // Process batches using the GLOBAL Claude concurrency limiter
    // This ensures all Claude API calls across all channels share the same limit
    const batchResults = await mapWithGlobalClaudeLimiter(
      batches,
      async (batch, batchIndex) => {
        logger.debug('Summarizing batch', {
          batch: `${batchIndex + 1}/${totalBatches}`,
          topics: batch.length,
        });

        return this.summarizationClient.summarizeGroupsBatch(
          batch,
          userId,
          userDisplayNames,
          slackLinks
        );
      },
      claudeConcurrency
    );

    // Flatten results while preserving order
    return batchResults.flat();
  }

  /**
   * Enrich conversation groups by fetching linked Slack messages that weren't unfurled
   * This ensures shared Slack links have their content available for summarization
   */
  private async enrichSlackLinks(groups: ConversationGroup[]): Promise<void> {
    const fetchedLinks = new Map<string, SlackAttachment | null>();
    const slackConcurrency = getEnv().SLACK_SUMMARIZER_SLACK_CONCURRENCY;

    // Collect all unique links that need to be fetched
    const linksToFetch: Array<{
      cacheKey: string;
      channelId: string;
      messageTs: string;
      raw: string;
    }> = [];
    const seenKeys = new Set<string>();

    for (const group of groups) {
      for (const msg of group.allMessages) {
        const text = msg.text || '';
        const links = parseSlackMessageLinks(text);

        if (links.length === 0) continue;

        // Check if message already has attachments (Slack unfurled the links)
        const hasExistingAttachments = msg.attachments && msg.attachments.length > 0;
        if (hasExistingAttachments) continue;

        for (const link of links) {
          const cacheKey = `${link.channelId}:${link.messageTs}`;
          if (!seenKeys.has(cacheKey)) {
            seenKeys.add(cacheKey);
            linksToFetch.push({
              cacheKey,
              channelId: link.channelId,
              messageTs: link.messageTs,
              raw: link.raw,
            });
          }
        }
      }
    }

    // Fetch all links in parallel
    await mapWithConcurrency(
      linksToFetch,
      async ({ cacheKey, channelId, messageTs, raw }) => {
        try {
          const linkedMessage = await this.slackClient.getMessage(channelId, messageTs);

          if (linkedMessage && linkedMessage.text) {
            const attachment: SlackAttachment = {
              text: linkedMessage.text,
              author_id: linkedMessage.user,
              channel_id: channelId,
              from_url: raw,
            };
            fetchedLinks.set(cacheKey, attachment);
          } else {
            fetchedLinks.set(cacheKey, null);
          }
        } catch (error) {
          logger.warn('Failed to fetch linked Slack message', {
            channelId,
            messageTs,
            error: error instanceof Error ? error.message : String(error),
          });
          fetchedLinks.set(cacheKey, null);
        }
      },
      slackConcurrency
    );

    // Apply fetched attachments to messages
    let enrichedCount = 0;
    for (const group of groups) {
      for (const msg of group.allMessages) {
        const text = msg.text || '';
        const links = parseSlackMessageLinks(text);

        if (links.length === 0) continue;

        const hasExistingAttachments = msg.attachments && msg.attachments.length > 0;
        if (hasExistingAttachments) continue;

        const newAttachments: SlackAttachment[] = [];
        for (const link of links) {
          const cacheKey = `${link.channelId}:${link.messageTs}`;
          const cached = fetchedLinks.get(cacheKey);
          if (cached) {
            newAttachments.push(cached);
            enrichedCount++;
          }
        }

        if (newAttachments.length > 0) {
          msg.attachments = [...(msg.attachments || []), ...newAttachments];
        }
      }
    }

    if (enrichedCount > 0) {
      logger.debug('Enriched Slack message links', { enrichedCount });
    }
  }

  private calculateAggregateStats(activity: UserActivityData): {
    totalMessages: number;
    mentionsReceived: number;
    threadsParticipated: number;
    reactionsGiven: number;
  } {
    return {
      totalMessages: activity.messagesSent.length,
      mentionsReceived: activity.mentionsReceived.length,
      threadsParticipated: activity.threadsParticipated.length,
      reactionsGiven: activity.reactionsGiven.length,
    };
  }
}

// Factory function
export function createSummaryAggregator(config?: AggregatorConfig): SummaryAggregator {
  return new SummaryAggregator(config);
}
