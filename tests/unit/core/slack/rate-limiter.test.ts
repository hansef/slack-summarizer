import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimiter, resetRateLimiter } from '@/core/slack/rate-limiter.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    resetRateLimiter();
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetRateLimiter();
    vi.useRealTimers();
  });

  describe('execute', () => {
    it('should execute a function and return its result', async () => {
      const limiter = new RateLimiter({ requestsPerSecond: 10 });
      const result = await limiter.execute(() => Promise.resolve('test'));
      expect(result).toBe('test');
    });

    it('should respect rate limits between requests', async () => {
      const limiter = new RateLimiter({ requestsPerSecond: 1 });
      const results: number[] = [];
      const startTime = Date.now();

      // Queue multiple requests
      const p1 = limiter.execute(() => {
        results.push(Date.now() - startTime);
        return Promise.resolve(1);
      });
      const p2 = limiter.execute(() => {
        results.push(Date.now() - startTime);
        return Promise.resolve(2);
      });

      // First request should execute immediately
      await vi.advanceTimersByTimeAsync(0);

      // Second request should wait ~1000ms
      await vi.advanceTimersByTimeAsync(1000);

      await Promise.all([p1, p2]);

      expect(results.length).toBe(2);
      // Second request should be at least 1000ms after first
      expect(results[1] - results[0]).toBeGreaterThanOrEqual(1000);
    });

    it('should retry on retryable errors', async () => {
      const limiter = new RateLimiter({
        requestsPerSecond: 10,
        maxRetries: 2,
        initialBackoffMs: 100,
      });

      let attempts = 0;
      const result = await vi.waitFor(async () => {
        const promise = limiter.execute(() => {
          attempts++;
          if (attempts < 2) {
            return Promise.reject(new Error('ECONNRESET'));
          }
          return Promise.resolve('success');
        });

        // Advance timers to allow retry
        await vi.advanceTimersByTimeAsync(200);
        return promise;
      });

      expect(result).toBe('success');
      expect(attempts).toBe(2);
    });

    it('should fail after max retries exceeded', async () => {
      // Use real timers for this test to avoid async issues
      vi.useRealTimers();

      const limiter = new RateLimiter({
        requestsPerSecond: 100, // Fast for testing
        maxRetries: 2,
        initialBackoffMs: 10, // Short for testing
      });

      let attempts = 0;

      await expect(
        limiter.execute(() => {
          attempts++;
          return Promise.reject(new Error('ECONNRESET'));
        })
      ).rejects.toThrow('ECONNRESET');

      // Should have attempted 3 times (initial + 2 retries)
      expect(attempts).toBe(3);
    });

    it('should handle rate limit errors with retry-after', async () => {
      const limiter = new RateLimiter({ requestsPerSecond: 10 });

      let attempts = 0;
      const promise = limiter.execute(() => {
        attempts++;
        if (attempts === 1) {
          return Promise.reject(new Error('ratelimited'));
        }
        return Promise.resolve('success');
      });

      // Should wait 60 seconds (default retry-after for ratelimited)
      await vi.advanceTimersByTimeAsync(60000);

      const result = await promise;
      expect(result).toBe('success');
      expect(attempts).toBe(2);
    });
  });

  describe('queue management', () => {
    it('should report queue length', () => {
      const limiter = new RateLimiter({ requestsPerSecond: 0.1 }); // Very slow

      // Queue some requests but don't await them
      void limiter.execute(() => Promise.resolve(1));
      void limiter.execute(() => Promise.resolve(2));

      // First one starts processing immediately, so queue has 1 pending
      expect(limiter.getQueueLength()).toBeGreaterThanOrEqual(1);
    });

    it('should clear queue and reject pending requests', async () => {
      const limiter = new RateLimiter({ requestsPerSecond: 0.1 });

      const p1 = limiter.execute(() => Promise.resolve(1));
      const p2 = limiter.execute(() => Promise.resolve(2));

      limiter.clearQueue();

      await expect(p1).rejects.toThrow('Queue cleared');
      await expect(p2).rejects.toThrow('Queue cleared');
    });
  });
});
