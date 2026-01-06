/**
 * Performance timing utilities for instrumentation.
 *
 * Works with any Pino logger instance to log timing information.
 */

import type pino from 'pino';

export interface TimingOptions {
  /**
   * The logger to use for timing output.
   */
  logger: pino.Logger;

  /**
   * The log level for timing messages (default: 'debug').
   */
  level?: 'trace' | 'debug' | 'info';

  /**
   * Whether to automatically log when timing ends (default: true).
   */
  autoLog?: boolean;
}

/**
 * Timer for measuring and logging performance of operations.
 *
 * Example:
 * ```typescript
 * const timer = new Timer({ logger });
 * timer.start('fetchData');
 * await fetchData();
 * timer.end('fetchData', { count: 100 });
 * // Logs: [PERF] fetchData { durationMs: 1234, count: 100 }
 * ```
 */
export class Timer {
  private logger: pino.Logger;
  private level: 'trace' | 'debug' | 'info';
  private autoLog: boolean;
  private timings = new Map<string, number>();

  constructor(options: TimingOptions) {
    this.logger = options.logger;
    this.level = options.level ?? 'debug';
    this.autoLog = options.autoLog ?? true;
  }

  /**
   * Start a timer with the given label.
   */
  start(label: string): void {
    this.timings.set(label, performance.now());
  }

  /**
   * End a timer and log the duration.
   *
   * @param label - The timer label (must match a previous start() call)
   * @param meta - Additional metadata to include in the log
   */
  end(label: string, meta?: Record<string, unknown>): void {
    const startTime = this.timings.get(label);

    if (startTime === undefined) {
      this.logger.warn({ label }, `Timer '${label}' was never started`);
      return;
    }

    const duration = performance.now() - startTime;
    this.timings.delete(label);

    if (this.autoLog) {
      const durationMs = Math.round(duration);
      const durationSec = (duration / 1000).toFixed(2);

      this.logger[this.level](
        {
          ...meta,
          durationMs,
          durationSec: `${durationSec}s`,
        },
        `[PERF] ${label}`
      );
    }
  }

  /**
   * Execute an async function with automatic timing.
   *
   * @param label - The timer label for logging
   * @param fn - The async function to execute
   * @param meta - Additional metadata to include in the log
   * @returns The result of the function
   */
  async timed<T>(
    label: string,
    fn: () => Promise<T>,
    meta?: Record<string, unknown>
  ): Promise<T> {
    const startTime = performance.now();

    try {
      return await fn();
    } finally {
      const duration = performance.now() - startTime;

      if (this.autoLog) {
        const durationMs = Math.round(duration);
        const durationSec = (duration / 1000).toFixed(2);

        this.logger[this.level](
          {
            ...meta,
            durationMs,
            durationSec: `${durationSec}s`,
          },
          `[PERF] ${label}`
        );
      }
    }
  }

  /**
   * Get the raw duration of a timer without logging.
   * Useful for conditional timing logic.
   *
   * @param label - The timer label
   * @returns The duration in milliseconds, or undefined if timer wasn't started
   */
  measure(label: string): number | undefined {
    const startTime = this.timings.get(label);

    if (startTime === undefined) {
      return undefined;
    }

    return performance.now() - startTime;
  }
}

/**
 * Create a timer bound to a specific logger.
 *
 * @param logger - The Pino logger instance
 * @param level - The log level for timing messages (default: 'debug')
 */
export function createTimer(
  logger: pino.Logger,
  level: 'trace' | 'debug' | 'info' = 'debug'
): Timer {
  return new Timer({ logger, level });
}
