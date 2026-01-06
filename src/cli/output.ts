/**
 * CLI output formatting utilities
 */

/* eslint-disable no-console */

const isTTY = process.stdout.isTTY ?? false;

// ANSI color codes (only used when TTY is available)
const colors = {
  reset: isTTY ? '\x1b[0m' : '',
  bold: isTTY ? '\x1b[1m' : '',
  dim: isTTY ? '\x1b[2m' : '',
  red: isTTY ? '\x1b[31m' : '',
  green: isTTY ? '\x1b[32m' : '',
  yellow: isTTY ? '\x1b[33m' : '',
  blue: isTTY ? '\x1b[34m' : '',
  cyan: isTTY ? '\x1b[36m' : '',
};

function formatMessage(color: string, prefix: string, message: string): string {
  return `${color}${prefix}${colors.reset} ${message}`;
}

export const output = {
  /**
   * Print an info message
   */
  info(message: string): void {
    console.log(formatMessage(colors.blue, 'ℹ', message));
  },

  /**
   * Print a success message
   */
  success(message: string): void {
    console.log(formatMessage(colors.green, '✓', message));
  },

  /**
   * Print a warning message
   */
  warn(message: string): void {
    console.log(formatMessage(colors.yellow, '⚠', message));
  },

  /**
   * Print an error message with optional details
   */
  error(message: string, details?: string): void {
    console.error(formatMessage(colors.red, '✗', message));
    if (details) {
      console.error(`  ${colors.dim}${details}${colors.reset}`);
    }
  },

  /**
   * Print a progress indicator
   */
  progress(message: string): void {
    console.log(formatMessage(colors.cyan, '→', message));
  },

  /**
   * Print a section header
   */
  header(title: string): void {
    console.log(`\n${colors.bold}${title}${colors.reset}`);
  },

  /**
   * Print a horizontal divider
   */
  divider(): void {
    console.log(colors.dim + '─'.repeat(40) + colors.reset);
  },

  /**
   * Print a labeled statistic
   */
  stat(label: string, value: string | number): void {
    const labelWidth = 20;
    const paddedLabel = label.padEnd(labelWidth);
    console.log(`  ${colors.dim}${paddedLabel}${colors.reset} ${value}`);
  },

  /**
   * Print a channel summary line
   */
  channelSummary(name: string, activity: number, conversations: number): void {
    const channelDisplay = `#${name}`.padEnd(25);
    console.log(
      `  ${colors.cyan}${channelDisplay}${colors.reset} ` +
        `${activity} interactions, ${conversations} conversations`
    );
  },

  /**
   * Print raw text without formatting
   */
  raw(text: string): void {
    console.log(text);
  },

  /**
   * Print JSON data formatted with indentation
   */
  json(data: unknown): void {
    console.log(JSON.stringify(data, null, 2));
  },
};
