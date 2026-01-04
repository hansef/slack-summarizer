import { SlackClient, getSlackClient } from '../slack/client.js';
import { DataFetcher, createDataFetcher } from '../slack/fetcher.js';
import { hybridSegmentation } from '../segmentation/hybrid.js';
import { consolidateConversations, ConversationGroup } from '../consolidation/consolidator.js';
import { parseSlackMessageLinks } from '../consolidation/reference-extractor.js';
import { SummarizationClient, getSummarizationClient } from './client.js';
import { logger } from '../../utils/logger.js';
import { getEnv } from '../../utils/env.js';
import { parseTimespan, formatISO, now } from '../../utils/dates.js';
import {
  SummaryOutput,
  ChannelSummary,
  ConversationSummary,
} from '../models/summary.js';
import {
  UserActivityData,
  getChannelType,
  SlackChannel,
  SlackAttachment,
} from '../models/slack.js';

export interface AggregatorConfig {
  slackClient?: SlackClient;
  summarizationClient?: SummarizationClient;
  dataFetcher?: DataFetcher;
}

export class SummaryAggregator {
  private slackClient: SlackClient;
  private summarizationClient: SummarizationClient;
  private dataFetcher: DataFetcher;

  constructor(config: AggregatorConfig = {}) {
    this.slackClient = config.slackClient ?? getSlackClient();
    this.summarizationClient = config.summarizationClient ?? getSummarizationClient();
    this.dataFetcher = config.dataFetcher ?? createDataFetcher();
  }

  async generateSummary(
    timespan: string,
    userId?: string
  ): Promise<SummaryOutput> {
    const timeRange = parseTimespan(timespan);
    const targetUserId = userId ?? (await this.slackClient.getCurrentUserId());
    const timezone = getEnv().SLACK_SUMMARIZER_TIMEZONE;

    logger.info('Generating summary', {
      userId: targetUserId,
      timespan,
      start: formatISO(timeRange.start),
      end: formatISO(timeRange.end),
    });

    // Step 1: Fetch all user activity
    const activity = await this.dataFetcher.fetchUserActivity(targetUserId, timeRange);

    // Step 2: Build user display names map (bulk fetch all workspace users)
    logger.info('Fetching all workspace users...');
    const userDisplayNames = await this.buildUserDisplayNames();
    logger.info('Fetched user display names', { count: userDisplayNames.size });

    // Step 3: Group messages by channel, segment, consolidate, and summarize
    logger.info('Segmenting, consolidating, and summarizing conversations...');
    const channelSummaries = await this.buildChannelSummaries(
      activity,
      targetUserId,
      userDisplayNames
    );

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

    logger.info('Summary generated', {
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

    for (const channelId of channelIds) {
      processedChannels++;
      const channelInfo = channelInfoMap.get(channelId);
      const channelType = channelInfo ? getChannelType(channelInfo) : 'public_channel';
      const channelName = await this.resolveChannelDisplayName(
        channelInfo,
        channelId,
        userId,
        userDisplayNames
      );

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
      const segmentResult = await hybridSegmentation(
        messages,
        threads,
        channelId,
        channelName,
        userId,
        allChannelMsgs
      );

      logger.debug('Segmented channel', {
        channel: channelName,
        conversations: segmentResult.conversations.length,
      });

      // Step 2: Consolidate related conversations (with optional embedding-based similarity)
      const env = getEnv();
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

      logger.info('Consolidated channel', {
        channel: channelName,
        originalSegments: segmentResult.conversations.length,
        consolidatedTopics: consolidationResult.groups.length,
        botsMerged: consolidationResult.stats.botConversationsMerged,
        trivialsDropped: consolidationResult.stats.trivialConversationsDropped,
      });

      // Step 3: Generate permalinks for each group
      const slackLinks = await this.generateGroupSlackLinks(
        consolidationResult.groups,
        channelId
      );

      // Step 3.5: Enrich Slack links by fetching linked message content
      await this.enrichSlackLinks(consolidationResult.groups);

      // Step 4: Summarize consolidated groups
      const topicSummaries = await this.summarizeGroups(
        consolidationResult.groups,
        userId,
        userDisplayNames,
        slackLinks
      );

      // Only include channels where user actively participated (sent messages or threads)
      // Exclude channels where user was only mentioned but didn't participate
      if (messages.length > 0 || threads.length > 0) {
        channelSummaries.push({
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
        });
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

    for (const group of groups) {
      // Generate links for each original conversation in the group
      for (const conv of group.conversations) {
        try {
          const firstMessage = conv.messages[0];
          if (firstMessage) {
            const link = await this.slackClient.getPermalink(channelId, firstMessage.ts);
            slackLinks.set(conv.id, link);
          } else {
            slackLinks.set(conv.id, fallbackLink);
          }
        } catch (error) {
          logger.warn('Failed to get permalink', {
            channelId,
            conversationId: conv.id,
            error: error instanceof Error ? error.message : String(error),
          });
          slackLinks.set(conv.id, fallbackLink);
        }
      }
    }

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

    // Summarize in batches of 5
    const batchSize = 5;
    const summaries: ConversationSummary[] = [];
    const totalBatches = Math.ceil(groups.length / batchSize);

    for (let i = 0; i < groups.length; i += batchSize) {
      const batchNum = Math.floor(i / batchSize) + 1;
      const batch = groups.slice(i, i + batchSize);

      logger.info('Summarizing topics', {
        batch: `${batchNum}/${totalBatches}`,
        topics: batch.length,
      });

      const batchSummaries = await this.summarizationClient.summarizeGroupsBatch(
        batch,
        userId,
        userDisplayNames,
        slackLinks
      );
      summaries.push(...batchSummaries);
    }

    return summaries;
  }

  /**
   * Enrich conversation groups by fetching linked Slack messages that weren't unfurled
   * This ensures shared Slack links have their content available for summarization
   */
  private async enrichSlackLinks(groups: ConversationGroup[]): Promise<void> {
    const fetchedLinks = new Map<string, SlackAttachment | null>();
    let enrichedCount = 0;

    for (const group of groups) {
      for (const msg of group.allMessages) {
        const text = msg.text || '';
        const links = parseSlackMessageLinks(text);

        if (links.length === 0) continue;

        // Check if message already has attachments (Slack unfurled the links)
        const hasExistingAttachments = msg.attachments && msg.attachments.length > 0;
        if (hasExistingAttachments) continue;

        // Fetch each linked message and add as attachment
        const newAttachments: SlackAttachment[] = [];

        for (const link of links) {
          const cacheKey = `${link.channelId}:${link.messageTs}`;

          // Check cache first
          if (fetchedLinks.has(cacheKey)) {
            const cached = fetchedLinks.get(cacheKey);
            if (cached) newAttachments.push(cached);
            continue;
          }

          // Fetch the linked message
          try {
            const linkedMessage = await this.slackClient.getMessage(
              link.channelId,
              link.messageTs
            );

            if (linkedMessage && linkedMessage.text) {
              const attachment: SlackAttachment = {
                text: linkedMessage.text,
                author_id: linkedMessage.user,
                channel_id: link.channelId,
                from_url: link.raw,
              };
              newAttachments.push(attachment);
              fetchedLinks.set(cacheKey, attachment);
              enrichedCount++;
            } else {
              fetchedLinks.set(cacheKey, null);
            }
          } catch (error) {
            logger.warn('Failed to fetch linked Slack message', {
              channelId: link.channelId,
              messageTs: link.messageTs,
              error: error instanceof Error ? error.message : String(error),
            });
            fetchedLinks.set(cacheKey, null);
          }
        }

        // Add fetched attachments to the message
        if (newAttachments.length > 0) {
          msg.attachments = [...(msg.attachments || []), ...newAttachments];
        }
      }
    }

    if (enrichedCount > 0) {
      logger.info('Enriched Slack message links', { enrichedCount });
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
