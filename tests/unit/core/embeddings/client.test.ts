import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmbeddingClient, resetEmbeddingClient } from '@/core/embeddings/client.js';

// Mock OpenAI
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      embeddings: {
        create: vi.fn().mockResolvedValue({
          data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
          usage: { total_tokens: 10 },
        }),
      },
    })),
  };
});

// Mock environment
vi.mock('@/utils/env.js', () => ({
  getEnv: vi.fn(() => ({
    OPENAI_API_KEY: 'sk-test-key',
  })),
}));

describe('EmbeddingClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEmbeddingClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetEmbeddingClient();
  });

  describe('constructor', () => {
    it('should throw if no API key is provided', async () => {
      // Override mock to return no API key
      const { getEnv } = await import('@/utils/env.js');
      vi.mocked(getEnv).mockReturnValueOnce({
        OPENAI_API_KEY: undefined,
      } as ReturnType<typeof getEnv>);

      expect(() => new EmbeddingClient()).toThrow('OPENAI_API_KEY is required');
    });

    it('should accept API key from config', () => {
      const client = new EmbeddingClient({ apiKey: 'sk-custom-key' });
      expect(client).toBeDefined();
    });
  });

  describe('cosineSimilarity', () => {
    it('should return 1.0 for identical vectors', () => {
      const client = new EmbeddingClient({ apiKey: 'sk-test' });
      const a = [1, 0, 0];
      const b = [1, 0, 0];
      expect(client.cosineSimilarity(a, b)).toBe(1);
    });

    it('should return 0 for orthogonal vectors', () => {
      const client = new EmbeddingClient({ apiKey: 'sk-test' });
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      expect(client.cosineSimilarity(a, b)).toBe(0);
    });

    it('should return -1 for opposite vectors', () => {
      const client = new EmbeddingClient({ apiKey: 'sk-test' });
      const a = [1, 0, 0];
      const b = [-1, 0, 0];
      expect(client.cosineSimilarity(a, b)).toBe(-1);
    });

    it('should throw for vectors of different dimensions', () => {
      const client = new EmbeddingClient({ apiKey: 'sk-test' });
      const a = [1, 0, 0];
      const b = [1, 0];
      expect(() => client.cosineSimilarity(a, b)).toThrow('dimension mismatch');
    });

    it('should handle zero vectors gracefully', () => {
      const client = new EmbeddingClient({ apiKey: 'sk-test' });
      const a = [0, 0, 0];
      const b = [1, 0, 0];
      expect(client.cosineSimilarity(a, b)).toBe(0);
    });
  });

  describe('getModel', () => {
    it('should return the default model', () => {
      const client = new EmbeddingClient({ apiKey: 'sk-test' });
      expect(client.getModel()).toBe('text-embedding-3-small');
    });

    it('should return custom model if provided', () => {
      const client = new EmbeddingClient({
        apiKey: 'sk-test',
        model: 'text-embedding-3-large',
      });
      expect(client.getModel()).toBe('text-embedding-3-large');
    });
  });
});
