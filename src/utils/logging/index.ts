/**
 * Logging module facade.
 *
 * This module provides a unified interface for all logging functionality:
 * - Structured logging via Pino
 * - Progress reporting for CLI batch mode
 * - Performance timing instrumentation
 *
 * @example
 * ```typescript
 * import { createLogger, createTimer, getProgressReporter } from '@/utils/logging';
 *
 * // Create a component-specific logger
 * const logger = createLogger({ component: 'MyComponent' });
 * logger.info({ key: 'value' }, 'Something happened');
 *
 * // Create a timer for performance tracking
 * const timer = createTimer(logger);
 * timer.start('operation');
 * await doWork();
 * timer.end('operation', { count: 10 });
 *
 * // Show progress in CLI batch mode
 * const progress = getProgressReporter();
 * progress.start();
 * progress.update('Processing', { progress: '50%' });
 * progress.stop();
 * ```
 */

// Core logging
export {
  getRootLogger,
  createLogger,
  setSilent,
  isSilent,
  setLevel,
  getLevel,
  resetLogger,
  type Logger,
  type LogLevel,
} from './logger.js';

// Progress reporting
export {
  ProgressReporter,
  getProgressReporter,
  resetProgressReporter,
  type ProgressMeta,
  type ProgressOptions,
} from './progress.js';

// Timing utilities
export { Timer, createTimer, type TimingOptions } from './timing.js';

// Serializers (for advanced use cases)
export { errorSerializer } from './serializers.js';

// Convenience: pre-configured root logger
// This allows `import { logger } from '@/utils/logging'` for simple cases
import { getRootLogger } from './logger.js';
export const logger = getRootLogger();
