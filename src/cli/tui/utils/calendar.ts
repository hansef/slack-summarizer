/**
 * Calendar utility functions for TUI date picker
 *
 * Pure functions for calendar calculations, week number handling,
 * and date range operations.
 */

import { DateTime } from 'luxon';
import type { DateRange } from '../../../utils/dates.js';
import { getEnv } from '../../../utils/env.js';

/**
 * Represents a single day in the calendar grid
 */
export interface CalendarDay {
  day: number;
  date: DateTime;
  isToday: boolean;
  isWeekend: boolean;
}

/**
 * Represents a week row in the calendar
 */
export interface CalendarWeek {
  weekNumber: number;
  days: (CalendarDay | null)[];
}

/**
 * Represents a complete calendar grid for a month
 */
export interface CalendarGrid {
  month: DateTime;
  weeks: CalendarWeek[];
}

/**
 * Get the configured timezone
 */
function getTimezone(): string {
  return getEnv().SLACK_SUMMARIZER_TIMEZONE;
}

/**
 * Get the current date in the configured timezone
 */
function getToday(): DateTime {
  return DateTime.now().setZone(getTimezone());
}

/**
 * Check if two DateTimes represent the same day
 */
function isSameDay(a: DateTime, b: DateTime): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/**
 * Check if a date is a weekend (Saturday or Sunday)
 */
export function isWeekend(date: DateTime): boolean {
  return date.weekday === 6 || date.weekday === 7;
}

/**
 * Build a calendar grid for a single month
 */
export function buildCalendarGrid(month: DateTime): CalendarGrid {
  const today = getToday();
  const firstDayOfMonth = month.startOf('month');
  const daysInMonth = month.daysInMonth ?? 30;
  const firstDayWeekday = firstDayOfMonth.weekday; // 1 = Monday, 7 = Sunday

  const weeks: CalendarWeek[] = [];
  let currentWeek: (CalendarDay | null)[] = [];

  // Add null padding for days before the 1st
  for (let i = 1; i < firstDayWeekday; i++) {
    currentWeek.push(null);
  }

  // Add each day of the month
  for (let day = 1; day <= daysInMonth; day++) {
    const date = month.set({ day });
    const calendarDay: CalendarDay = {
      day,
      date,
      isToday: isSameDay(date, today),
      isWeekend: isWeekend(date),
    };

    currentWeek.push(calendarDay);

    // Week complete (7 days)
    if (currentWeek.length === 7) {
      const weekNumber = date.weekNumber;
      weeks.push({ weekNumber, days: currentWeek });
      currentWeek = [];
    }
  }

  // Handle last partial week
  if (currentWeek.length > 0) {
    // Get week number from the last actual day in the week
    const lastDay = month.set({ day: daysInMonth });
    const weekNumber = lastDay.weekNumber;

    // Pad to 7 days
    while (currentWeek.length < 7) {
      currentWeek.push(null);
    }
    weeks.push({ weekNumber, days: currentWeek });
  }

  return { month, weeks };
}

/**
 * Build two calendar grids for side-by-side display
 * Left month contains the cursor, right month is always next
 */
export function buildTwoMonthGrids(cursorMonth: DateTime): {
  left: CalendarGrid;
  right: CalendarGrid;
} {
  const leftMonth = cursorMonth.startOf('month');
  const rightMonth = leftMonth.plus({ months: 1 });

  return {
    left: buildCalendarGrid(leftMonth),
    right: buildCalendarGrid(rightMonth),
  };
}

/**
 * Get the Monday-Sunday date range for a given week number and year
 */
export function getWeekDateRange(year: number, weekNumber: number): DateRange {
  const tz = getTimezone();

  // Use Luxon's weekYear to handle ISO week edge cases
  const monday = DateTime.fromObject(
    { weekYear: year, weekNumber, weekday: 1 },
    { zone: tz }
  );

  const sunday = monday.plus({ days: 6 });

  return {
    start: monday.startOf('day'),
    end: sunday.endOf('day'),
  };
}

/**
 * Get the full month date range
 */
export function getMonthDateRange(month: DateTime): DateRange {
  return {
    start: month.startOf('month').startOf('day'),
    end: month.endOf('month').endOf('day'),
  };
}

/**
 * Check if a date is within a range (inclusive)
 */
export function isDateInRange(
  date: DateTime,
  rangeStart: DateTime | null,
  rangeEnd: DateTime | null
): boolean {
  if (!rangeStart) return false;

  // If only start is set, check if this IS the start
  if (!rangeEnd) {
    return isSameDay(date, rangeStart);
  }

  // Normalize range (ensure start <= end)
  const [start, end] =
    rangeStart <= rangeEnd ? [rangeStart, rangeEnd] : [rangeEnd, rangeStart];

  // Check if date is between start and end (inclusive)
  return date >= start.startOf('day') && date <= end.endOf('day');
}

/**
 * Normalize a date range so start <= end
 */
export function normalizeRange(start: DateTime, end: DateTime): DateRange {
  if (start <= end) {
    return {
      start: start.startOf('day'),
      end: end.endOf('day'),
    };
  }
  return {
    start: end.startOf('day'),
    end: start.endOf('day'),
  };
}

/**
 * Navigate cursor by a number of days, handling month boundaries
 *
 * Returns the new cursor position { month, day }
 */
export function navigateDays(
  month: DateTime,
  day: number,
  offset: number
): { month: DateTime; day: number } {
  const currentDate = month.set({ day });
  const newDate = currentDate.plus({ days: offset });

  return {
    month: newDate.startOf('month'),
    day: newDate.day,
  };
}

/**
 * Navigate to the previous or next month, clamping the day if necessary
 */
export function navigateMonth(
  currentMonth: DateTime,
  currentDay: number,
  direction: 'prev' | 'next'
): { month: DateTime; day: number } {
  const newMonth =
    direction === 'prev'
      ? currentMonth.minus({ months: 1 })
      : currentMonth.plus({ months: 1 });

  // Clamp day to valid range for new month
  const maxDay = newMonth.daysInMonth ?? 31;
  const newDay = Math.min(currentDay, maxDay);

  return {
    month: newMonth.startOf('month'),
    day: newDay,
  };
}

/**
 * Get the week number of a specific date
 */
export function getWeekNumber(date: DateTime): number {
  return date.weekNumber;
}

/**
 * Get the week year (ISO week year, may differ from calendar year)
 */
export function getWeekYear(date: DateTime): number {
  return date.weekYear;
}

/**
 * Check if a position (month + day) is within the visible two-month range
 */
export function isInVisibleRange(
  targetMonth: DateTime,
  leftMonth: DateTime
): boolean {
  const rightMonth = leftMonth.plus({ months: 1 });

  return (
    (targetMonth.year === leftMonth.year &&
      targetMonth.month === leftMonth.month) ||
    (targetMonth.year === rightMonth.year &&
      targetMonth.month === rightMonth.month)
  );
}
