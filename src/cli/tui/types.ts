/**
 * TUI type definitions
 */

import type { DateTime } from 'luxon';
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

/**
 * Calendar selection mode
 */
export type CalendarMode = 'day' | 'week' | 'month-header';

/**
 * Calendar state for enhanced date picker
 */
export interface CalendarState {
  /** Current selection mode */
  mode: CalendarMode;
  /** The month containing the cursor (left side in two-month view) */
  cursorMonth: DateTime;
  /** Day of month where cursor is (1-31) */
  cursorDay: number;
  /** Which month the cursor is actually in ('left' or 'right' for two-month view) */
  cursorSide: 'left' | 'right';
  /** Currently highlighted week number (when in week mode) */
  cursorWeekIndex: number;
  /** True when selecting a range (first date already picked) */
  selecting: boolean;
  /** Start of range selection */
  rangeStart: DateTime | null;
}
