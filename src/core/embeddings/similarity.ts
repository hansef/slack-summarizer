import { createHash } from 'crypto';
import { Conversation } from '@/core/models/conversation.js';
import {
  ConversationReferences,
  calculateReferenceSimilarity,
} from '@/core/consolidation/reference-extractor.js';
import { getEmbeddingClient } from './client.js';
import {
  getCachedEmbedding,
  setCachedEmbedding,
  getCachedEmbeddingsBatch,
  setCachedEmbeddingsBatch,
  CachedEmbedding,
} from './cache.js';
import { logger } from '@/utils/logger.js';

export interface SimilarityConfig {
  /** Weight for reference-based similarity (0-1), default 0.6 */
  referenceWeight: number;
  /** Weight for embedding-based similarity (0-1), default 0.4 */
  embeddingWeight: number;
  /** Whether embeddings are enabled */
  enableEmbeddings: boolean;
}

export interface ConversationWithEmbedding {
  conversation: Conversation;
  text: string;
  textHash: string;
  embedding: number[] | null;
}

/**
 * Concatenate all message text from a conversation for embedding
 */
export function prepareConversationText(conv: Conversation): string {
  return conv.messages
    .map((m) => m.text || '')
    .filter((t) => t.length > 0)
    .join(' ');
}

/**
 * Generate a SHA-256 hash of the conversation text for cache keying
 */
export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Calculate cosine similarity between two embedding vectors
 * Returns a value between -1 and 1 (1 = identical, 0 = orthogonal, -1 = opposite)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

/**
 * Prepare embeddings for all conversations, using cache where possible
 * Batches API calls for efficiency
 */
export async function prepareConversationEmbeddings(
  conversations: Conversation[]
): Promise<Map<string, ConversationWithEmbedding>> {
  const result = new Map<string, ConversationWithEmbedding>();
  const client = getEmbeddingClient();
  const model = client.getModel();

  // First pass: prepare text and check cache
  const conversationData: Array<{
    conv: Conversation;
    text: string;
    textHash: string;
  }> = [];

  for (const conv of conversations) {
    const text = prepareConversationText(conv);
    const textHash = hashText(text);
    conversationData.push({ conv, text, textHash });
  }

  // Batch cache lookup
  const cacheKeys = conversationData.map((d) => ({
    conversationId: d.conv.id,
    textHash: d.textHash,
  }));
  const cachedEmbeddings = getCachedEmbeddingsBatch(cacheKeys);

  // Identify which conversations need embeddings generated
  const needsGeneration: Array<{
    conv: Conversation;
    text: string;
    textHash: string;
    index: number;
  }> = [];

  for (let i = 0; i < conversationData.length; i++) {
    const { conv, text, textHash } = conversationData[i];
    const cached = cachedEmbeddings.get(conv.id);

    if (cached) {
      // Use cached embedding
      result.set(conv.id, {
        conversation: conv,
        text,
        textHash,
        embedding: cached.embedding,
      });
    } else if (text.trim().length > 0) {
      // Need to generate embedding
      needsGeneration.push({ conv, text, textHash, index: i });
    } else {
      // Empty text, no embedding possible
      result.set(conv.id, {
        conversation: conv,
        text,
        textHash,
        embedding: null,
      });
    }
  }

  // Generate embeddings for uncached conversations in batches
  if (needsGeneration.length > 0) {
    logger.debug('Generating embeddings for conversations', {
      count: needsGeneration.length,
      cached: cachedEmbeddings.size,
    });

    try {
      const texts = needsGeneration.map((d) => d.text);
      const embeddings = await client.embedBatch(texts);

      // Store results and cache
      const toCache: CachedEmbedding[] = [];

      for (let i = 0; i < needsGeneration.length; i++) {
        const { conv, text, textHash } = needsGeneration[i];
        const embedding = embeddings[i];

        result.set(conv.id, {
          conversation: conv,
          text,
          textHash,
          embedding,
        });

        toCache.push({
          conversationId: conv.id,
          embedding,
          textHash,
          embeddingModel: model,
          dimensions: embedding.length,
          createdAt: Date.now(),
        });
      }

      // Batch cache write
      setCachedEmbeddingsBatch(toCache);
    } catch (error) {
      logger.error('Failed to generate embeddings batch', {
        error: error instanceof Error ? error.message : String(error),
        count: needsGeneration.length,
      });

      // Mark all as failed (null embedding)
      for (const { conv, text, textHash } of needsGeneration) {
        result.set(conv.id, {
          conversation: conv,
          text,
          textHash,
          embedding: null,
        });
      }
    }
  }

  return result;
}

/**
 * Get or generate embedding for a single conversation
 */
export async function getConversationEmbedding(conv: Conversation): Promise<number[] | null> {
  const text = prepareConversationText(conv);
  if (text.trim().length === 0) {
    return null;
  }

  const textHash = hashText(text);

  // Check cache first
  const cached = getCachedEmbedding(conv.id, textHash);
  if (cached) {
    return cached.embedding;
  }

  // Generate new embedding
  try {
    const client = getEmbeddingClient();
    const embedding = await client.embed(text);

    // Cache it
    setCachedEmbedding({
      conversationId: conv.id,
      embedding,
      textHash,
      embeddingModel: client.getModel(),
      dimensions: embedding.length,
      createdAt: Date.now(),
    });

    return embedding;
  } catch (error) {
    logger.error('Failed to generate embedding', {
      conversationId: conv.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Calculate hybrid similarity between two conversations
 * Combines reference similarity and embedding similarity with configurable weights
 */
export function calculateHybridSimilarity(
  conv1: Conversation,
  conv2: Conversation,
  refs1: ConversationReferences | undefined,
  refs2: ConversationReferences | undefined,
  emb1: number[] | null,
  emb2: number[] | null,
  config: SimilarityConfig
): number {
  // Calculate reference similarity
  const refSimilarity = refs1 && refs2 ? calculateReferenceSimilarity(refs1, refs2) : 0;

  // If embeddings are disabled or unavailable, return reference similarity only
  if (!config.enableEmbeddings || !emb1 || !emb2) {
    return refSimilarity;
  }

  // Calculate embedding similarity using pure function (no client dependency)
  const embSimilarity = cosineSimilarity(emb1, emb2);

  // Normalize embedding similarity: only positive similarity contributes
  // Orthogonal (cosine=0) and negative (cosine<0) embeddings contribute 0
  // This prevents unrelated conversations from getting a baseline similarity score
  const normalizedEmbSimilarity = Math.max(0, embSimilarity);

  // Weighted combination
  const combined =
    config.referenceWeight * refSimilarity + config.embeddingWeight * normalizedEmbSimilarity;

  logger.debug('Hybrid similarity calculated', {
    conv1: conv1.id.substring(0, 8),
    conv2: conv2.id.substring(0, 8),
    refSimilarity: refSimilarity.toFixed(3),
    embSimilarity: normalizedEmbSimilarity.toFixed(3),
    combined: combined.toFixed(3),
  });

  return combined;
}
