/**
 * Concurrency control utilities for parallel processing with limits.
 * Similar to p-limit but built-in to avoid external dependencies.
 */

export interface ConcurrencyLimiter {
  <T>(fn: () => Promise<T>): Promise<T>;
  readonly activeCount: number;
  readonly pendingCount: number;
}

/**
 * Creates a concurrency limiter that restricts the number of concurrent async operations.
 *
 * @param concurrency - Maximum number of concurrent operations (must be >= 1)
 * @returns A function that wraps async operations with concurrency control
 *
 * @example
 * ```ts
 * const limit = createLimiter(5);
 * const results = await Promise.all(items.map(item => limit(() => processItem(item))));
 * ```
 */
export function createLimiter(concurrency: number): ConcurrencyLimiter {
  if (concurrency < 1) {
    throw new Error('Concurrency must be at least 1');
  }

  let activeCount = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    if (queue.length > 0 && activeCount < concurrency) {
      const run = queue.shift()!;
      run();
    }
  };

  const limiter = <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        activeCount++;
        fn()
          .then((result) => {
            resolve(result);
          })
          .catch((error: unknown) => {
            reject(error);
          })
          .finally(() => {
            activeCount--;
            next();
          });
      };

      if (activeCount < concurrency) {
        run();
      } else {
        queue.push(run);
      }
    });
  };

  Object.defineProperty(limiter, 'activeCount', {
    get: () => activeCount,
  });

  Object.defineProperty(limiter, 'pendingCount', {
    get: () => queue.length,
  });

  return limiter as ConcurrencyLimiter;
}

/**
 * Maps over an array with controlled concurrency.
 *
 * @param items - Array of items to process
 * @param fn - Async function to apply to each item
 * @param concurrency - Maximum concurrent operations
 * @returns Promise resolving to array of results in original order
 *
 * @example
 * ```ts
 * const results = await mapWithConcurrency(urls, fetchUrl, 10);
 * ```
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const limit = createLimiter(concurrency);
  return Promise.all(items.map((item, index) => limit(() => fn(item, index))));
}

/**
 * Processes items in batches, running each batch concurrently.
 * Useful when you want to process N items at a time, waiting for all N to complete before the next batch.
 *
 * @param items - Array of items to process
 * @param fn - Async function to apply to each item
 * @param batchSize - Number of items per batch
 * @returns Promise resolving to array of results in original order
 */
export async function batchProcess<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  batchSize: number
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((item, batchIndex) => fn(item, i + batchIndex))
    );
    results.push(...batchResults);
  }

  return results;
}

/**
 * Global Claude API concurrency limiter.
 * This is a singleton that ensures we don't exceed the Claude concurrency limit
 * across all parallel operations (channels, batches, etc.).
 */
let globalClaudeLimiter: ConcurrencyLimiter | null = null;

/**
 * Gets or creates the global Claude API concurrency limiter.
 * The limiter is shared across all Claude API calls to prevent overwhelming the API.
 */
export function getGlobalClaudeLimiter(concurrency: number): ConcurrencyLimiter {
  if (!globalClaudeLimiter) {
    globalClaudeLimiter = createLimiter(concurrency);
  }
  return globalClaudeLimiter;
}

/**
 * Resets the global Claude limiter (for testing purposes)
 */
export function resetGlobalClaudeLimiter(): void {
  globalClaudeLimiter = null;
}

/**
 * Maps over an array using the global Claude concurrency limiter.
 * This ensures all Claude API calls across the application share the same concurrency limit.
 *
 * @param items - Array of items to process
 * @param fn - Async function to apply to each item
 * @param concurrency - Maximum concurrent operations (used to initialize the global limiter)
 * @returns Promise resolving to array of results in original order
 */
export async function mapWithGlobalClaudeLimiter<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const limiter = getGlobalClaudeLimiter(concurrency);
  return Promise.all(items.map((item, index) => limiter(() => fn(item, index))));
}
