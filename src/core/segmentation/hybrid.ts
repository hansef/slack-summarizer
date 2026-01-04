import { SlackMessage, SlackThread } from '../models/slack.js';
import { Conversation, SegmentationResult } from '../models/conversation.js';
import { segmentByTimeGaps, countTimeGapSplits } from './time-based.js';
import { analyzeConversationBoundaries, applyBoundaryDecisions } from './semantic.js';
import { enrichConversations, ContextEnrichmentConfig, DEFAULT_ENRICHMENT_CONFIG } from './context-enricher.js';
import { fromSlackTimestamp, formatISO } from '../../utils/dates.js';
import { logger } from '../../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

export interface HybridSegmentationConfig {
  gapThresholdMinutes: number;
  semanticConfidenceThreshold: number;
  minMessagesForSemantic: number;
  /** Context enrichment configuration */
  contextEnrichment?: Partial<ContextEnrichmentConfig>;
}

const DEFAULT_CONFIG: HybridSegmentationConfig = {
  gapThresholdMinutes: 60, // Increased for async teams
  semanticConfidenceThreshold: 0.6,
  minMessagesForSemantic: 3,
};

export async function hybridSegmentation(
  messages: SlackMessage[],
  threads: SlackThread[],
  channelId: string,
  channelName: string | undefined,
  userId: string,
  allChannelMessages: SlackMessage[] = [],
  config: Partial<HybridSegmentationConfig> = {}
): Promise<SegmentationResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  logger.debug('Starting hybrid segmentation', {
    channelId,
    messageCount: messages.length,
    threadCount: threads.length,
  });

  // Step 1: Separate threads from main channel messages
  const { mainMessages } = separateThreads(messages);

  // Step 2: Convert threads to conversations
  const threadConversations = threads.map((thread) =>
    threadToConversation(thread, channelId, channelName, userId)
  );

  // Step 3: Apply time-based segmentation first
  const timeGapSplits = countTimeGapSplits(mainMessages, { gapThresholdMinutes: cfg.gapThresholdMinutes });
  const timeSegments = segmentByTimeGaps(mainMessages, channelId, channelName, userId, {
    gapThresholdMinutes: cfg.gapThresholdMinutes,
  });

  // Step 4: Refine segments with semantic analysis
  let semanticSplits = 0;
  const refinedConversations: Conversation[] = [];

  for (const segment of timeSegments) {
    if (segment.messages.length < cfg.minMessagesForSemantic) {
      // Too few messages, keep as-is
      refinedConversations.push(segment);
      continue;
    }

    // Apply semantic analysis
    const decisions = await analyzeConversationBoundaries(segment.messages);
    const boundaries = applyBoundaryDecisions(
      segment.messages,
      decisions,
      cfg.semanticConfidenceThreshold
    );

    if (boundaries.length === 0) {
      // No semantic boundaries found
      refinedConversations.push(segment);
    } else {
      // Split based on semantic boundaries
      semanticSplits += boundaries.length;
      const subConversations = splitByBoundaries(segment, boundaries, userId);
      refinedConversations.push(...subConversations);
    }
  }

  // Step 5: Combine all conversations
  let allConversations = [...threadConversations, ...refinedConversations];

  // Sort by start time
  allConversations.sort((a, b) => a.startTime.localeCompare(b.startTime));

  // Step 6: Enrich conversations with context (for @mention lookback and short segments)
  if (allChannelMessages.length > 0) {
    const enrichmentConfig = {
      ...DEFAULT_ENRICHMENT_CONFIG,
      ...cfg.contextEnrichment,
    };
    allConversations = enrichConversations(
      allConversations,
      allChannelMessages,
      userId,
      enrichmentConfig
    );
  }

  const stats = {
    totalMessages: messages.length,
    totalConversations: allConversations.length,
    threadsExtracted: threadConversations.length,
    timeGapSplits,
    semanticSplits,
  };

  logger.debug('Hybrid segmentation complete', stats);

  return {
    conversations: allConversations,
    stats,
  };
}

function separateThreads(messages: SlackMessage[]): {
  mainMessages: SlackMessage[];
  threadMessages: SlackMessage[];
} {
  const mainMessages: SlackMessage[] = [];
  const threadMessages: SlackMessage[] = [];

  for (const msg of messages) {
    if (msg.thread_ts && msg.thread_ts !== msg.ts) {
      // This is a thread reply
      threadMessages.push(msg);
    } else {
      mainMessages.push(msg);
    }
  }

  return { mainMessages, threadMessages };
}

function threadToConversation(
  thread: SlackThread,
  channelId: string,
  channelName: string | undefined,
  userId: string
): Conversation {
  const sorted = [...thread.messages].sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
  const participants = [...new Set(thread.messages.map((m) => m.user).filter(Boolean))] as string[];

  const startTime = sorted.length > 0 ? fromSlackTimestamp(sorted[0].ts) : fromSlackTimestamp(thread.threadTs);
  const endTime = sorted.length > 0 ? fromSlackTimestamp(sorted[sorted.length - 1].ts) : startTime;

  return {
    id: uuidv4(),
    channelId,
    channelName,
    isThread: true,
    threadTs: thread.threadTs,
    messages: sorted,
    startTime: formatISO(startTime),
    endTime: formatISO(endTime),
    participants,
    messageCount: thread.messages.length,
    userMessageCount: thread.messages.filter((m) => m.user === userId).length,
  };
}

function splitByBoundaries(
  conversation: Conversation,
  boundaries: number[],
  userId: string
): Conversation[] {
  const results: Conversation[] = [];
  const messages = conversation.messages;

  // Add 0 at start and messages.length at end
  const allBoundaries = [0, ...boundaries, messages.length];

  for (let i = 0; i < allBoundaries.length - 1; i++) {
    const start = allBoundaries[i];
    const end = allBoundaries[i + 1];
    const segmentMessages = messages.slice(start, end);

    if (segmentMessages.length === 0) continue;

    const participants = [...new Set(segmentMessages.map((m) => m.user).filter(Boolean))] as string[];
    const startTime = fromSlackTimestamp(segmentMessages[0].ts);
    const endTime = fromSlackTimestamp(segmentMessages[segmentMessages.length - 1].ts);

    results.push({
      id: uuidv4(),
      channelId: conversation.channelId,
      channelName: conversation.channelName,
      isThread: false,
      messages: segmentMessages,
      startTime: formatISO(startTime),
      endTime: formatISO(endTime),
      participants,
      messageCount: segmentMessages.length,
      userMessageCount: segmentMessages.filter((m) => m.user === userId).length,
    });
  }

  return results;
}

// Convenience function for processing multiple channels
export async function segmentUserActivity(
  channelMessages: Map<string, SlackMessage[]>,
  channelThreads: Map<string, SlackThread[]>,
  channelNames: Map<string, string>,
  allChannelMessages: Map<string, SlackMessage[]>,
  userId: string,
  config: Partial<HybridSegmentationConfig> = {}
): Promise<Map<string, SegmentationResult>> {
  const results = new Map<string, SegmentationResult>();

  for (const [channelId, messages] of channelMessages) {
    const threads = channelThreads.get(channelId) ?? [];
    const channelName = channelNames.get(channelId);
    const allMessages = allChannelMessages.get(channelId) ?? [];

    const result = await hybridSegmentation(
      messages,
      threads,
      channelId,
      channelName,
      userId,
      allMessages,
      config
    );

    results.set(channelId, result);
  }

  return results;
}
