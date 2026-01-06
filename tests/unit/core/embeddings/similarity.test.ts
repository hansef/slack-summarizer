import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Conversation } from '@/core/models/conversation.js';
import { SlackMessage } from '@/core/models/slack.js';

// Use vi.hoisted to create mock functions before vi.mock runs
const { mockEmbed, mockEmbedBatch, mockGetModel, mockGetCachedEmbedding, mockSetCachedEmbedding, mockGetCachedEmbeddingsBatch, mockSetCachedEmbeddingsBatch } = vi.hoisted(() => ({
  mockEmbed: vi.fn(),
  mockEmbedBatch: vi.fn(),
  mockGetModel: vi.fn(() => 'text-embedding-3-small'),
  mockGetCachedEmbedding: vi.fn().mockReturnValue(null),
  mockSetCachedEmbedding: vi.fn(),
  mockGetCachedEmbeddingsBatch: vi.fn().mockReturnValue(new Map()),
  mockSetCachedEmbeddingsBatch: vi.fn(),
}));

// Mock the embedding client module
vi.mock('@/core/embeddings/client.js', () => ({
  getEmbeddingClient: vi.fn(() => ({
    embed: mockEmbed,
    embedBatch: mockEmbedBatch,
    getModel: mockGetModel,
  })),
  resetEmbeddingClient: vi.fn(),
}));

// Mock the cache module
vi.mock('@/core/embeddings/cache.js', () => ({
  getCachedEmbedding: mockGetCachedEmbedding,
  setCachedEmbedding: mockSetCachedEmbedding,
  getCachedEmbeddingsBatch: mockGetCachedEmbeddingsBatch,
  setCachedEmbeddingsBatch: mockSetCachedEmbeddingsBatch,
}));

import {
  prepareConversationText,
  hashText,
  cosineSimilarity,
  calculateHybridSimilarity,
  prepareConversationEmbeddings,
  getConversationEmbedding,
} from '@/core/embeddings/similarity.js';
import type { CachedEmbedding } from '@/core/embeddings/cache.js';

function createMessage(text: string, ts = '1234.5678'): SlackMessage {
  return {
    type: 'message',
    ts,
    channel: 'C123',
    text,
    user: 'U123',
  };
}

function createConversation(messages: SlackMessage[], id = 'conv-1'): Conversation {
  return {
    id,
    channelId: 'C123',
    channelName: 'general',
    isThread: false,
    messages,
    startTime: '2024-01-01T10:00:00Z',
    endTime: '2024-01-01T10:30:00Z',
    participants: ['U123'],
    messageCount: messages.length,
    userMessageCount: messages.length,
  };
}

describe('Embedding Similarity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('prepareConversationText', () => {
    it('should concatenate all message text', () => {
      const conv = createConversation([
        createMessage('Hello world', '1000.0'),
        createMessage('How are you?', '1001.0'),
        createMessage('I am fine', '1002.0'),
      ]);

      const text = prepareConversationText(conv);
      expect(text).toBe('Hello world How are you? I am fine');
    });

    it('should handle empty messages', () => {
      const conv = createConversation([
        createMessage('Hello', '1000.0'),
        createMessage('', '1001.0'),
        createMessage('World', '1002.0'),
      ]);

      const text = prepareConversationText(conv);
      expect(text).toBe('Hello World');
    });

    it('should handle conversation with no text', () => {
      const conv = createConversation([
        createMessage('', '1000.0'),
        createMessage('', '1001.0'),
      ]);

      const text = prepareConversationText(conv);
      expect(text).toBe('');
    });
  });

  describe('hashText', () => {
    it('should generate consistent hashes', () => {
      const text = 'Hello world';
      const hash1 = hashText(text);
      const hash2 = hashText(text);
      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different text', () => {
      const hash1 = hashText('Hello world');
      const hash2 = hashText('Hello world!');
      expect(hash1).not.toBe(hash2);
    });

    it('should return a valid SHA-256 hex string', () => {
      const hash = hashText('test');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('cosineSimilarity', () => {
    it('should return 1.0 for identical vectors', () => {
      const a = [1, 0, 0];
      const b = [1, 0, 0];
      expect(cosineSimilarity(a, b)).toBe(1);
    });

    it('should return 0 for orthogonal vectors', () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      expect(cosineSimilarity(a, b)).toBe(0);
    });

    it('should return -1 for opposite vectors', () => {
      const a = [1, 0, 0];
      const b = [-1, 0, 0];
      expect(cosineSimilarity(a, b)).toBe(-1);
    });

    it('should throw for vectors of different dimensions', () => {
      const a = [1, 0, 0];
      const b = [1, 0];
      expect(() => cosineSimilarity(a, b)).toThrow('dimension mismatch');
    });

    it('should handle zero vectors gracefully', () => {
      const a = [0, 0, 0];
      const b = [1, 0, 0];
      expect(cosineSimilarity(a, b)).toBe(0);
    });
  });

  describe('calculateHybridSimilarity', () => {
    it('should return reference similarity when embeddings disabled', () => {
      const conv1 = createConversation([createMessage('Hello')], 'conv-1');
      const conv2 = createConversation([createMessage('World')], 'conv-2');

      const refs1 = {
        conversationId: 'conv-1',
        references: [{ type: 'github_issue' as const, value: '#123', raw: '#123', messageTs: '1' }],
        uniqueRefs: new Set(['#123']),
      };
      const refs2 = {
        conversationId: 'conv-2',
        references: [{ type: 'github_issue' as const, value: '#123', raw: '#123', messageTs: '2' }],
        uniqueRefs: new Set(['#123']),
      };

      const similarity = calculateHybridSimilarity(
        conv1,
        conv2,
        refs1,
        refs2,
        null, // no embedding
        null, // no embedding
        {
          enableEmbeddings: false,
          referenceWeight: 0.6,
          embeddingWeight: 0.4,
        }
      );

      // When embeddings disabled, should return reference similarity (1.0 for identical refs)
      expect(similarity).toBe(1.0);
    });

    it('should return reference similarity when embeddings are null', () => {
      const conv1 = createConversation([createMessage('Hello')], 'conv-1');
      const conv2 = createConversation([createMessage('World')], 'conv-2');

      const refs1 = {
        conversationId: 'conv-1',
        references: [],
        uniqueRefs: new Set(['U111']),
      };
      const refs2 = {
        conversationId: 'conv-2',
        references: [],
        uniqueRefs: new Set(['U222']),
      };

      const similarity = calculateHybridSimilarity(
        conv1,
        conv2,
        refs1,
        refs2,
        null, // no embedding
        null, // no embedding
        {
          enableEmbeddings: true, // enabled but no embeddings available
          referenceWeight: 0.6,
          embeddingWeight: 0.4,
        }
      );

      // No overlap in refs, should return 0
      expect(similarity).toBe(0);
    });

    it('should combine reference and embedding similarity with weights', () => {
      const conv1 = createConversation([createMessage('Hello')], 'conv-1');
      const conv2 = createConversation([createMessage('World')], 'conv-2');

      // No shared references
      const refs1 = {
        conversationId: 'conv-1',
        references: [],
        uniqueRefs: new Set<string>(),
      };
      const refs2 = {
        conversationId: 'conv-2',
        references: [],
        uniqueRefs: new Set<string>(),
      };

      // Identical embeddings (cosine = 1.0, normalized = 1.0)
      const emb1 = [1, 0, 0];
      const emb2 = [1, 0, 0];

      const similarity = calculateHybridSimilarity(conv1, conv2, refs1, refs2, emb1, emb2, {
        enableEmbeddings: true,
        referenceWeight: 0.6,
        embeddingWeight: 0.4,
      });

      // ref similarity = 0 (no shared refs)
      // emb similarity = 1.0, normalized = (1+1)/2 = 1.0
      // combined = 0.6 * 0 + 0.4 * 1.0 = 0.4
      expect(similarity).toBeCloseTo(0.4);
    });

    it('should return 0 for orthogonal embeddings (no baseline contribution)', () => {
      const conv1 = createConversation([createMessage('Hello')], 'conv-1');
      const conv2 = createConversation([createMessage('World')], 'conv-2');

      const refs1 = {
        conversationId: 'conv-1',
        references: [],
        uniqueRefs: new Set<string>(),
      };
      const refs2 = {
        conversationId: 'conv-2',
        references: [],
        uniqueRefs: new Set<string>(),
      };

      // Orthogonal embeddings (cosine = 0)
      const emb1 = [1, 0, 0];
      const emb2 = [0, 1, 0];

      const similarity = calculateHybridSimilarity(conv1, conv2, refs1, refs2, emb1, emb2, {
        enableEmbeddings: true,
        referenceWeight: 0.6,
        embeddingWeight: 0.4,
      });

      // ref similarity = 0
      // emb similarity = 0.0 (cosine=0, clamped to 0, not normalized to 0.5)
      // combined = 0.6 * 0 + 0.4 * 0 = 0
      // This prevents unrelated conversations from getting a baseline similarity score
      expect(similarity).toBe(0);
    });

    it('should return 0 for negative cosine similarity', () => {
      const conv1 = createConversation([createMessage('Hello')], 'conv-1');
      const conv2 = createConversation([createMessage('World')], 'conv-2');

      const refs1 = {
        conversationId: 'conv-1',
        references: [],
        uniqueRefs: new Set<string>(),
      };
      const refs2 = {
        conversationId: 'conv-2',
        references: [],
        uniqueRefs: new Set<string>(),
      };

      // Opposite embeddings (cosine = -1)
      const emb1 = [1, 0, 0];
      const emb2 = [-1, 0, 0];

      const similarity = calculateHybridSimilarity(conv1, conv2, refs1, refs2, emb1, emb2, {
        enableEmbeddings: true,
        referenceWeight: 0.6,
        embeddingWeight: 0.4,
      });

      // Negative cosine clamped to 0
      expect(similarity).toBe(0);
    });
  });

  describe('prepareConversationEmbeddings', () => {
    const mockEmbedding = [0.1, 0.2, 0.3];

    beforeEach(() => {
      mockGetCachedEmbeddingsBatch.mockReturnValue(new Map());
      mockEmbedBatch.mockResolvedValue([mockEmbedding, mockEmbedding]);
    });

    it('should use cached embeddings when available', async () => {
      const conv1 = createConversation([createMessage('Hello world')], 'conv-1');
      const conv2 = createConversation([createMessage('Goodbye world')], 'conv-2');

      // Set up cache to return embedding for conv-1
      const cachedMap = new Map();
      cachedMap.set('conv-1', {
        conversationId: 'conv-1',
        embedding: [0.5, 0.5, 0.5],
        textHash: 'hash-1',
        embeddingModel: 'text-embedding-3-small',
        dimensions: 3,
        createdAt: Date.now(),
      });
      mockGetCachedEmbeddingsBatch.mockReturnValue(cachedMap);
      mockEmbedBatch.mockResolvedValue([[0.1, 0.2, 0.3]]); // Only one embedding needed

      const result = await prepareConversationEmbeddings([conv1, conv2]);

      expect(result.size).toBe(2);
      // conv-1 should use cached embedding
      expect(result.get('conv-1')?.embedding).toEqual([0.5, 0.5, 0.5]);
      // conv-2 should use API embedding
      expect(result.get('conv-2')?.embedding).toEqual([0.1, 0.2, 0.3]);
    });

    it('should generate embeddings for conversations not in cache', async () => {
      const conv1 = createConversation([createMessage('Hello')], 'conv-1');
      const conv2 = createConversation([createMessage('World')], 'conv-2');

      mockEmbedBatch.mockResolvedValue([[0.1, 0.2], [0.3, 0.4]]);

      const result = await prepareConversationEmbeddings([conv1, conv2]);

      expect(result.size).toBe(2);
      expect(result.get('conv-1')?.embedding).toEqual([0.1, 0.2]);
      expect(result.get('conv-2')?.embedding).toEqual([0.3, 0.4]);
      expect(mockEmbedBatch).toHaveBeenCalledTimes(1);
    });

    it('should return null embedding for conversations with empty text', async () => {
      const conv1 = createConversation([createMessage('')], 'conv-1');
      const conv2 = createConversation([createMessage('Has text')], 'conv-2');

      mockEmbedBatch.mockResolvedValue([[0.1, 0.2]]);

      const result = await prepareConversationEmbeddings([conv1, conv2]);

      expect(result.size).toBe(2);
      expect(result.get('conv-1')?.embedding).toBeNull();
      expect(result.get('conv-2')?.embedding).toEqual([0.1, 0.2]);
    });

    it('should handle API errors gracefully', async () => {
      const conv = createConversation([createMessage('Hello')], 'conv-1');

      mockEmbedBatch.mockRejectedValue(new Error('API rate limit'));

      const result = await prepareConversationEmbeddings([conv]);

      // Should return null embedding on error, not throw
      expect(result.size).toBe(1);
      expect(result.get('conv-1')?.embedding).toBeNull();
    });

    it('should cache generated embeddings', async () => {
      const conv = createConversation([createMessage('Hello')], 'conv-1');

      mockEmbedBatch.mockResolvedValue([[0.1, 0.2, 0.3]]);

      await prepareConversationEmbeddings([conv]);

      expect(mockSetCachedEmbeddingsBatch).toHaveBeenCalledTimes(1);
      const cachedEmbeddings = mockSetCachedEmbeddingsBatch.mock.calls[0][0] as CachedEmbedding[];
      expect(cachedEmbeddings).toHaveLength(1);
      expect(cachedEmbeddings[0].conversationId).toBe('conv-1');
    });

    it('should handle empty conversation list', async () => {
      const result = await prepareConversationEmbeddings([]);

      expect(result.size).toBe(0);
      expect(mockEmbedBatch).not.toHaveBeenCalled();
    });
  });

  describe('getConversationEmbedding', () => {
    it('should return cached embedding when available', async () => {
      const conv = createConversation([createMessage('Hello world')], 'conv-1');
      const cachedEmbedding = [0.5, 0.5, 0.5];

      mockGetCachedEmbedding.mockReturnValue({
        conversationId: 'conv-1',
        embedding: cachedEmbedding,
        textHash: 'hash-1',
        embeddingModel: 'text-embedding-3-small',
        dimensions: 3,
        createdAt: Date.now(),
      });

      const result = await getConversationEmbedding(conv);

      expect(result).toEqual(cachedEmbedding);
      expect(mockEmbed).not.toHaveBeenCalled();
    });

    it('should generate and cache embedding when not cached', async () => {
      const conv = createConversation([createMessage('Hello world')], 'conv-1');
      const generatedEmbedding = [0.1, 0.2, 0.3];

      mockGetCachedEmbedding.mockReturnValue(null);
      mockEmbed.mockResolvedValue(generatedEmbedding);

      const result = await getConversationEmbedding(conv);

      expect(result).toEqual(generatedEmbedding);
      expect(mockEmbed).toHaveBeenCalledWith('Hello world');
      expect(mockSetCachedEmbedding).toHaveBeenCalledTimes(1);
    });

    it('should return null for conversation with empty text', async () => {
      const conv = createConversation([createMessage('')], 'conv-1');

      const result = await getConversationEmbedding(conv);

      expect(result).toBeNull();
      expect(mockEmbed).not.toHaveBeenCalled();
    });

    it('should return null and log error on API failure', async () => {
      const conv = createConversation([createMessage('Hello')], 'conv-1');

      mockGetCachedEmbedding.mockReturnValue(null);
      mockEmbed.mockRejectedValue(new Error('API error'));

      const result = await getConversationEmbedding(conv);

      expect(result).toBeNull();
    });
  });
});
