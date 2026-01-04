import { Conversation } from '../models/conversation.js';
import { SlackMessage } from '../models/slack.js';
import { fromSlackTimestamp, getMinutesBetween } from '../../utils/dates.js';
import { logger } from '../../utils/logger.js';

/**
 * Configuration for context enrichment
 */
export interface ContextEnrichmentConfig {
  /** Enable @mention lookback to start of day */
  enableMentionLookback: boolean;
  /** Enable short segment expansion */
  enableShortSegmentExpansion: boolean;
  /** Maximum messages for a segment to be considered "short" */
  shortSegmentThreshold: number;
  /** Target minimum messages after expansion */
  shortSegmentTargetSize: number;
  /** Max time gap (minutes) to consider when expanding short segments */
  shortSegmentMaxGapMinutes: number;
  /** Maximum context messages to add for mention lookback (to prevent prompt overflow) */
  maxMentionContextMessages: number;
}

export const DEFAULT_ENRICHMENT_CONFIG: ContextEnrichmentConfig = {
  enableMentionLookback: true,
  enableShortSegmentExpansion: true,
  shortSegmentThreshold: 2,
  shortSegmentTargetSize: 5,
  shortSegmentMaxGapMinutes: 60,
  maxMentionContextMessages: 20, // Limit to most recent 20 messages before mention
};

/**
 * Subtype values used to mark context messages.
 * These are added to SlackMessage.subtype to distinguish them from regular messages.
 */
export const CONTEXT_SUBTYPES = {
  /** Generic context message added for enrichment */
  CONTEXT: 'context_message',
  /** Context specifically from @mention lookback (earlier in the day) */
  MENTION_CONTEXT: 'mention_context',
} as const;

/**
 * Metadata about enrichment applied to a conversation
 */
export interface EnrichmentMetadata {
  /** Number of context messages added */
  contextMessagesAdded: number;
  /** Reasons why enrichment was applied */
  reasons: ('mention_lookback' | 'short_segment_expansion')[];
  /** Original message count before enrichment */
  originalMessageCount: number;
}

/**
 * Result of enriching a conversation
 */
export interface EnrichedConversationResult {
  conversation: Conversation;
  metadata: EnrichmentMetadata;
}

/**
 * Check if a message contains an @mention of the target user
 */
function messageContainsMention(message: SlackMessage, userId: string): boolean {
  if (!message.text) return false;
  // Slack mentions format: <@U12345> or <@U12345|username>
  const mentionPattern = new RegExp(`<@${userId}(?:\\|[^>]+)?>`);
  return mentionPattern.test(message.text);
}

/**
 * Check if a message is a context message (added by enrichment)
 */
export function isContextMessage(message: SlackMessage): boolean {
  return (
    message.subtype === CONTEXT_SUBTYPES.CONTEXT ||
    message.subtype === CONTEXT_SUBTYPES.MENTION_CONTEXT
  );
}

/**
 * Find the earliest message in the conversation that @mentions the target user.
 * This is used to determine when to start the context lookback.
 */
function findFirstMentionOfUser(
  conversation: Conversation,
  userId: string
): SlackMessage | null {
  for (const msg of conversation.messages) {
    if (messageContainsMention(msg, userId)) {
      return msg;
    }
  }
  return null;
}

/**
 * Determine if a conversation needs @mention lookback enrichment.
 *
 * A conversation needs mention lookback if:
 * 1. It contains a message that @mentions the target user
 * 2. The target user didn't send the first message (they were @mentioned into the conversation)
 */
function needsMentionLookback(
  conversation: Conversation,
  userId: string
): { needed: boolean; firstMention: SlackMessage | null } {
  // Check if there's an @mention of the user in this conversation
  const firstMention = findFirstMentionOfUser(conversation, userId);
  if (!firstMention) {
    return { needed: false, firstMention: null };
  }

  // If the user wrote the first message, they initiated the conversation (not @mentioned in)
  const firstMsg = conversation.messages[0];
  if (firstMsg && firstMsg.user === userId) {
    return { needed: false, firstMention: null };
  }

  return { needed: true, firstMention };
}

/**
 * Get context messages for @mention lookback.
 * Returns channel messages from the start of the day until the first mention,
 * limited to the most recent N messages (closest to the mention).
 */
function getMentionLookbackContext(
  firstMentionTs: string,
  channelId: string,
  allChannelMessages: SlackMessage[],
  maxMessages: number
): SlackMessage[] {
  const mentionTime = fromSlackTimestamp(firstMentionTs);
  const dayStart = mentionTime.startOf('day');
  const dayStartTs = (dayStart.toMillis() / 1000).toFixed(6);

  // Get all channel messages from start of day until the mention
  const contextMessages = allChannelMessages
    .filter((msg) => {
      // Must be in the same channel
      if (msg.channel !== channelId) return false;

      // Must be before the mention
      const msgTs = parseFloat(msg.ts);
      const mentionTs = parseFloat(firstMentionTs);
      if (msgTs >= mentionTs) return false;

      // Must be on the same day (after day start)
      const dayStartNum = parseFloat(dayStartTs);
      if (msgTs < dayStartNum) return false;

      // Don't include messages that are already context
      if (isContextMessage(msg)) return false;

      return true;
    })
    .sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));

  // Return only the most recent N messages (closest to the mention)
  // This keeps the most relevant context while preventing prompt overflow
  if (contextMessages.length > maxMessages) {
    return contextMessages.slice(-maxMessages);
  }

  return contextMessages;
}

/**
 * Determine if a conversation needs short segment expansion.
 */
function needsShortSegmentExpansion(
  conversation: Conversation,
  config: ContextEnrichmentConfig
): boolean {
  // Don't expand threads - they have their own context
  if (conversation.isThread) return false;

  // Only expand if we have few messages from the user
  return conversation.userMessageCount <= config.shortSegmentThreshold;
}

/**
 * Get context messages for short segment expansion.
 * Looks back from the first message to add more context.
 */
function getShortSegmentContext(
  conversation: Conversation,
  allChannelMessages: SlackMessage[],
  config: ContextEnrichmentConfig
): SlackMessage[] {
  if (conversation.messages.length === 0) return [];

  const firstMsg = conversation.messages[0];
  const firstMsgTime = fromSlackTimestamp(firstMsg.ts);
  const firstMsgTs = parseFloat(firstMsg.ts);

  // How many more messages do we need?
  const needed = config.shortSegmentTargetSize - conversation.messages.length;
  if (needed <= 0) return [];

  // Get preceding messages in this channel
  const candidates = allChannelMessages
    .filter((msg) => {
      // Must be in same channel
      if (msg.channel !== conversation.channelId) return false;

      // Must be before first message
      if (parseFloat(msg.ts) >= firstMsgTs) return false;

      // Don't include already-context messages
      if (isContextMessage(msg)) return false;

      return true;
    })
    // Sort in reverse chronological order (most recent first)
    .sort((a, b) => parseFloat(b.ts) - parseFloat(a.ts));

  // Take messages until we have enough or hit a time gap
  const contextMessages: SlackMessage[] = [];
  let lastMsgTime = firstMsgTime;

  for (const msg of candidates) {
    if (contextMessages.length >= needed) break;

    const msgTime = fromSlackTimestamp(msg.ts);
    const gapMinutes = getMinutesBetween(msgTime, lastMsgTime);

    // Stop if we hit a significant time gap
    if (gapMinutes > config.shortSegmentMaxGapMinutes) break;

    contextMessages.push(msg);
    lastMsgTime = msgTime;
  }

  // Return in chronological order
  return contextMessages.reverse();
}

/**
 * Mark messages as context by adding the appropriate subtype
 */
function markAsContext(
  messages: SlackMessage[],
  contextType: typeof CONTEXT_SUBTYPES.CONTEXT | typeof CONTEXT_SUBTYPES.MENTION_CONTEXT
): SlackMessage[] {
  return messages.map((msg) => ({
    ...msg,
    subtype: contextType,
  }));
}

/**
 * Enrich a single conversation with context messages
 */
export function enrichConversation(
  conversation: Conversation,
  allChannelMessages: SlackMessage[],
  userId: string,
  config: ContextEnrichmentConfig = DEFAULT_ENRICHMENT_CONFIG
): EnrichedConversationResult {
  const reasons: EnrichmentMetadata['reasons'] = [];
  let contextMessages: SlackMessage[] = [];

  // Feature 1: @Mention lookback
  if (config.enableMentionLookback) {
    const { needed, firstMention } = needsMentionLookback(conversation, userId);
    if (needed && firstMention) {
      const mentionContext = getMentionLookbackContext(
        firstMention.ts,
        conversation.channelId,
        allChannelMessages,
        config.maxMentionContextMessages
      );
      if (mentionContext.length > 0) {
        contextMessages.push(
          ...markAsContext(mentionContext, CONTEXT_SUBTYPES.MENTION_CONTEXT)
        );
        reasons.push('mention_lookback');
        logger.debug('Added mention lookback context', {
          conversationId: conversation.id,
          channelId: conversation.channelId,
          contextCount: mentionContext.length,
        });
      }
    }
  }

  // Feature 2: Short segment expansion
  // Only apply if we didn't already add mention context
  if (config.enableShortSegmentExpansion && reasons.length === 0) {
    if (needsShortSegmentExpansion(conversation, config)) {
      const shortContext = getShortSegmentContext(
        conversation,
        allChannelMessages,
        config
      );
      if (shortContext.length > 0) {
        contextMessages.push(
          ...markAsContext(shortContext, CONTEXT_SUBTYPES.CONTEXT)
        );
        reasons.push('short_segment_expansion');
        logger.debug('Added short segment context', {
          conversationId: conversation.id,
          channelId: conversation.channelId,
          originalCount: conversation.messageCount,
          contextCount: shortContext.length,
        });
      }
    }
  }

  // If no context was added, return original conversation
  if (contextMessages.length === 0) {
    return {
      conversation,
      metadata: {
        contextMessagesAdded: 0,
        reasons: [],
        originalMessageCount: conversation.messageCount,
      },
    };
  }

  // Deduplicate context messages (by timestamp)
  const seen = new Set(conversation.messages.map((m) => m.ts));
  contextMessages = contextMessages.filter((m) => {
    if (seen.has(m.ts)) return false;
    seen.add(m.ts);
    return true;
  });

  // Combine context + original messages, sort chronologically
  const enrichedMessages = [...contextMessages, ...conversation.messages].sort(
    (a, b) => parseFloat(a.ts) - parseFloat(b.ts)
  );

  // Recalculate participants (include context message authors)
  const allParticipants = new Set(conversation.participants);
  for (const msg of contextMessages) {
    if (msg.user) allParticipants.add(msg.user);
  }

  // Update start time if we added earlier context
  const newStartTime = enrichedMessages[0]
    ? fromSlackTimestamp(enrichedMessages[0].ts).toISO() ?? conversation.startTime
    : conversation.startTime;

  const enrichedConversation: Conversation = {
    ...conversation,
    messages: enrichedMessages,
    startTime: newStartTime,
    participants: [...allParticipants],
    messageCount: enrichedMessages.length,
    // userMessageCount stays the same (context messages aren't user's messages)
  };

  return {
    conversation: enrichedConversation,
    metadata: {
      contextMessagesAdded: contextMessages.length,
      reasons,
      originalMessageCount: conversation.messageCount,
    },
  };
}

/**
 * Enrich multiple conversations with context
 */
export function enrichConversations(
  conversations: Conversation[],
  allChannelMessages: SlackMessage[],
  userId: string,
  config: ContextEnrichmentConfig = DEFAULT_ENRICHMENT_CONFIG
): Conversation[] {
  let mentionLookbackCount = 0;
  let shortSegmentCount = 0;
  let totalContextAdded = 0;

  const enriched = conversations.map((conv) => {
    const result = enrichConversation(conv, allChannelMessages, userId, config);

    // Track stats
    if (result.metadata.reasons.includes('mention_lookback')) {
      mentionLookbackCount++;
    }
    if (result.metadata.reasons.includes('short_segment_expansion')) {
      shortSegmentCount++;
    }
    totalContextAdded += result.metadata.contextMessagesAdded;

    return result.conversation;
  });

  if (totalContextAdded > 0) {
    logger.info('Context enrichment complete', {
      conversationsEnriched: mentionLookbackCount + shortSegmentCount,
      mentionLookbacks: mentionLookbackCount,
      shortSegmentExpansions: shortSegmentCount,
      totalContextMessagesAdded: totalContextAdded,
    });
  }

  return enriched;
}
