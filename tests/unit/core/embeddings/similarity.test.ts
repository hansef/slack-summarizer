import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Conversation } from '../../../../src/core/models/conversation.js';
import { SlackMessage } from '../../../../src/core/models/slack.js';
import {
  prepareConversationText,
  hashText,
  cosineSimilarity,
  calculateHybridSimilarity,
} from '../../../../src/core/embeddings/similarity.js';

// Mock the embedding client module (only needed for embed operations, not cosineSimilarity)
vi.mock('../../../../src/core/embeddings/client.js', () => ({
  getEmbeddingClient: vi.fn(() => ({
    embed: vi.fn(),
    embedBatch: vi.fn(),
    getModel: vi.fn(() => 'text-embedding-3-small'),
  })),
  resetEmbeddingClient: vi.fn(),
}));

// Mock the cache module
vi.mock('../../../../src/core/embeddings/cache.js', () => ({
  getCachedEmbedding: vi.fn(() => null),
  setCachedEmbedding: vi.fn(),
  getCachedEmbeddingsBatch: vi.fn(() => new Map()),
  setCachedEmbeddingsBatch: vi.fn(),
}));

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
    it('should return reference similarity when embeddings disabled', async () => {
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

      const similarity = await calculateHybridSimilarity(
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

    it('should return reference similarity when embeddings are null', async () => {
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

      const similarity = await calculateHybridSimilarity(
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

    it('should combine reference and embedding similarity with weights', async () => {
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

      const similarity = await calculateHybridSimilarity(conv1, conv2, refs1, refs2, emb1, emb2, {
        enableEmbeddings: true,
        referenceWeight: 0.6,
        embeddingWeight: 0.4,
      });

      // ref similarity = 0 (no shared refs)
      // emb similarity = 1.0, normalized = (1+1)/2 = 1.0
      // combined = 0.6 * 0 + 0.4 * 1.0 = 0.4
      expect(similarity).toBeCloseTo(0.4);
    });

    it('should return 0 for orthogonal embeddings (no baseline contribution)', async () => {
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

      const similarity = await calculateHybridSimilarity(conv1, conv2, refs1, refs2, emb1, emb2, {
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

    it('should return 0 for negative cosine similarity', async () => {
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

      const similarity = await calculateHybridSimilarity(conv1, conv2, refs1, refs2, emb1, emb2, {
        enableEmbeddings: true,
        referenceWeight: 0.6,
        embeddingWeight: 0.4,
      });

      // Negative cosine clamped to 0
      expect(similarity).toBe(0);
    });
  });
});
