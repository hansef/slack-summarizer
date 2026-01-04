import { logger } from '../../utils/logger.js';
import { getEnv } from '../../utils/env.js';

interface RateLimiterConfig {
  requestsPerSecond: number;
  maxRetries: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
}

interface QueuedRequest<T> {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  retries: number;
}

export class RateLimiter {
  private config: RateLimiterConfig;
  private queue: QueuedRequest<unknown>[] = [];
  private processing = false;
  private lastRequestTime = 0;
  private consecutiveFailures = 0;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = {
      requestsPerSecond: config.requestsPerSecond ?? getEnv().SLACK_SUMMARIZER_RATE_LIMIT,
      maxRetries: config.maxRetries ?? 5,
      initialBackoffMs: config.initialBackoffMs ?? 1000,
      maxBackoffMs: config.maxBackoffMs ?? 60000,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        execute: fn,
        resolve: resolve as (value: unknown) => void,
        reject,
        retries: 0,
      });
      void this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const request = this.queue[0];

      // Wait for rate limit window
      const now = Date.now();
      const minInterval = 1000 / this.config.requestsPerSecond;
      const timeSinceLastRequest = now - this.lastRequestTime;

      if (timeSinceLastRequest < minInterval) {
        const waitTime = minInterval - timeSinceLastRequest;
        await this.sleep(waitTime);
      }

      try {
        this.lastRequestTime = Date.now();
        const result = await request.execute();
        this.consecutiveFailures = 0;
        this.queue.shift();
        request.resolve(result);
      } catch (error) {
        const handled = await this.handleError(error, request);
        if (!handled) {
          this.queue.shift();
          request.reject(error as Error);
        }
      }
    }

    this.processing = false;
  }

  private async handleError<T>(error: unknown, request: QueuedRequest<T>): Promise<boolean> {
    // Check if it's a rate limit error with Retry-After header
    const retryAfter = this.extractRetryAfter(error);

    if (retryAfter !== null) {
      logger.warn('Rate limited by Slack API', { retryAfterSeconds: retryAfter });
      await this.sleep(retryAfter * 1000);
      return true; // Keep in queue, will retry
    }

    // Check if we should retry on other errors
    if (request.retries < this.config.maxRetries && this.isRetryableError(error)) {
      request.retries++;
      this.consecutiveFailures++;

      const backoff = Math.min(
        this.config.initialBackoffMs * Math.pow(2, this.consecutiveFailures - 1),
        this.config.maxBackoffMs
      );

      logger.warn('Retrying request after error', {
        attempt: request.retries,
        backoffMs: backoff,
        error: error instanceof Error ? error.message : String(error),
      });

      await this.sleep(backoff);
      return true; // Keep in queue, will retry
    }

    return false; // Don't retry, reject the request
  }

  private extractRetryAfter(error: unknown): number | null {
    // Check for Slack SDK error format
    if (
      error &&
      typeof error === 'object' &&
      'data' in error &&
      error.data &&
      typeof error.data === 'object'
    ) {
      const data = error.data as Record<string, unknown>;
      if (data.error === 'ratelimited') {
        // Slack's Retry-After is typically in the headers
        // The SDK may expose it differently
        if ('headers' in error && error.headers && typeof error.headers === 'object') {
          const headers = error.headers as Record<string, string>;
          const retryAfter = headers['retry-after'];
          if (retryAfter) {
            return parseInt(retryAfter, 10);
          }
        }
        // Default to 60 seconds if no Retry-After header
        return 60;
      }
    }

    // Check for direct error message
    if (error instanceof Error && error.message.includes('ratelimited')) {
      return 60;
    }

    return null;
  }

  private isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    // Retry on network errors
    if (error.message.includes('ECONNRESET') || error.message.includes('ETIMEDOUT')) {
      return true;
    }

    // Retry on server errors (5xx)
    if (error.message.includes('500') || error.message.includes('502') || error.message.includes('503')) {
      return true;
    }

    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  clearQueue(): void {
    const pending = this.queue.splice(0);
    for (const request of pending) {
      request.reject(new Error('Queue cleared'));
    }
  }
}

// Singleton instance for the application
let globalRateLimiter: RateLimiter | null = null;

export function getRateLimiter(config?: Partial<RateLimiterConfig>): RateLimiter {
  if (!globalRateLimiter) {
    globalRateLimiter = new RateLimiter(config);
  }
  return globalRateLimiter;
}

export function resetRateLimiter(): void {
  if (globalRateLimiter) {
    globalRateLimiter.clearQueue();
  }
  globalRateLimiter = null;
}
