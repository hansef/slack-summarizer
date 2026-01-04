import Anthropic from '@anthropic-ai/sdk';
import { getEnv, type ClaudeModel } from '../../utils/env.js';
import { logger } from '../../utils/logger.js';
import { ConversationGroup, getGroupSlackLinks } from '../consolidation/consolidator.js';
import { ConversationSummary } from '../models/summary.js';
import { SlackClient, getSlackClient } from '../slack/client.js';
import {
  buildNarrativeGroupPrompt,
  buildNarrativeBatchPrompt,
  parseNarrativeSummaryResponse,
  parseNarrativeBatchResponse,
} from './prompts.js';

export interface SummarizationClientConfig {
  apiKey?: string;
  model?: ClaudeModel;
  slackClient?: SlackClient;
}

export class SummarizationClient {
  private client: Anthropic;
  private model: ClaudeModel;
  private slackClient: SlackClient;
  // Cache for in-flight user fetch promises to avoid duplicate API calls
  private userFetchPromises = new Map<string, Promise<string>>();

  constructor(config: SummarizationClientConfig = {}) {
    const apiKey = config.apiKey ?? getEnv().ANTHROPIC_API_KEY;
    this.model = config.model ?? getEnv().SLACK_SUMMARIZER_CLAUDE_MODEL;
    this.client = new Anthropic({ apiKey });
    this.slackClient = config.slackClient ?? getSlackClient();
  }

  /**
   * Resolve participant user IDs to display names with @ prefix.
   * For users not in the pre-built map (e.g., external/guest users),
   * fetches their info via the Slack API in parallel and caches the result.
   * Uses promise deduplication to avoid redundant API calls for the same user.
   */
  private async resolveParticipants(
    participantIds: string[],
    userDisplayNames: Map<string, string>
  ): Promise<string[]> {
    // First pass: identify which users need fetching
    const unknownUserIds = participantIds.filter((id) => !userDisplayNames.has(id));

    // Fetch all unknown users in parallel with deduplication
    if (unknownUserIds.length > 0) {
      const uniqueUnknown = [...new Set(unknownUserIds)];
      const fetchPromises = uniqueUnknown.map((userId) => {
        // Check if we're already fetching this user (from a parallel call)
        let fetchPromise = this.userFetchPromises.get(userId);

        if (!fetchPromise) {
          // Create the fetch promise and cache it
          fetchPromise = this.slackClient
            .getUserDisplayName(userId)
            .then((name) => {
              userDisplayNames.set(userId, name);
              this.userFetchPromises.delete(userId);
              return name;
            })
            .catch(() => {
              this.userFetchPromises.delete(userId);
              // Return userId as fallback, but don't cache it
              return userId;
            });

          this.userFetchPromises.set(userId, fetchPromise);
        }

        return fetchPromise;
      });

      // Wait for all fetches to complete
      await Promise.all(fetchPromises);
    }

    // Second pass: resolve all names (now all should be in the map)
    return participantIds.map((userId) => {
      const displayName = userDisplayNames.get(userId) ?? userId;
      return `@${displayName}`;
    });
  }

  /**
   * Pre-resolve all user IDs found in messages before building the prompt.
   * This ensures Claude sees display names, not raw user IDs like "U12345".
   */
  private async preResolveMessageUsers(
    messages: ConversationGroup['allMessages'],
    userDisplayNames: Map<string, string>
  ): Promise<void> {
    // Collect all unique user IDs from messages that aren't already resolved
    const unresolvedIds = new Set<string>();
    for (const msg of messages) {
      if (msg.user && !userDisplayNames.has(msg.user)) {
        unresolvedIds.add(msg.user);
      }
      // Also check attachments for author_id
      if (msg.attachments) {
        for (const att of msg.attachments) {
          if (att.author_id && !userDisplayNames.has(att.author_id)) {
            unresolvedIds.add(att.author_id);
          }
        }
      }
    }

    if (unresolvedIds.size === 0) return;

    logger.debug('Pre-resolving user IDs for prompt', { count: unresolvedIds.size });

    // Resolve all unknown users (this populates userDisplayNames map)
    await this.resolveParticipants([...unresolvedIds], userDisplayNames);
  }

  /**
   * Summarize a single consolidated conversation group
   */
  async summarizeGroup(
    group: ConversationGroup,
    userId: string,
    userDisplayNames: Map<string, string>,
    slackLinks: Map<string, string>
  ): Promise<ConversationSummary> {
    // Pre-resolve any user IDs in messages that aren't in the display names map
    await this.preResolveMessageUsers(group.allMessages, userDisplayNames);

    const userDisplayName = userDisplayNames.get(userId) ?? userId;
    const prompt = buildNarrativeGroupPrompt(group, userDisplayName, userDisplayNames);
    const { primary: primaryLink, all: allLinks } = getGroupSlackLinks(group, slackLinks);

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type');
      }

      const parsed = parseNarrativeSummaryResponse(content.text);
      if (!parsed) {
        logger.warn('Failed to parse narrative summary response', {
          response: content.text.substring(0, 200),
        });
        return await this.createFallbackSummary(group, userDisplayNames, primaryLink, allLinks);
      }

      // Exclude target user from participants since this is a first-person summary
      const otherParticipants = group.participants.filter((id) => id !== userId);
      return {
        narrative_summary: parsed.narrative,
        start_time: group.startTime,
        end_time: group.endTime,
        message_count: group.totalMessageCount,
        user_messages: group.totalUserMessageCount,
        participants: await this.resolveParticipants(otherParticipants, userDisplayNames),
        key_events: parsed.keyEvents,
        references: parsed.references,
        outcome: parsed.outcome,
        next_actions: parsed.nextActions.length > 0 ? parsed.nextActions : undefined,
        timesheet_entry: parsed.timesheetEntry,
        slack_link: primaryLink,
        slack_links: allLinks.length > 1 ? allLinks : undefined,
        segments_merged: group.conversations.length > 1 ? group.conversations.length : undefined,
      };
    } catch (error) {
      logger.error('Narrative summarization failed', {
        error: error instanceof Error ? error.message : String(error),
        groupId: group.id,
      });
      return await this.createFallbackSummary(group, userDisplayNames, primaryLink, allLinks);
    }
  }

  /**
   * Summarize multiple consolidated groups in a batch
   */
  async summarizeGroupsBatch(
    groups: ConversationGroup[],
    userId: string,
    userDisplayNames: Map<string, string>,
    slackLinks: Map<string, string>
  ): Promise<ConversationSummary[]> {
    if (groups.length === 0) {
      return [];
    }

    // For small batches, summarize individually for better quality (in parallel)
    if (groups.length <= 2) {
      return Promise.all(
        groups.map((group) => this.summarizeGroup(group, userId, userDisplayNames, slackLinks))
      );
    }

    // Pre-resolve all user IDs across all groups before building the prompt
    const allMessages = groups.flatMap((g) => g.allMessages);
    await this.preResolveMessageUsers(allMessages, userDisplayNames);

    const userDisplayName = userDisplayNames.get(userId) ?? userId;
    const prompt = buildNarrativeBatchPrompt(groups, userDisplayName, userDisplayNames);

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type');
      }

      const parsed = parseNarrativeBatchResponse(content.text);
      if (!parsed || parsed.length !== groups.length) {
        logger.warn('Failed to parse batch narrative response', {
          expected: groups.length,
          got: parsed?.length,
        });
        // Fall back to individual summarization
        return this.summarizeGroupsIndividually(groups, userId, userDisplayNames, slackLinks);
      }

      return await Promise.all(
        groups.map(async (group, idx) => {
          const { primary: primaryLink, all: allLinks } = getGroupSlackLinks(group, slackLinks);
          // Exclude target user from participants since this is a first-person summary
          const otherParticipants = group.participants.filter((id) => id !== userId);
          return {
            narrative_summary: parsed[idx].narrative,
            start_time: group.startTime,
            end_time: group.endTime,
            message_count: group.totalMessageCount,
            user_messages: group.totalUserMessageCount,
            participants: await this.resolveParticipants(otherParticipants, userDisplayNames),
            key_events: parsed[idx].keyEvents,
            references: parsed[idx].references,
            outcome: parsed[idx].outcome,
            next_actions: parsed[idx].nextActions.length > 0 ? parsed[idx].nextActions : undefined,
            timesheet_entry: parsed[idx].timesheetEntry,
            slack_link: primaryLink,
            slack_links: allLinks.length > 1 ? allLinks : undefined,
            segments_merged: group.conversations.length > 1 ? group.conversations.length : undefined,
          };
        })
      );
    } catch (error) {
      logger.error('Batch narrative summarization failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.summarizeGroupsIndividually(groups, userId, userDisplayNames, slackLinks);
    }
  }

  private async summarizeGroupsIndividually(
    groups: ConversationGroup[],
    userId: string,
    userDisplayNames: Map<string, string>,
    slackLinks: Map<string, string>
  ): Promise<ConversationSummary[]> {
    // Process all groups in parallel when falling back to individual summarization
    return Promise.all(
      groups.map((group) => this.summarizeGroup(group, userId, userDisplayNames, slackLinks))
    );
  }

  private async createFallbackSummary(
    group: ConversationGroup,
    userDisplayNames: Map<string, string>,
    primaryLink: string,
    allLinks: string[]
  ): Promise<ConversationSummary> {
    const topWords = this.extractTopWords(group.allMessages.map((m) => m.text || ''));
    const narrative =
      topWords.length > 0
        ? `Discussion about ${topWords.join(', ')} involving ${group.participants.length} participants.`
        : `General discussion with ${group.participants.length} participants.`;

    // Generate a fallback timesheet entry from top words
    const timesheetEntry =
      topWords.length > 0
        ? `Discussed ${topWords.join(', ')}`
        : 'Participated in team discussion';

    return {
      narrative_summary: narrative,
      start_time: group.startTime,
      end_time: group.endTime,
      message_count: group.totalMessageCount,
      user_messages: group.totalUserMessageCount,
      participants: await this.resolveParticipants(group.participants, userDisplayNames),
      key_events: [],
      references: group.sharedReferences,
      outcome: null,
      next_actions: undefined,
      timesheet_entry: timesheetEntry,
      slack_link: primaryLink,
      slack_links: allLinks.length > 1 ? allLinks : undefined,
      segments_merged: group.conversations.length > 1 ? group.conversations.length : undefined,
    };
  }

  private extractTopWords(texts: string[]): string[] {
    const wordCounts = new Map<string, number>();
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
      'may', 'might', 'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
      'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
      'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there',
      'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other',
      'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
      'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while',
      'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
      'what', 'which', 'who', 'whom', 'its', 'his', 'her', 'their', 'my', 'your',
    ]);

    for (const text of texts) {
      const words = text.toLowerCase().split(/\s+/);
      for (const word of words) {
        const cleaned = word.replace(/[^a-z]/g, '');
        if (cleaned.length > 3 && !stopWords.has(cleaned)) {
          wordCounts.set(cleaned, (wordCounts.get(cleaned) || 0) + 1);
        }
      }
    }

    return [...wordCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([word]) => word);
  }
}

// Singleton instance
let globalClient: SummarizationClient | null = null;

export function getSummarizationClient(config?: SummarizationClientConfig): SummarizationClient {
  if (!globalClient) {
    globalClient = new SummarizationClient(config);
  }
  return globalClient;
}

export function resetSummarizationClient(): void {
  globalClient = null;
}
