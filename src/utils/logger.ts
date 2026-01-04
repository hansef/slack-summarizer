import { getEnv, type LogLevel } from './env.js';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

// Progress mode state
let progressMode = false;
let lastProgressMessage = '';

function shouldLog(level: LogLevel): boolean {
  const configuredLevel = getEnv().SLACK_SUMMARIZER_LOG_LEVEL;
  return LOG_LEVELS[level] >= LOG_LEVELS[configuredLevel];
}

function formatLog(entry: LogEntry, pretty: boolean): string {
  if (pretty) {
    const contextStr = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
    const levelColors: Record<LogLevel, string> = {
      debug: '\x1b[90m', // gray
      info: '\x1b[36m', // cyan
      warn: '\x1b[33m', // yellow
      error: '\x1b[31m', // red
    };
    const reset = '\x1b[0m';
    const color = levelColors[entry.level];
    return `${color}[${entry.timestamp}] ${entry.level.toUpperCase()}${reset}: ${entry.message}${contextStr}`;
  }
  return JSON.stringify(entry);
}

function formatProgressMessage(message: string, context?: Record<string, unknown>): string {
  let status = message;
  if (context) {
    // Extract useful progress info from context
    if (typeof context.progress === 'string' || typeof context.progress === 'number') {
      status += ` (${String(context.progress)})`;
    } else if (typeof context.count === 'number') {
      status += ` [${context.count}]`;
    } else if (typeof context.channelName === 'string') {
      status += `: ${context.channelName}`;
    }
  }
  // Truncate to terminal width (leave room for spinner)
  const maxWidth = (process.stderr.columns || 80) - 4;
  if (status.length > maxWidth) {
    status = status.slice(0, maxWidth - 3) + '...';
  }
  return status;
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (!shouldLog(level)) {
    return;
  }

  // Progress mode: single-line updating status on stderr
  if (progressMode && level !== 'error') {
    const status = formatProgressMessage(message, context);
    // Clear line and write new status
    process.stderr.write(`\r\x1b[K⏳ ${status}`);
    lastProgressMessage = status;
    return;
  }

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context && { context }),
  };

  // Use pretty printing for development (when stdout is a TTY)
  const pretty = process.stdout.isTTY ?? false;
  const output = formatLog(entry, pretty);

  if (level === 'error') {
    console.error(output);
  } else {
    // eslint-disable-next-line no-console
    console.log(output);
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => log('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => log('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => log('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => log('error', message, context),

  /** Enable progress mode for single-line updating status */
  enableProgressMode: () => {
    progressMode = true;
    lastProgressMessage = '';
  },

  /** Disable progress mode and clear the progress line */
  disableProgressMode: () => {
    if (progressMode && lastProgressMessage) {
      // Clear the progress line
      process.stderr.write('\r\x1b[K');
    }
    progressMode = false;
    lastProgressMessage = '';
  },

  /** Check if progress mode is enabled */
  isProgressMode: () => progressMode,
};

export type Logger = typeof logger;
