import { getDatabase } from '../cache/db.js';
import { logger } from '../../utils/logger.js';

export interface CachedEmbedding {
  conversationId: string;
  embedding: number[];
  textHash: string;
  embeddingModel: string;
  dimensions: number;
  createdAt: number;
}

interface EmbeddingRow {
  conversation_id: string;
  embedding: Buffer;
  text_hash: string;
  embedding_model: string;
  dimensions: number;
  created_at: number;
}

/**
 * Serialize a number array to a Buffer for SQLite BLOB storage
 */
function serializeEmbedding(embedding: number[]): Buffer {
  const floatArray = new Float32Array(embedding);
  return Buffer.from(floatArray.buffer);
}

/**
 * Deserialize a Buffer back to a number array
 * Creates a defensive copy to avoid issues with buffer memory reuse
 */
function deserializeEmbedding(buffer: Buffer): number[] {
  // Create a copy of the buffer to avoid issues with SQLite memory reuse
  const copy = Buffer.from(buffer);
  const floatArray = new Float32Array(copy.buffer, copy.byteOffset, copy.length / 4);
  return Array.from(floatArray);
}

/**
 * Get a cached embedding for a conversation
 * Returns null if not found or if the text hash doesn't match
 */
export function getCachedEmbedding(conversationId: string, textHash: string): CachedEmbedding | null {
  const db = getDatabase();

  const row = db
    .prepare(
      `SELECT conversation_id, embedding, text_hash, embedding_model, dimensions, created_at
       FROM conversation_embeddings
       WHERE conversation_id = ? AND text_hash = ?`
    )
    .get(conversationId, textHash) as EmbeddingRow | undefined;

  if (!row) {
    return null;
  }

  return {
    conversationId: row.conversation_id,
    embedding: deserializeEmbedding(row.embedding),
    textHash: row.text_hash,
    embeddingModel: row.embedding_model,
    dimensions: row.dimensions,
    createdAt: row.created_at,
  };
}

/**
 * Get cached embeddings for multiple conversations in a single query
 * Returns a Map of conversationId -> CachedEmbedding
 */
export function getCachedEmbeddingsBatch(
  keys: Array<{ conversationId: string; textHash: string }>
): Map<string, CachedEmbedding> {
  if (keys.length === 0) {
    return new Map();
  }

  const db = getDatabase();
  const result = new Map<string, CachedEmbedding>();

  // Build query with multiple OR conditions
  // SQLite doesn't have a great way to do batch lookups with compound keys,
  // so we use individual queries for now (could optimize with temp table if needed)
  const stmt = db.prepare(
    `SELECT conversation_id, embedding, text_hash, embedding_model, dimensions, created_at
     FROM conversation_embeddings
     WHERE conversation_id = ? AND text_hash = ?`
  );

  for (const key of keys) {
    const row = stmt.get(key.conversationId, key.textHash) as EmbeddingRow | undefined;
    if (row) {
      result.set(key.conversationId, {
        conversationId: row.conversation_id,
        embedding: deserializeEmbedding(row.embedding),
        textHash: row.text_hash,
        embeddingModel: row.embedding_model,
        dimensions: row.dimensions,
        createdAt: row.created_at,
      });
    }
  }

  return result;
}

/**
 * Store an embedding in the cache
 * Uses INSERT OR REPLACE to update if the conversation already exists
 */
export function setCachedEmbedding(embedding: CachedEmbedding): void {
  const db = getDatabase();

  db.prepare(
    `INSERT OR REPLACE INTO conversation_embeddings
     (conversation_id, embedding, text_hash, embedding_model, dimensions, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    embedding.conversationId,
    serializeEmbedding(embedding.embedding),
    embedding.textHash,
    embedding.embeddingModel,
    embedding.dimensions,
    embedding.createdAt
  );

  logger.debug('Cached embedding', {
    conversationId: embedding.conversationId,
    dimensions: embedding.dimensions,
  });
}

/**
 * Store multiple embeddings in a single transaction
 */
export function setCachedEmbeddingsBatch(embeddings: CachedEmbedding[]): void {
  if (embeddings.length === 0) {
    return;
  }

  const db = getDatabase();

  const stmt = db.prepare(
    `INSERT OR REPLACE INTO conversation_embeddings
     (conversation_id, embedding, text_hash, embedding_model, dimensions, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const insertMany = db.transaction((items: CachedEmbedding[]) => {
    for (const emb of items) {
      stmt.run(
        emb.conversationId,
        serializeEmbedding(emb.embedding),
        emb.textHash,
        emb.embeddingModel,
        emb.dimensions,
        emb.createdAt
      );
    }
  });

  insertMany(embeddings);

  logger.debug('Cached embeddings batch', {
    count: embeddings.length,
  });
}

/**
 * Clear cached embeddings for a specific conversation or all embeddings
 */
export function clearCachedEmbeddings(conversationId?: string): void {
  const db = getDatabase();

  if (conversationId) {
    db.prepare('DELETE FROM conversation_embeddings WHERE conversation_id = ?').run(conversationId);
    logger.debug('Cleared embedding cache for conversation', { conversationId });
  } else {
    db.prepare('DELETE FROM conversation_embeddings').run();
    logger.debug('Cleared all embedding cache');
  }
}
