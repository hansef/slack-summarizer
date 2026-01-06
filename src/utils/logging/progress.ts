/**
 * Progress reporter for single-line updating status display.
 *
 * This is separate from the main logging system because progress reporting
 * has fundamentally different semantics (overwriting the same line) and
 * shouldn't interfere with structured JSON logs.
 */

export interface ProgressMeta {
  progress?: string | number;
  count?: number;
  name?: string;
  channelName?: string;
}

export interface ProgressOptions {
  showSpinner?: boolean;
  maxWidth?: number;
}

/**
 * Progress reporter that writes single-line updating status to stderr.
 * Used in CLI batch mode to show progress without cluttering the output.
 */
export class ProgressReporter {
  private active = false;
  private lastMessage = '';
  private options: Required<ProgressOptions>;

  constructor(options: ProgressOptions = {}) {
    this.options = {
      showSpinner: options.showSpinner ?? true,
      maxWidth: options.maxWidth ?? (process.stderr.columns || 80) - 4,
    };
  }

  /**
   * Start progress mode. Must be called before update().
   */
  start(): void {
    this.active = true;
    this.lastMessage = '';
  }

  /**
   * Update the progress status with a new message.
   * The line is overwritten each time this is called.
   *
   * @param message - The status message
   * @param meta - Optional metadata for formatting
   */
  update(message: string, meta?: ProgressMeta): void {
    if (!this.active) return;

    let status = message;

    if (meta) {
      // Format progress info based on what's available
      if (meta.progress !== undefined) {
        status += ` (${String(meta.progress)})`;
      } else if (meta.count !== undefined) {
        status += ` [${meta.count}]`;
      }

      // Append name/channel if provided
      if (meta.name) {
        status += `: ${meta.name}`;
      } else if (meta.channelName) {
        status += `: ${meta.channelName}`;
      }
    }

    // Truncate to max width
    if (status.length > this.options.maxWidth) {
      status = status.slice(0, this.options.maxWidth - 3) + '...';
    }

    const spinner = this.options.showSpinner ? '\u23f3 ' : '';
    process.stderr.write(`\r\x1b[K${spinner}${status}`);
    this.lastMessage = status;
  }

  /**
   * Stop progress mode and optionally clear the line.
   *
   * @param clearLine - Whether to clear the progress line (default: true)
   */
  stop(clearLine = true): void {
    if (this.active && clearLine && this.lastMessage) {
      process.stderr.write('\r\x1b[K');
    }
    this.active = false;
    this.lastMessage = '';
  }

  /**
   * Check if progress mode is currently active.
   */
  isActive(): boolean {
    return this.active;
  }
}

// Singleton instance for convenience
let singletonReporter: ProgressReporter | null = null;

/**
 * Get the singleton progress reporter.
 * Creates one if it doesn't exist.
 */
export function getProgressReporter(): ProgressReporter {
  if (!singletonReporter) {
    singletonReporter = new ProgressReporter();
  }
  return singletonReporter;
}

/**
 * Reset the singleton reporter (for testing).
 */
export function resetProgressReporter(): void {
  if (singletonReporter) {
    singletonReporter.stop(false);
  }
  singletonReporter = null;
}
