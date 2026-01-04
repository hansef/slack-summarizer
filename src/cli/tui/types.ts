/**
 * TUI type definitions
 */

import type { SummaryOutput } from '../../core/models/summary.js';
import type { DateRange } from '../../utils/dates.js';

export type Screen =
  | 'setup'
  | 'date-selection'
  | 'loading'
  | 'summary'
  | 'settings'
  | 'error';

export interface AppState {
  screen: Screen;
  dateRange: DateRange | null;
  summary: SummaryOutput | null;
  error: Error | null;
  savedFilePath: string | null;
}

export interface ProgressEvent {
  stage: 'fetching' | 'segmenting' | 'consolidating' | 'summarizing' | 'complete';
  message: string;
  current?: number;
  total?: number;
}

export type ProgressCallback = (event: ProgressEvent) => void;
