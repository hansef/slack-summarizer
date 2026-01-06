/**
 * Tests for concurrency control utilities.
 *
 * These tests verify that the limiter correctly:
 * 1. Restricts concurrent operations to the specified limit
 * 2. Queues excess operations and runs them as slots become available
 * 3. Preserves result order despite concurrent execution
 * 4. Properly propagates errors from async functions
 * 5. Maintains accurate activeCount and pendingCount
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createLimiter,
  mapWithConcurrency,
  batchProcess,
  getGlobalClaudeLimiter,
  resetGlobalClaudeLimiter,
  mapWithGlobalClaudeLimiter,
} from '@/utils/concurrency.js';

// Helper to create a delayed promise that tracks execution
function createDelayedTask<T>(value: T, delayMs: number, tracker?: { started: number[]; completed: number[] }, id?: number) {
  return async () => {
    if (tracker && id !== undefined) {
      tracker.started.push(id);
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
    if (tracker && id !== undefined) {
      tracker.completed.push(id);
    }
    return value;
  };
}

// Helper to create a task that we can control when it resolves
function createControllableTask<T>(value: T) {
  let resolveTask: (v: T) => void;
  let rejectTask: (e: Error) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolveTask = resolve;
    rejectTask = reject;
  });
  return {
    task: () => promise,
    resolve: () => resolveTask(value),
    reject: (e: Error) => rejectTask(e),
  };
}

describe('createLimiter', () => {
  describe('initialization', () => {
    it('should throw if concurrency is less than 1', () => {
      expect(() => createLimiter(0)).toThrow('Concurrency must be at least 1');
      expect(() => createLimiter(-1)).toThrow('Concurrency must be at least 1');
    });

    it('should accept concurrency of 1', () => {
      const limiter = createLimiter(1);
      expect(limiter.activeCount).toBe(0);
      expect(limiter.pendingCount).toBe(0);
    });

    it('should accept high concurrency values', () => {
      const limiter = createLimiter(100);
      expect(limiter.activeCount).toBe(0);
    });
  });

  describe('single operation', () => {
    it('should execute a single async function', async () => {
      const limiter = createLimiter(5);
      const result = await limiter(() => Promise.resolve('hello'));
      expect(result).toBe('hello');
    });

    it('should propagate errors from async function', async () => {
      const limiter = createLimiter(5);
      await expect(limiter(() => {
        return Promise.reject(new Error('test error'));
      })).rejects.toThrow('test error');
    });

    it('should update activeCount during execution', async () => {
      const limiter = createLimiter(5);
      const task = createControllableTask('done');

      const promise = limiter(task.task);
      // Give microtask queue time to process
      await new Promise(resolve => setImmediate(resolve));

      expect(limiter.activeCount).toBe(1);

      task.resolve();
      await promise;
      // Give finally() block time to run
      await new Promise(resolve => setImmediate(resolve));

      expect(limiter.activeCount).toBe(0);
    });
  });

  describe('concurrency limiting', () => {
    it('should limit concurrent executions to specified number', async () => {
      const limiter = createLimiter(2);
      const tasks = [
        createControllableTask(1),
        createControllableTask(2),
        createControllableTask(3),
      ];

      // Start all three tasks
      const promises = tasks.map(t => limiter(t.task));
      await new Promise(resolve => setImmediate(resolve));

      // Only 2 should be active, 1 should be pending
      expect(limiter.activeCount).toBe(2);
      expect(limiter.pendingCount).toBe(1);

      // Resolve first task
      tasks[0].resolve();
      await new Promise(resolve => setImmediate(resolve));

      // Now third task should be active
      expect(limiter.activeCount).toBe(2);
      expect(limiter.pendingCount).toBe(0);

      // Resolve remaining tasks
      tasks[1].resolve();
      tasks[2].resolve();
      await Promise.all(promises);
      // Give finally() blocks time to run
      await new Promise(resolve => setImmediate(resolve));

      expect(limiter.activeCount).toBe(0);
      expect(limiter.pendingCount).toBe(0);
    });

    it('should process queue in FIFO order', async () => {
      const limiter = createLimiter(1);
      const order: number[] = [];

      const task = (id: number) => () => {
        order.push(id);
        return Promise.resolve(id);
      };

      const promises = [
        limiter(task(1)),
        limiter(task(2)),
        limiter(task(3)),
      ];

      const results = await Promise.all(promises);

      expect(order).toEqual([1, 2, 3]);
      expect(results).toEqual([1, 2, 3]);
    });

    it('should handle rapid task completion', async () => {
      const limiter = createLimiter(2);
      const tracker = { started: [] as number[], completed: [] as number[] };

      const promises = Array.from({ length: 10 }, (_, i) =>
        limiter(createDelayedTask(i, 10, tracker, i))
      );

      const results = await Promise.all(promises);

      // All tasks should have completed
      expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(tracker.completed).toHaveLength(10);
    });
  });

  describe('error handling', () => {
    it('should continue processing after an error', async () => {
      const limiter = createLimiter(1);
      const results: (string | Error)[] = [];

      const promise1 = limiter(() => {
        return Promise.reject(new Error('first error'));
      }).catch(e => e as Error);

      const promise2 = limiter(() => Promise.resolve('success'));

      results.push(await promise1);
      results.push(await promise2);

      expect(results[0]).toBeInstanceOf(Error);
      expect((results[0] as Error).message).toBe('first error');
      expect(results[1]).toBe('success');
    });

    it('should decrement activeCount even after error', async () => {
      const limiter = createLimiter(2);
      const errorTask = createControllableTask<string>('');

      const promise = limiter(errorTask.task);
      await new Promise(resolve => setImmediate(resolve));

      expect(limiter.activeCount).toBe(1);

      errorTask.reject(new Error('test'));
      await promise.catch(() => {}); // Swallow error
      await new Promise(resolve => setImmediate(resolve));

      expect(limiter.activeCount).toBe(0);
    });
  });
});

describe('mapWithConcurrency', () => {
  it('should map over empty array', async () => {
    const result = await mapWithConcurrency([], (x: number) => Promise.resolve(x * 2), 5);
    expect(result).toEqual([]);
  });

  it('should process all items with correct results', async () => {
    const items = [1, 2, 3, 4, 5];
    const result = await mapWithConcurrency(items, (x) => Promise.resolve(x * 2), 3);
    expect(result).toEqual([2, 4, 6, 8, 10]);
  });

  it('should preserve order despite concurrent execution', async () => {
    // Items with varying delays - without concurrency control, order would be scrambled
    const items = [
      { value: 1, delay: 30 },
      { value: 2, delay: 10 },
      { value: 3, delay: 20 },
    ];

    const result = await mapWithConcurrency(
      items,
      async (item) => {
        await new Promise(resolve => setTimeout(resolve, item.delay));
        return item.value;
      },
      3
    );

    // Results should be in original order
    expect(result).toEqual([1, 2, 3]);
  });

  it('should pass index to mapper function', async () => {
    const items = ['a', 'b', 'c'];
    const result = await mapWithConcurrency(
      items,
      (item, index) => Promise.resolve(`${item}-${index}`),
      2
    );
    expect(result).toEqual(['a-0', 'b-1', 'c-2']);
  });

  it('should respect concurrency limit', async () => {
    const items = [1, 2, 3, 4, 5];
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    await mapWithConcurrency(
      items,
      async (item) => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise(resolve => setTimeout(resolve, 20));
        currentConcurrent--;
        return item;
      },
      2
    );

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('should propagate errors', async () => {
    const items = [1, 2, 3];
    await expect(
      mapWithConcurrency(items, (x) => {
        if (x === 2) return Promise.reject(new Error('error on 2'));
        return Promise.resolve(x);
      }, 5)
    ).rejects.toThrow('error on 2');
  });
});

describe('batchProcess', () => {
  it('should process empty array', async () => {
    const result = await batchProcess([], (x: unknown) => Promise.resolve(x), 5);
    expect(result).toEqual([]);
  });

  it('should process items in batches', async () => {
    const items = [1, 2, 3, 4, 5];
    const batchOrder: number[][] = [];
    let currentBatch: number[] = [];

    const result = await batchProcess(
      items,
      async (item) => {
        currentBatch.push(item);
        await new Promise(resolve => setTimeout(resolve, 10));
        if (currentBatch.length === 2 || item === items[items.length - 1]) {
          batchOrder.push([...currentBatch]);
          currentBatch = [];
        }
        return item * 2;
      },
      2
    );

    expect(result).toEqual([2, 4, 6, 8, 10]);
  });

  it('should preserve order across batches', async () => {
    const items = [1, 2, 3, 4, 5, 6, 7];
    const result = await batchProcess(items, (x) => Promise.resolve(x * 10), 3);
    expect(result).toEqual([10, 20, 30, 40, 50, 60, 70]);
  });

  it('should pass correct index to function', async () => {
    const items = ['a', 'b', 'c', 'd'];
    const result = await batchProcess(
      items,
      (item, index) => Promise.resolve(`${item}:${index}`),
      2
    );
    expect(result).toEqual(['a:0', 'b:1', 'c:2', 'd:3']);
  });

  it('should handle batch size larger than array', async () => {
    const items = [1, 2, 3];
    const result = await batchProcess(items, (x) => Promise.resolve(x + 1), 10);
    expect(result).toEqual([2, 3, 4]);
  });

  it('should handle batch size of 1', async () => {
    const items = [1, 2, 3];
    const order: number[] = [];

    const result = await batchProcess(
      items,
      (x) => {
        order.push(x);
        return Promise.resolve(x * 2);
      },
      1
    );

    expect(result).toEqual([2, 4, 6]);
    expect(order).toEqual([1, 2, 3]); // Strictly sequential
  });

  it('should wait for batch to complete before starting next', async () => {
    const items = [1, 2, 3, 4];
    const timeline: string[] = [];

    await batchProcess(
      items,
      async (x) => {
        timeline.push(`start-${x}`);
        await new Promise(resolve => setTimeout(resolve, 10));
        timeline.push(`end-${x}`);
        return x;
      },
      2
    );

    // First batch (1, 2) should complete before second batch (3, 4) starts
    const endOf2 = timeline.indexOf('end-2');
    const startOf3 = timeline.indexOf('start-3');
    expect(endOf2).toBeLessThan(startOf3);
  });
});

describe('global Claude limiter', () => {
  beforeEach(() => {
    resetGlobalClaudeLimiter();
  });

  describe('getGlobalClaudeLimiter', () => {
    it('should create limiter on first call', () => {
      const limiter = getGlobalClaudeLimiter(5);
      expect(limiter).toBeDefined();
      expect(limiter.activeCount).toBe(0);
    });

    it('should return same instance on subsequent calls', () => {
      const limiter1 = getGlobalClaudeLimiter(5);
      const limiter2 = getGlobalClaudeLimiter(10); // Different concurrency, should still be same instance
      expect(limiter1).toBe(limiter2);
    });

    it('should use concurrency from first call', async () => {
      getGlobalClaudeLimiter(2);
      const limiter = getGlobalClaudeLimiter(10);

      // Create controllable tasks
      const tasks = [
        createControllableTask(1),
        createControllableTask(2),
        createControllableTask(3),
      ];

      for (const t of tasks) {
        void limiter(t.task);
      }
      await new Promise(resolve => setImmediate(resolve));

      // Should be limited to 2, not 10
      expect(limiter.activeCount).toBe(2);
      expect(limiter.pendingCount).toBe(1);

      for (const t of tasks) {
        t.resolve();
      }
    });
  });

  describe('resetGlobalClaudeLimiter', () => {
    it('should allow creating new limiter after reset', () => {
      const limiter1 = getGlobalClaudeLimiter(2);
      resetGlobalClaudeLimiter();
      const limiter2 = getGlobalClaudeLimiter(5);

      expect(limiter1).not.toBe(limiter2);
    });
  });

  describe('mapWithGlobalClaudeLimiter', () => {
    it('should process items using global limiter', async () => {
      const items = [1, 2, 3, 4, 5];
      const result = await mapWithGlobalClaudeLimiter(
        items,
        (x) => Promise.resolve(x * 2),
        3
      );
      expect(result).toEqual([2, 4, 6, 8, 10]);
    });

    it('should share limiter across multiple calls', async () => {
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const processItem = async (x: number) => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise(resolve => setTimeout(resolve, 20));
        currentConcurrent--;
        return x;
      };

      // Start two parallel mapWithGlobalClaudeLimiter calls
      const [result1, result2] = await Promise.all([
        mapWithGlobalClaudeLimiter([1, 2, 3], processItem, 2),
        mapWithGlobalClaudeLimiter([4, 5, 6], processItem, 2),
      ]);

      expect(result1).toEqual([1, 2, 3]);
      expect(result2).toEqual([4, 5, 6]);
      // Both calls share the limiter, so max concurrent should be 2
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it('should pass index to mapper function', async () => {
      const items = ['a', 'b', 'c'];
      const result = await mapWithGlobalClaudeLimiter(
        items,
        (item, index) => Promise.resolve(`${item}-${index}`),
        2
      );
      expect(result).toEqual(['a-0', 'b-1', 'c-2']);
    });
  });
});
