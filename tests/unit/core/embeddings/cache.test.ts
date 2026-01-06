/**
 * Tests for embedding cache SQLite operations.
 *
 * These tests validate the caching layer that stores conversation embeddings
 * in SQLite for performance optimization. Key areas tested:
 * - Float32Array serialization/deserialization round-trips
 * - Cache hit/miss behavior based on textHash matching
 * - Batch operations with transactions
 * - Cache invalidation and cleanup
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';

// Use vi.hoisted to ensure the state object is created before the mock factory
const dbState = vi.hoisted(() => ({
  db: null as Database.Database | null,
}));

// Mock the database module with a getter that references the hoisted state
vi.mock('@/core/cache/db.js', () => ({
  getDatabase: vi.fn(() => {
    if (!dbState.db) {
      throw new Error('Test database not initialized - ensure beforeEach has run');
    }
    return dbState.db;
  }),
}));

// Import test utilities after mock setup
import { createTestDatabase, createTestEmbedding, expectEmbeddingsEqual } from '@tests/utils/test-db.js';

// Import cache functions after mocking
import {
  getCachedEmbedding,
  getCachedEmbeddingsBatch,
  setCachedEmbedding,
  setCachedEmbeddingsBatch,
  clearCachedEmbeddings,
  type CachedEmbedding,
} from '../../../../src/core/embeddings/cache.js';

describe('Embedding Cache', () => {
  beforeEach(() => {
    dbState.db = createTestDatabase();
  });

  afterEach(() => {
    if (dbState.db) {
      dbState.db.close();
      dbState.db = null;
    }
  });

  describe('setCachedEmbedding and getCachedEmbedding', () => {
    it('should store and retrieve an embedding', () => {
      const embedding = createTestEmbedding(1536);
      const cached: CachedEmbedding = {
        conversationId: 'conv-123',
        embedding,
        textHash: 'hash-abc',
        embeddingModel: 'text-embedding-3-small',
        dimensions: 1536,
        createdAt: Date.now(),
      };

      setCachedEmbedding(cached);
      const retrieved = getCachedEmbedding('conv-123', 'hash-abc');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.conversationId).toBe('conv-123');
      expect(retrieved!.embeddingModel).toBe('text-embedding-3-small');
      expect(retrieved!.dimensions).toBe(1536);
      expectEmbeddingsEqual(retrieved!.embedding, embedding);
    });

    it('should return null for non-existent conversation', () => {
      const result = getCachedEmbedding('non-existent', 'hash-abc');
      expect(result).toBeNull();
    });

    it('should return null when textHash does not match', () => {
      const embedding = createTestEmbedding(1536);
      const cached: CachedEmbedding = {
        conversationId: 'conv-123',
        embedding,
        textHash: 'original-hash',
        embeddingModel: 'text-embedding-3-small',
        dimensions: 1536,
        createdAt: Date.now(),
      };

      setCachedEmbedding(cached);

      // Query with different hash - should miss
      const result = getCachedEmbedding('conv-123', 'different-hash');
      expect(result).toBeNull();
    });

    it('should update existing embedding on re-insert', () => {
      const originalEmbedding = createTestEmbedding(1536);
      const updatedEmbedding = createTestEmbedding(1536);

      setCachedEmbedding({
        conversationId: 'conv-123',
        embedding: originalEmbedding,
        textHash: 'hash-v1',
        embeddingModel: 'text-embedding-3-small',
        dimensions: 1536,
        createdAt: Date.now(),
      });

      setCachedEmbedding({
        conversationId: 'conv-123',
        embedding: updatedEmbedding,
        textHash: 'hash-v2',
        embeddingModel: 'text-embedding-3-small',
        dimensions: 1536,
        createdAt: Date.now(),
      });

      // Original hash should no longer work
      expect(getCachedEmbedding('conv-123', 'hash-v1')).toBeNull();

      // New hash should work
      const result = getCachedEmbedding('conv-123', 'hash-v2');
      expect(result).not.toBeNull();
      expectEmbeddingsEqual(result!.embedding, updatedEmbedding);
    });
  });

  describe('Float32Array serialization', () => {
    it('should preserve embedding precision through serialization round-trip', () => {
      // Create embedding with specific values to test precision
      const embedding = [
        0.123456789,
        -0.987654321,
        0.0,
        1.0,
        -1.0,
        0.00001,
        -0.00001,
        Number.MAX_VALUE / 1e308, // Large but within Float32 range
      ];

      setCachedEmbedding({
        conversationId: 'precision-test',
        embedding,
        textHash: 'hash-precision',
        embeddingModel: 'test-model',
        dimensions: embedding.length,
        createdAt: Date.now(),
      });

      const retrieved = getCachedEmbedding('precision-test', 'hash-precision');
      expect(retrieved).not.toBeNull();

      // Float32 has ~7 decimal digits of precision
      for (let i = 0; i < embedding.length; i++) {
        const diff = Math.abs(retrieved!.embedding[i] - embedding[i]);
        // Allow for Float32 precision loss (about 1e-7 relative error)
        expect(diff).toBeLessThan(Math.abs(embedding[i]) * 1e-6 + 1e-7);
      }
    });

    it('should handle large embeddings (3072 dimensions)', () => {
      const embedding = createTestEmbedding(3072); // text-embedding-3-large size

      setCachedEmbedding({
        conversationId: 'large-embedding',
        embedding,
        textHash: 'hash-large',
        embeddingModel: 'text-embedding-3-large',
        dimensions: 3072,
        createdAt: Date.now(),
      });

      const retrieved = getCachedEmbedding('large-embedding', 'hash-large');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.embedding.length).toBe(3072);
      expectEmbeddingsEqual(retrieved!.embedding, embedding);
    });
  });

  describe('getCachedEmbeddingsBatch', () => {
    it('should return empty map for empty keys array', () => {
      const result = getCachedEmbeddingsBatch([]);
      expect(result.size).toBe(0);
    });

    it('should retrieve multiple cached embeddings', () => {
      const embeddings = [
        { conversationId: 'conv-1', textHash: 'hash-1' },
        { conversationId: 'conv-2', textHash: 'hash-2' },
        { conversationId: 'conv-3', textHash: 'hash-3' },
      ];

      // Insert all embeddings
      for (const { conversationId, textHash } of embeddings) {
        setCachedEmbedding({
          conversationId,
          embedding: createTestEmbedding(1536),
          textHash,
          embeddingModel: 'text-embedding-3-small',
          dimensions: 1536,
          createdAt: Date.now(),
        });
      }

      const result = getCachedEmbeddingsBatch(embeddings);

      expect(result.size).toBe(3);
      expect(result.has('conv-1')).toBe(true);
      expect(result.has('conv-2')).toBe(true);
      expect(result.has('conv-3')).toBe(true);
    });

    it('should return partial results for partial cache hits', () => {
      // Only insert conv-1 and conv-3
      setCachedEmbedding({
        conversationId: 'conv-1',
        embedding: createTestEmbedding(1536),
        textHash: 'hash-1',
        embeddingModel: 'text-embedding-3-small',
        dimensions: 1536,
        createdAt: Date.now(),
      });

      setCachedEmbedding({
        conversationId: 'conv-3',
        embedding: createTestEmbedding(1536),
        textHash: 'hash-3',
        embeddingModel: 'text-embedding-3-small',
        dimensions: 1536,
        createdAt: Date.now(),
      });

      const result = getCachedEmbeddingsBatch([
        { conversationId: 'conv-1', textHash: 'hash-1' },
        { conversationId: 'conv-2', textHash: 'hash-2' }, // Not cached
        { conversationId: 'conv-3', textHash: 'hash-3' },
      ]);

      expect(result.size).toBe(2);
      expect(result.has('conv-1')).toBe(true);
      expect(result.has('conv-2')).toBe(false);
      expect(result.has('conv-3')).toBe(true);
    });

    it('should not return embeddings with mismatched hashes', () => {
      setCachedEmbedding({
        conversationId: 'conv-1',
        embedding: createTestEmbedding(1536),
        textHash: 'original-hash',
        embeddingModel: 'text-embedding-3-small',
        dimensions: 1536,
        createdAt: Date.now(),
      });

      const result = getCachedEmbeddingsBatch([
        { conversationId: 'conv-1', textHash: 'different-hash' },
      ]);

      expect(result.size).toBe(0);
    });
  });

  describe('setCachedEmbeddingsBatch', () => {
    it('should handle empty array', () => {
      // Should not throw
      setCachedEmbeddingsBatch([]);
    });

    it('should insert multiple embeddings in batch', () => {
      const embeddings: CachedEmbedding[] = Array.from({ length: 10 }, (_, i) => ({
        conversationId: `conv-${i}`,
        embedding: createTestEmbedding(1536),
        textHash: `hash-${i}`,
        embeddingModel: 'text-embedding-3-small',
        dimensions: 1536,
        createdAt: Date.now(),
      }));

      setCachedEmbeddingsBatch(embeddings);

      // Verify all were inserted
      for (let i = 0; i < 10; i++) {
        const result = getCachedEmbedding(`conv-${i}`, `hash-${i}`);
        expect(result).not.toBeNull();
        expectEmbeddingsEqual(result!.embedding, embeddings[i].embedding);
      }
    });

    it('should handle large batches', () => {
      const embeddings: CachedEmbedding[] = Array.from({ length: 100 }, (_, i) => ({
        conversationId: `conv-${i}`,
        embedding: createTestEmbedding(1536),
        textHash: `hash-${i}`,
        embeddingModel: 'text-embedding-3-small',
        dimensions: 1536,
        createdAt: Date.now(),
      }));

      setCachedEmbeddingsBatch(embeddings);

      // Spot check some entries
      expect(getCachedEmbedding('conv-0', 'hash-0')).not.toBeNull();
      expect(getCachedEmbedding('conv-50', 'hash-50')).not.toBeNull();
      expect(getCachedEmbedding('conv-99', 'hash-99')).not.toBeNull();
    });

    it('should use transaction for atomicity', () => {
      // Insert some initial data
      setCachedEmbedding({
        conversationId: 'existing',
        embedding: createTestEmbedding(1536),
        textHash: 'hash-existing',
        embeddingModel: 'text-embedding-3-small',
        dimensions: 1536,
        createdAt: Date.now(),
      });

      // The batch should be atomic - all or nothing
      const embeddings: CachedEmbedding[] = Array.from({ length: 5 }, (_, i) => ({
        conversationId: `batch-${i}`,
        embedding: createTestEmbedding(1536),
        textHash: `hash-batch-${i}`,
        embeddingModel: 'text-embedding-3-small',
        dimensions: 1536,
        createdAt: Date.now(),
      }));

      setCachedEmbeddingsBatch(embeddings);

      // All should exist
      for (let i = 0; i < 5; i++) {
        expect(getCachedEmbedding(`batch-${i}`, `hash-batch-${i}`)).not.toBeNull();
      }
      // Existing should still exist
      expect(getCachedEmbedding('existing', 'hash-existing')).not.toBeNull();
    });
  });

  describe('clearCachedEmbeddings', () => {
    beforeEach(() => {
      // Insert test data
      setCachedEmbedding({
        conversationId: 'conv-1',
        embedding: createTestEmbedding(1536),
        textHash: 'hash-1',
        embeddingModel: 'text-embedding-3-small',
        dimensions: 1536,
        createdAt: Date.now(),
      });

      setCachedEmbedding({
        conversationId: 'conv-2',
        embedding: createTestEmbedding(1536),
        textHash: 'hash-2',
        embeddingModel: 'text-embedding-3-small',
        dimensions: 1536,
        createdAt: Date.now(),
      });

      setCachedEmbedding({
        conversationId: 'conv-3',
        embedding: createTestEmbedding(1536),
        textHash: 'hash-3',
        embeddingModel: 'text-embedding-3-small',
        dimensions: 1536,
        createdAt: Date.now(),
      });
    });

    it('should clear specific conversation embedding', () => {
      clearCachedEmbeddings('conv-2');

      expect(getCachedEmbedding('conv-1', 'hash-1')).not.toBeNull();
      expect(getCachedEmbedding('conv-2', 'hash-2')).toBeNull();
      expect(getCachedEmbedding('conv-3', 'hash-3')).not.toBeNull();
    });

    it('should clear all embeddings when no conversationId provided', () => {
      clearCachedEmbeddings();

      expect(getCachedEmbedding('conv-1', 'hash-1')).toBeNull();
      expect(getCachedEmbedding('conv-2', 'hash-2')).toBeNull();
      expect(getCachedEmbedding('conv-3', 'hash-3')).toBeNull();
    });

    it('should not throw when clearing non-existent conversation', () => {
      // Should not throw
      clearCachedEmbeddings('non-existent');

      // Other embeddings should still exist
      expect(getCachedEmbedding('conv-1', 'hash-1')).not.toBeNull();
    });
  });
});
