/**
 * File save utilities for TUI
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DateRange } from '../../../utils/dates.js';

/**
 * Generate a date-based filename for the summary.
 * Single day: slack-summary-2026-01-04.md
 * Date range: slack-summary-2026-01-01_2026-01-07.md
 */
export function generateFilename(dateRange: DateRange): string {
  const startDate = dateRange.start.toFormat('yyyy-MM-dd');
  const endDate = dateRange.end.toFormat('yyyy-MM-dd');

  if (startDate === endDate) {
    return `slack-summary-${startDate}.md`;
  }

  return `slack-summary-${startDate}_${endDate}.md`;
}

/**
 * Save markdown content to a file with a date-based filename.
 * Returns the full path to the saved file.
 */
export function saveSummaryToFile(content: string, dateRange: DateRange): string {
  const filename = generateFilename(dateRange);
  const filepath = resolve(process.cwd(), filename);
  writeFileSync(filepath, content, 'utf-8');
  return filepath;
}

/**
 * Format a filepath for display (shorten home directory).
 */
export function formatPathForDisplay(filepath: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (home && filepath.startsWith(home)) {
    return filepath.replace(home, '~');
  }
  return filepath;
}
