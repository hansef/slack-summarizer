/**
 * Pino-based logging system.
 *
 * Provides structured JSON logging with automatic pretty printing for TTY output.
 * Supports child loggers with bound context for component-specific logging.
 */

import pino, { type Logger as PinoLogger, type LoggerOptions } from 'pino';
import { createRequire } from 'module';
import { errorSerializer } from './serializers.js';

/**
 * Check if pino-pretty is available (it's a dev dependency).
 */
function isPinoPrettyAvailable(): boolean {
  try {
    const require = createRequire(import.meta.url);
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

export type Logger = PinoLogger;
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

// Module-level state
let rootLogger: PinoLogger | null = null;
let silentMode = false;
let configuredLevel: LogLevel = 'info';

/**
 * Lazily get the configured log level from environment.
 * This avoids circular dependencies with the config module.
 */
function getConfiguredLevel(): LogLevel {
  try {
    // Direct env var access to avoid circular dependency with config module
    const level = process.env.SLACK_SUMMARIZER_LOG_LEVEL;
    if (level && ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].includes(level)) {
      return level as LogLevel;
    }
  } catch {
    // Ignore errors during early initialization
  }
  return 'info';
}

/**
 * Create the Pino logger instance with appropriate configuration.
 */
function createPinoInstance(level: LogLevel): PinoLogger {
  const isTTY = process.stdout.isTTY ?? false;

  const baseConfig: LoggerOptions = {
    level: silentMode ? 'silent' : level,
    // Remove default fields we don't need
    base: undefined,
    // ISO timestamps
    timestamp: pino.stdTimeFunctions.isoTime,
    // Custom serializers
    serializers: {
      err: errorSerializer,
      error: errorSerializer,
    },
  };

  // Use pino-pretty for human-readable TTY output, but only if available
  // (it's a dev dependency, so not present in production)
  if (isTTY && isPinoPrettyAvailable()) {
    return pino({
      ...baseConfig,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  // JSON output for non-TTY or when pino-pretty is not available
  return pino(baseConfig);
}

/**
 * Get the root logger instance.
 * Creates it lazily on first access.
 */
export function getRootLogger(): PinoLogger {
  if (!rootLogger) {
    configuredLevel = getConfiguredLevel();
    rootLogger = createPinoInstance(configuredLevel);
  }
  return rootLogger;
}

/**
 * Create a child logger with bound context.
 *
 * Child loggers automatically include the bound context in all log entries,
 * making it easy to add component-specific context.
 *
 * @example
 * ```typescript
 * const logger = createLogger({ component: 'DataFetcher' });
 * logger.info({ channelId: 'C123' }, 'Fetching messages');
 * // Output: { component: 'DataFetcher', channelId: 'C123', msg: 'Fetching messages' }
 * ```
 */
export function createLogger(bindings: Record<string, unknown>): PinoLogger {
  return getRootLogger().child(bindings);
}

/**
 * Set silent mode on or off.
 * When silent, all log output is suppressed.
 *
 * @param silent - Whether to enable silent mode
 */
export function setSilent(silent: boolean): void {
  silentMode = silent;

  if (rootLogger) {
    rootLogger.level = silent ? 'silent' : configuredLevel;
  }
}

/**
 * Check if silent mode is enabled.
 */
export function isSilent(): boolean {
  return silentMode;
}

/**
 * Dynamically change the log level.
 *
 * @param level - The new log level
 */
export function setLevel(level: LogLevel): void {
  configuredLevel = level;

  if (rootLogger && !silentMode) {
    rootLogger.level = level;
  }
}

/**
 * Get the current log level.
 */
export function getLevel(): LogLevel {
  if (rootLogger) {
    return rootLogger.level as LogLevel;
  }
  return configuredLevel;
}

/**
 * Reset the logger (for testing).
 * Forces recreation of the logger on next access.
 */
export function resetLogger(): void {
  rootLogger = null;
  silentMode = false;
  configuredLevel = 'info';
}
