/**
 * TUI entry point
 */

import { render } from 'ink';
import { App } from './App.js';
import { setSilent } from '@/utils/logging/index.js';

/**
 * Launch the TUI application
 */
export function launchTUI(): void {
  // Suppress all log output in TUI mode - the TUI handles its own display
  setSilent(true);

  render(<App />);
}
