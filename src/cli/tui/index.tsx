/**
 * TUI entry point
 */

import { render } from 'ink';
import { App } from './App.js';
import { logger } from '@/utils/logger.js';

/**
 * Launch the TUI application
 */
export function launchTUI(): void {
  // Suppress all log output in TUI mode - the TUI handles its own display
  logger.setSilent(true);

  render(<App />);
}
