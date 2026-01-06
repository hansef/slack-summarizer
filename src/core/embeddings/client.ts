import OpenAI from 'openai';
import { getEnv } from '@/utils/env.js';
import { createLogger } from '@/utils/logging/index.js';

const logger = createLogger({ component: 'EmbeddingClient' });

const EMBEDDING_MODEL = 'text-embedding-3-small';
const MAX_TOKENS = 8000;
const CHARS_PER_TOKEN = 4; // Rough approximation

export interface EmbeddingClientConfig {
  apiKey?: string;
  model?: string;
}

export class EmbeddingClient {
  private client: OpenAI;
  private model: string;

  constructor(config: EmbeddingClientConfig = {}) {
    const env = getEnv();
    const apiKey = config.apiKey ?? env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for embeddings');
    }

    this.model = config.model ?? EMBEDDING_MODEL;
    this.client = new OpenAI({ apiKey });
  }

  /**
   * Generate an embedding for a single text
   */
  async embed(text: string): Promise<number[]> {
    const truncated = this.truncateText(text);

    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: truncated,
      });

      return response.data[0].embedding;
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error), textLength: text.length },
        'Embedding generation failed'
      );
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts in a single API call
   * OpenAI supports up to 2048 texts per batch
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const truncated = texts.map((t) => this.truncateText(t));

    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: truncated,
      });

      // Sort by index to ensure order matches input
      return response.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error), batchSize: texts.length },
        'Batch embedding generation failed'
      );
      throw error;
    }
  }

  /**
   * Calculate cosine similarity between two embedding vectors
   * Returns a value between -1 and 1 (1 = identical, 0 = orthogonal, -1 = opposite)
   */
  cosineSimilarity(a: number[], b: number[]): number {
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
   * Get the model name being used
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Truncate text to fit within token limits
   */
  private truncateText(text: string): string {
    const maxChars = MAX_TOKENS * CHARS_PER_TOKEN;
    if (text.length <= maxChars) {
      return text;
    }

    logger.debug(
      { originalLength: text.length, truncatedLength: maxChars },
      'Truncating text for embedding'
    );

    return text.substring(0, maxChars);
  }
}

// Singleton instance
let globalClient: EmbeddingClient | null = null;

export function getEmbeddingClient(config?: EmbeddingClientConfig): EmbeddingClient {
  if (!globalClient) {
    globalClient = new EmbeddingClient(config);
  }
  return globalClient;
}

export function resetEmbeddingClient(): void {
  globalClient = null;
}
