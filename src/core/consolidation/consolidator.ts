import { Conversation } from '../models/conversation.js';
import {
  ConversationReferences,
  extractReferencesFromAll,
  calculateReferenceSimilarity,
  isBotConversation,
} from './reference-extractor.js';
import {
  prepareConversationEmbeddings,
  calculateHybridSimilarity,
  ConversationWithEmbedding,
} from '../embeddings/similarity.js';
import { logger } from '../../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

// ==========================================
// CONFIGURATION TYPES
// ==========================================

/**
 * Proximity merge settings - for conversations by the same author that are close in time.
 * These may have low content similarity but are contextually related.
 */
export interface ProximityConfig {
  /** Maximum time gap in minutes to merge same-author conversations (default: 90) */
  windowMinutes: number;
  /** Minimum similarity required for merge (0-1). Set to 0 to merge unconditionally. (default: 0.20) */
  minSimilarity: number;
  /** Maximum time gap for DMs - longer since DMs have natural gaps (default: 180) */
  dmWindowMinutes: number;
  /** Minimum similarity for DMs - lower since all DM messages with same person are contextually related (default: 0.05) */
  dmMinSimilarity: number;
}

/**
 * Same-author merge settings - for conversations by the same author with longer gaps.
 * More aggressive than standard similarity merge but still requires some content overlap.
 */
export interface SameAuthorConfig {
  /** Maximum time gap in minutes (default: 360 = 6 hours) */
  maxGapMinutes: number;
  /** Minimum similarity required (default: 0.20) */
  minSimilarity: number;
}

/**
 * Standard similarity-based merge settings - for conversations with strong content overlap.
 * Uses reference extraction and optional embeddings.
 */
export interface SimilarityConfig {
  /** Minimum similarity score to group conversations (0-1) (default: 0.4) */
  threshold: number;
  /** Maximum time gap in minutes (default: 240 = 4 hours) */
  maxGapMinutes: number;
}

/**
 * Trivial conversation handling - short acknowledgment messages.
 * These are merged into adjacent conversations or filtered out.
 */
export interface TrivialConfig {
  /** Maximum messages for a conversation to be considered trivial (default: 2) */
  maxMessages: number;
  /** Maximum total characters for a conversation to be considered trivial (default: 100) */
  maxCharacters: number;
  /** Maximum time gap to merge trivial conversations with adjacent ones (default: 30) */
  mergeWindowMinutes: number;
  /**
   * Whether to drop trivial conversations that can't be merged with anything.
   * When true, orphan trivial messages are excluded from summaries. (default: true)
   */
  dropOrphans: boolean;
  /**
   * Patterns that indicate a trivial message represents meaningful work.
   * Messages matching these patterns are NOT dropped even if they're short.
   * (default: patterns for confirm, verified, tested, fixed, done, etc.)
   */
  preservePatterns: RegExp[];
}

/**
 * Embedding-based semantic similarity settings (optional, requires OpenAI API key).
 */
export interface EmbeddingsConfig {
  /** Enable embedding-based semantic similarity (default: false) */
  enabled: boolean;
  /** Weight for reference-based similarity (0-1) (default: 0.6) */
  referenceWeight: number;
  /** Weight for embedding-based similarity (0-1) (default: 0.4) */
  embeddingWeight: number;
}

/**
 * Configuration for conversation consolidation.
 *
 * Merge strategies are applied in order:
 * 1. Adjacent merge: Very close conversations (<15 min), unconditional
 * 2. Proximity merge: Same author, close in time, minimal similarity
 * 3. Same-author merge: Same author, longer window, lower similarity threshold
 * 4. Similarity merge: Shared references/embeddings, stricter threshold
 */
export interface ConsolidationConfig {
  // Merge strategies
  /** Time window for unconditional adjacent merging (default: 15 minutes) */
  adjacentMergeWindowMinutes: number;
  /** Proximity-based merge settings for same-author conversations */
  proximity: ProximityConfig;
  /** Same-author merge settings for longer time gaps */
  sameAuthor: SameAuthorConfig;
  /** Reference/embedding-based similarity merge settings */
  similarity: SimilarityConfig;

  // Pre-processing
  /** Time window to merge bot conversations with adjacent human conversations (default: 30) */
  botMergeWindowMinutes: number;
  /** Trivial conversation handling settings */
  trivial: TrivialConfig;

  // Embeddings (optional)
  /** Embedding-based semantic similarity settings */
  embeddings: EmbeddingsConfig;

  // Context
  /**
   * The user ID of the person requesting the summary.
   * When provided, conversations where this user participated are considered
   * "same author" for consolidation purposes, since they are the common thread.
   */
  requestingUserId?: string;
}

/**
 * Patterns that indicate a brief message represents meaningful work.
 * These messages should NOT be dropped even if they're short.
 */
const WORK_INDICATOR_PATTERNS: RegExp[] = [
  /\bconfirm(ed|ing)?\b/i,
  /\bverif(y|ied|ying)\b/i,
  /\btest(ed|ing)?\b/i,
  /\bcheck(ed|ing)?\b/i,
  /\bfix(ed|ing)?\b/i,
  /\bdone\b/i,
  /\bcomplete[d]?\b/i,
  /\bapprove[d]?\b/i,
  /\breview(ed|ing)?\b/i,
  /\bresolve[d]?\b/i,
  /\bmerge[d]?\b/i,
  /\bdeploy(ed|ing)?\b/i,
  /\bupdate[d]?\b/i,
  /\bship(ped|ping)?\b/i,
  /\blaunch(ed|ing)?\b/i,
  /\brelease[d]?\b/i,
];

const DEFAULT_CONFIG: ConsolidationConfig = {
  // Merge strategies
  adjacentMergeWindowMinutes: 15,
  proximity: {
    windowMinutes: 90,      // 1.5 hours - covers lunch breaks, short interruptions
    minSimilarity: 0.20,    // Requires 20% content overlap
    dmWindowMinutes: 180,   // 3 hours - DMs have natural gaps
    dmMinSimilarity: 0.05,  // Very low - all DM messages with same person are contextually related
  },
  sameAuthor: {
    maxGapMinutes: 360,     // 6 hours
    minSimilarity: 0.20,    // Lower threshold when same author
  },
  similarity: {
    threshold: 0.4,         // Standard similarity threshold
    maxGapMinutes: 240,     // 4 hours
  },

  // Pre-processing
  botMergeWindowMinutes: 30,
  trivial: {
    maxMessages: 2,
    maxCharacters: 100,
    mergeWindowMinutes: 30,
    dropOrphans: true,
    preservePatterns: WORK_INDICATOR_PATTERNS,
  },

  // Embeddings
  embeddings: {
    enabled: false,
    referenceWeight: 0.6,
    embeddingWeight: 0.4,
  },
};

/**
 * A group of related conversations that will be summarized together
 */
export interface ConversationGroup {
  id: string;
  conversations: Conversation[];
  /** Shared references across all conversations in the group */
  sharedReferences: string[];
  /** Combined messages from all conversations, sorted by time */
  allMessages: Conversation['messages'];
  startTime: string;
  endTime: string;
  participants: string[];
  totalMessageCount: number;
  totalUserMessageCount: number;
  /** Whether this group contains any thread conversations */
  hasThreads: boolean;
  /** IDs of original conversations that were merged */
  originalConversationIds: string[];
}

/**
 * Result of the consolidation process
 */
export interface ConsolidationResult {
  groups: ConversationGroup[];
  stats: {
    originalConversations: number;
    consolidatedGroups: number;
    botConversationsMerged: number;
    trivialConversationsMerged: number;
    trivialConversationsDropped: number;
    adjacentMerged: number;
    proximityMerged: number;
    sameAuthorMerged: number;
    referenceGroupsMerged: number;
  };
}

/**
 * Check if a channel is a DM based on its ID.
 * Slack DM channel IDs start with "D".
 */
function isDMChannel(channelId: string): boolean {
  return channelId.startsWith('D');
}

/**
 * Get time gap in minutes between two conversations
 */
function getTimeGapMinutes(conv1: Conversation, conv2: Conversation): number {
  const end1 = new Date(conv1.endTime).getTime();
  const start2 = new Date(conv2.startTime).getTime();
  return (start2 - end1) / (1000 * 60);
}

/**
 * Merge bot conversations into adjacent human conversations
 */
function mergeBotConversations(
  conversations: Conversation[],
  config: ConsolidationConfig
): { merged: Conversation[]; botsMerged: number } {
  if (conversations.length === 0) {
    return { merged: [], botsMerged: 0 };
  }

  // Sort by start time
  const sorted = [...conversations].sort((a, b) => a.startTime.localeCompare(b.startTime));

  const result: Conversation[] = [];
  const skipIndices = new Set<number>();
  let botsMerged = 0;

  for (let i = 0; i < sorted.length; i++) {
    // Skip if this index was already merged forward
    if (skipIndices.has(i)) {
      continue;
    }

    const conv = sorted[i];

    if (isBotConversation(conv)) {
      // Try to merge with previous non-bot conversation
      if (result.length > 0) {
        const prev = result[result.length - 1];
        const gap = Math.abs(getTimeGapMinutes(prev, conv));

        if (gap <= config.botMergeWindowMinutes && !isBotConversation(prev)) {
          // Merge bot into previous
          result[result.length - 1] = mergeConversations(prev, conv);
          botsMerged++;
          continue;
        }
      }

      // Try to merge with next non-bot conversation
      if (i + 1 < sorted.length && !skipIndices.has(i + 1)) {
        const next = sorted[i + 1];
        const gap = Math.abs(getTimeGapMinutes(conv, next));

        if (gap <= config.botMergeWindowMinutes && !isBotConversation(next)) {
          // Merge bot into next and mark this bot as skipped
          sorted[i + 1] = mergeConversations(conv, next);
          skipIndices.add(i);
          botsMerged++;
          continue;
        }
      }
    }

    result.push(conv);
  }

  return { merged: result, botsMerged };
}

/**
 * Check if a conversation is "trivial" (short acknowledgment-type messages)
 * These should be absorbed into nearby substantive conversations
 */
function isTrivialConversation(conv: Conversation, config: ConsolidationConfig): boolean {
  // Must have few messages
  if (conv.messageCount > config.trivial.maxMessages) {
    return false;
  }

  // Check total text length - trivial messages are short
  const totalTextLength = conv.messages.reduce((sum, m) => sum + (m.text?.length ?? 0), 0);

  // Very short messages are trivial (e.g., "nice!", "👍", "thanks", "all good")
  return totalTextLength < config.trivial.maxCharacters;
}

/**
 * Check if a trivial conversation contains work indicator patterns.
 * These messages should be preserved even if they're short because they
 * indicate meaningful work was done (e.g., "confirmed", "tested", "fixed").
 */
function hasWorkIndicators(conv: Conversation, config: ConsolidationConfig): boolean {
  const text = conv.messages.map(m => m.text ?? '').join(' ');
  return config.trivial.preservePatterns.some(pattern => pattern.test(text));
}

/**
 * Merge trivial (short acknowledgment) conversations into adjacent substantive ones.
 * This prevents brief reactions from becoming separate summaries.
 *
 * Also handles orphan dropping: trivial conversations that can't be merged are
 * optionally dropped entirely, unless they contain work indicators.
 */
function mergeTrivialConversations(
  conversations: Conversation[],
  config: ConsolidationConfig
): { merged: Conversation[]; trivialsMerged: number; trivialsDropped: number } {
  if (conversations.length === 0) {
    return { merged: [], trivialsMerged: 0, trivialsDropped: 0 };
  }

  // Sort by start time
  const sorted = [...conversations].sort((a, b) => a.startTime.localeCompare(b.startTime));

  const result: Conversation[] = [];
  const skipIndices = new Set<number>();
  let trivialsMerged = 0;
  let trivialsDropped = 0;

  for (let i = 0; i < sorted.length; i++) {
    // Skip if already merged
    if (skipIndices.has(i)) {
      continue;
    }

    const conv = sorted[i];

    if (isTrivialConversation(conv, config)) {
      let merged = false;

      // Try to merge with previous substantive conversation
      if (result.length > 0) {
        const prev = result[result.length - 1];
        const gap = Math.abs(getTimeGapMinutes(prev, conv));

        // Merge if within window and previous is more substantive
        if (gap <= config.trivial.mergeWindowMinutes && prev.messageCount > conv.messageCount) {
          result[result.length - 1] = mergeConversations(prev, conv);
          trivialsMerged++;
          merged = true;
        }
      }

      // Try to merge with next substantive conversation
      if (!merged && i + 1 < sorted.length && !skipIndices.has(i + 1)) {
        const next = sorted[i + 1];
        const gap = Math.abs(getTimeGapMinutes(conv, next));

        // Merge if within window and next is more substantive
        if (gap <= config.trivial.mergeWindowMinutes && next.messageCount > conv.messageCount) {
          sorted[i + 1] = mergeConversations(conv, next);
          skipIndices.add(i);
          trivialsMerged++;
          merged = true;
        }
      }

      // If couldn't merge and dropOrphans is enabled, check if we should drop it
      if (!merged) {
        if (config.trivial.dropOrphans && !hasWorkIndicators(conv, config)) {
          // Drop this trivial orphan - it's just noise
          trivialsDropped++;
          logger.debug('Dropping trivial orphan conversation', {
            id: conv.id,
            channelId: conv.channelId,
            messageCount: conv.messageCount,
            startTime: conv.startTime,
          });
          continue;
        }
        // Keep it - either dropOrphans is false or it has work indicators
        result.push(conv);
      }
      continue;
    }

    result.push(conv);
  }

  return { merged: result, trivialsMerged, trivialsDropped };
}

/**
 * Merge two conversations into one
 */
function mergeConversations(conv1: Conversation, conv2: Conversation): Conversation {
  const allMessages = [...conv1.messages, ...conv2.messages].sort(
    (a, b) => parseFloat(a.ts) - parseFloat(b.ts)
  );

  const participants = [...new Set([...conv1.participants, ...conv2.participants])];

  const startTime = conv1.startTime < conv2.startTime ? conv1.startTime : conv2.startTime;
  const endTime = conv1.endTime > conv2.endTime ? conv1.endTime : conv2.endTime;

  return {
    id: conv1.id, // Keep first ID
    channelId: conv1.channelId,
    channelName: conv1.channelName,
    isThread: conv1.isThread || conv2.isThread,
    threadTs: conv1.threadTs || conv2.threadTs,
    messages: allMessages,
    startTime,
    endTime,
    participants,
    messageCount: allMessages.length,
    userMessageCount: conv1.userMessageCount + conv2.userMessageCount,
  };
}

/**
 * Check if two conversations have the same author (or very similar participant sets)
 * When requestingUserId is provided, conversations where that user participated
 * are considered "same author" since they are generating a summary for that user.
 */
function hasSameAuthor(conv1: Conversation, conv2: Conversation, requestingUserId?: string): boolean {
  // If the requesting user participated in both conversations, treat as same author
  // This is the key insight: when generating a summary FOR a user, their participation
  // is the common thread that connects their conversations
  if (requestingUserId) {
    const user1 = conv1.participants.includes(requestingUserId);
    const user2 = conv2.participants.includes(requestingUserId);
    if (user1 && user2) {
      return true;
    }
  }

  // If both have exactly one participant and it's the same person
  if (conv1.participants.length === 1 && conv2.participants.length === 1) {
    return conv1.participants[0] === conv2.participants[0];
  }

  // If participants overlap significantly (Jaccard > 0.7)
  const set1 = new Set(conv1.participants);
  const set2 = new Set(conv2.participants);
  const intersection = [...set1].filter((p) => set2.has(p)).length;
  const union = new Set([...conv1.participants, ...conv2.participants]).size;

  return union > 0 && intersection / union >= 0.7;
}

/**
 * Group conversations by shared references and/or embeddings using Union-Find
 * Applies more aggressive grouping for same-author conversations
 */
async function groupByReferences(
  conversations: Conversation[],
  referenceMap: Map<string, ConversationReferences>,
  config: ConsolidationConfig
): Promise<{ groups: Map<string, string[]>; adjacentMerged: number; proximityMerged: number; sameAuthorMerged: number }> {
  // Union-Find parent map
  const parent = new Map<string, string>();
  let adjacentMerged = 0;
  let proximityMerged = 0;
  let sameAuthorMerged = 0;

  // Initialize: each conversation is its own parent
  for (const conv of conversations) {
    parent.set(conv.id, conv.id);
  }

  // Find with path compression
  function find(id: string): string {
    const parentId = parent.get(id);
    if (parentId === undefined) {
      // Safety: if ID not found, treat it as its own parent
      logger.warn('Conversation ID not found in parent map', { id });
      return id;
    }
    if (parentId !== id) {
      parent.set(id, find(parentId));
    }
    return parent.get(id)!;
  }

  // Union
  function union(id1: string, id2: string): void {
    const root1 = find(id1);
    const root2 = find(id2);
    if (root1 !== root2) {
      parent.set(root1, root2);
    }
  }

  // Prepare embeddings if enabled (batch operation for efficiency)
  let embeddingMap: Map<string, ConversationWithEmbedding> | null = null;
  if (config.embeddings.enabled) {
    try {
      embeddingMap = await prepareConversationEmbeddings(conversations);
      logger.debug('Prepared embeddings for conversations', {
        count: embeddingMap.size,
        withEmbeddings: [...embeddingMap.values()].filter((e) => e.embedding !== null).length,
      });
    } catch (error) {
      logger.warn('Failed to prepare embeddings, falling back to reference-only', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Build groups based on shared references, embeddings, and author similarity
  for (let i = 0; i < conversations.length; i++) {
    for (let j = i + 1; j < conversations.length; j++) {
      const conv1 = conversations[i];
      const conv2 = conversations[j];

      const refs1 = referenceMap.get(conv1.id);
      const refs2 = referenceMap.get(conv2.id);

      // Get embeddings if available
      const emb1 = embeddingMap?.get(conv1.id)?.embedding ?? null;
      const emb2 = embeddingMap?.get(conv2.id)?.embedding ?? null;

      // Calculate similarity (hybrid if embeddings enabled, reference-only otherwise)
      let similarity: number;
      if (config.embeddings.enabled && embeddingMap) {
        similarity = calculateHybridSimilarity(conv1, conv2, refs1, refs2, emb1, emb2, {
          enableEmbeddings: true,
          referenceWeight: config.embeddings.referenceWeight,
          embeddingWeight: config.embeddings.embeddingWeight,
        });
      } else {
        similarity = refs1 && refs2 ? calculateReferenceSimilarity(refs1, refs2) : 0;
      }

      // Check if same author for more aggressive grouping
      // Pass requestingUserId so conversations where the user participated are treated as same-author
      const sameAuthor = hasSameAuthor(conv1, conv2, config.requestingUserId);

      // Use different thresholds based on whether same author
      const similarityThreshold = sameAuthor
        ? config.sameAuthor.minSimilarity
        : config.similarity.threshold;
      const maxGap = sameAuthor ? config.sameAuthor.maxGapMinutes : config.similarity.maxGapMinutes;

      const gap = Math.abs(getTimeGapMinutes(conv1, conv2));

      // Adjacent merge: conversations with very small gaps are clearly part of
      // the same discussion, even with different participants (people joining/leaving)
      const isAdjacentMerge = gap <= config.adjacentMergeWindowMinutes;

      // Proximity merge: same author + close in time + minimum similarity
      // This handles lunch breaks, interruptions, context switches where topic similarity
      // may be low but conversations are still related
      // The minimum similarity check prevents merging completely unrelated topics
      // Use lower threshold for DMs where topic drift is natural
      const isDM = conv1.channelId === conv2.channelId && isDMChannel(conv1.channelId);
      const proxWindow = isDM ? config.proximity.dmWindowMinutes : config.proximity.windowMinutes;
      const proxThreshold = isDM ? config.proximity.dmMinSimilarity : config.proximity.minSimilarity;
      const meetsProximitySimilarity = proxThreshold === 0 || similarity >= proxThreshold;
      const isProximityMerge = sameAuthor && gap <= proxWindow && meetsProximitySimilarity;

      // Group if:
      // 1. Adjacent merge (very close in time, any participants) - unconditional
      // 2. Proximity merge (same author, close in time, min similarity) - requires some content overlap
      // 3. OR similarity meets threshold AND within time window
      const shouldGroup = isAdjacentMerge || isProximityMerge || (gap <= maxGap && similarity >= similarityThreshold);

      if (shouldGroup) {
        // Track merge type for stats (prioritize most specific reason)
        if (isAdjacentMerge && !sameAuthor) {
          // Adjacent merge with different participants
          adjacentMerged++;
        } else if (isProximityMerge && similarity < config.sameAuthor.minSimilarity) {
          proximityMerged++;
        } else if (sameAuthor && similarity < config.similarity.threshold) {
          sameAuthorMerged++;
        }
        union(conv1.id, conv2.id);
      }
    }
  }

  // Collect groups
  const groups = new Map<string, string[]>();
  for (const conv of conversations) {
    const root = find(conv.id);
    if (!groups.has(root)) {
      groups.set(root, []);
    }
    groups.get(root)!.push(conv.id);
  }

  return { groups, adjacentMerged, proximityMerged, sameAuthorMerged };
}

/**
 * Create a ConversationGroup from a list of conversations
 */
function createGroup(
  conversations: Conversation[],
  referenceMap: Map<string, ConversationReferences>
): ConversationGroup {
  // Sort conversations by start time
  const sorted = [...conversations].sort((a, b) => a.startTime.localeCompare(b.startTime));

  // Collect all messages
  const allMessages = sorted.flatMap((c) => c.messages).sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));

  // Collect participants
  const participants = [...new Set(sorted.flatMap((c) => c.participants))];

  // Collect shared references
  const allRefs = new Set<string>();
  for (const conv of sorted) {
    const refs = referenceMap.get(conv.id);
    if (refs) {
      for (const ref of refs.uniqueRefs) {
        allRefs.add(ref);
      }
    }
  }

  return {
    id: uuidv4(),
    conversations: sorted,
    sharedReferences: [...allRefs],
    allMessages,
    startTime: sorted[0].startTime,
    endTime: sorted[sorted.length - 1].endTime,
    participants,
    totalMessageCount: allMessages.length,
    totalUserMessageCount: sorted.reduce((sum, c) => sum + c.userMessageCount, 0),
    hasThreads: sorted.some((c) => c.isThread),
    originalConversationIds: sorted.map((c) => c.id),
  };
}

/**
 * Deep merge for partial config with nested objects
 */
function mergeConfig(base: ConsolidationConfig, overrides: Partial<DeepPartial<ConsolidationConfig>>): ConsolidationConfig {
  return {
    adjacentMergeWindowMinutes: overrides.adjacentMergeWindowMinutes ?? base.adjacentMergeWindowMinutes,
    proximity: { ...base.proximity, ...overrides.proximity },
    sameAuthor: { ...base.sameAuthor, ...overrides.sameAuthor },
    similarity: { ...base.similarity, ...overrides.similarity },
    botMergeWindowMinutes: overrides.botMergeWindowMinutes ?? base.botMergeWindowMinutes,
    trivial: { ...base.trivial, ...overrides.trivial },
    embeddings: { ...base.embeddings, ...overrides.embeddings },
    requestingUserId: overrides.requestingUserId ?? base.requestingUserId,
  };
}

/** Deep partial type for nested config */
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? Partial<T[P]> : T[P];
};

/**
 * Main consolidation function: groups related conversations for narrative summarization
 */
export async function consolidateConversations(
  conversations: Conversation[],
  config: Partial<DeepPartial<ConsolidationConfig>> = {}
): Promise<ConsolidationResult> {
  const cfg = mergeConfig(DEFAULT_CONFIG, config);

  if (conversations.length === 0) {
    return {
      groups: [],
      stats: {
        originalConversations: 0,
        consolidatedGroups: 0,
        botConversationsMerged: 0,
        trivialConversationsMerged: 0,
        trivialConversationsDropped: 0,
        adjacentMerged: 0,
        proximityMerged: 0,
        sameAuthorMerged: 0,
        referenceGroupsMerged: 0,
      },
    };
  }

  logger.debug('Starting conversation consolidation', {
    conversationCount: conversations.length,
    config: cfg,
  });

  // Step 1: Merge bot conversations into adjacent human conversations
  const { merged: afterBotMerge, botsMerged } = mergeBotConversations(conversations, cfg);

  // Step 2: Merge trivial (1-2 message acknowledgments) into adjacent substantive conversations
  // Also drops orphan trivial messages that can't be merged (unless they have work indicators)
  const { merged, trivialsMerged, trivialsDropped } = mergeTrivialConversations(afterBotMerge, cfg);

  // Step 3: Extract references from all conversations
  const referenceMap = extractReferencesFromAll(merged);

  // Step 4: Group by shared references and/or embeddings (with same-author boost and proximity merge)
  const { groups: groupMap, adjacentMerged, proximityMerged, sameAuthorMerged } = await groupByReferences(merged, referenceMap, cfg);

  // Step 5: Create ConversationGroup objects
  const groups: ConversationGroup[] = [];
  let referenceGroupsMerged = 0;

  for (const convIds of groupMap.values()) {
    const convs = convIds.map((id) => merged.find((c) => c.id === id)!).filter(Boolean);

    // Skip empty groups (shouldn't happen, but defensive check)
    if (convs.length === 0) {
      logger.warn('Empty conversation group found', { convIds });
      continue;
    }

    if (convs.length > 1) {
      referenceGroupsMerged += convs.length - 1;
    }

    groups.push(createGroup(convs, referenceMap));
  }

  // Sort groups by start time
  groups.sort((a, b) => a.startTime.localeCompare(b.startTime));

  const stats = {
    originalConversations: conversations.length,
    consolidatedGroups: groups.length,
    botConversationsMerged: botsMerged,
    trivialConversationsMerged: trivialsMerged,
    trivialConversationsDropped: trivialsDropped,
    adjacentMerged,
    proximityMerged,
    sameAuthorMerged,
    referenceGroupsMerged,
  };

  logger.debug('Consolidation complete', stats);

  return { groups, stats };
}

/**
 * Convenience function to get slack links for a group
 * Returns the first message's link as primary, with all original conversation links
 */
export function getGroupSlackLinks(
  group: ConversationGroup,
  slackLinks: Map<string, string>
): { primary: string; all: string[] } {
  const all: string[] = [];

  for (const convId of group.originalConversationIds) {
    const link = slackLinks.get(convId);
    if (link) {
      all.push(link);
    }
  }

  return {
    primary: all[0] ?? '',
    all,
  };
}
