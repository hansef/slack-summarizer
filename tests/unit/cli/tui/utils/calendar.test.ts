/**
 * Calendar utilities unit tests
 */

import { describe, it, expect, vi } from 'vitest';
import { DateTime } from 'luxon';

// Mock the env module before importing calendar utilities
vi.mock('../../../../../src/utils/env.js', () => ({
  getEnv: () => ({
    SLACK_SUMMARIZER_TIMEZONE: 'America/Los_Angeles',
    ANTHROPIC_API_KEY: 'test-key',
    SLACK_USER_TOKEN: 'test-token',
  }),
}));

import {
  buildCalendarGrid,
  buildTwoMonthGrids,
  getWeekDateRange,
  getMonthDateRange,
  isDateInRange,
  normalizeRange,
  navigateDays,
  navigateMonth,
  getWeekNumber,
  getWeekYear,
  isWeekend,
  isInVisibleRange,
} from '../../../../../src/cli/tui/utils/calendar.js';

describe('calendar utilities', () => {
  describe('isWeekend', () => {
    it('should return true for Saturday', () => {
      // January 4, 2025 is a Saturday
      const saturday = DateTime.fromISO('2025-01-04', { zone: 'UTC' });
      expect(isWeekend(saturday)).toBe(true);
    });

    it('should return true for Sunday', () => {
      // January 5, 2025 is a Sunday
      const sunday = DateTime.fromISO('2025-01-05', { zone: 'UTC' });
      expect(isWeekend(sunday)).toBe(true);
    });

    it('should return false for weekdays', () => {
      // January 6, 2025 is a Monday
      const monday = DateTime.fromISO('2025-01-06', { zone: 'UTC' });
      expect(isWeekend(monday)).toBe(false);

      // January 8, 2025 is a Wednesday
      const wednesday = DateTime.fromISO('2025-01-08', { zone: 'UTC' });
      expect(isWeekend(wednesday)).toBe(false);
    });
  });

  describe('buildCalendarGrid', () => {
    it('should build correct grid structure for January 2026', () => {
      // January 1, 2026 is a Thursday
      const jan2026 = DateTime.fromISO('2026-01-01', { zone: 'America/Los_Angeles' });
      const grid = buildCalendarGrid(jan2026);

      expect(grid.month.year).toBe(2026);
      expect(grid.month.month).toBe(1);
      expect(grid.weeks.length).toBeGreaterThanOrEqual(4);
      expect(grid.weeks.length).toBeLessThanOrEqual(6);

      // First week should have null padding for Mon-Wed
      const firstWeek = grid.weeks[0];
      expect(firstWeek.days[0]).toBeNull(); // Mon
      expect(firstWeek.days[1]).toBeNull(); // Tue
      expect(firstWeek.days[2]).toBeNull(); // Wed
      expect(firstWeek.days[3]?.day).toBe(1); // Thu = Jan 1
    });

    it('should mark weekends correctly', () => {
      const jan2026 = DateTime.fromISO('2026-01-01', { zone: 'America/Los_Angeles' });
      const grid = buildCalendarGrid(jan2026);

      // Find the first week with actual days
      const firstWeek = grid.weeks[0];
      // Days 5 and 6 in the array are Saturday and Sunday
      const saturday = firstWeek.days[5]; // Should be Jan 3
      const sunday = firstWeek.days[6]; // Should be Jan 4

      if (saturday) {
        expect(saturday.isWeekend).toBe(true);
      }
      if (sunday) {
        expect(sunday.isWeekend).toBe(true);
      }
    });

    it('should include week numbers', () => {
      const jan2026 = DateTime.fromISO('2026-01-01', { zone: 'America/Los_Angeles' });
      const grid = buildCalendarGrid(jan2026);

      // Each week should have a week number
      grid.weeks.forEach((week) => {
        expect(week.weekNumber).toBeGreaterThan(0);
        expect(week.weekNumber).toBeLessThanOrEqual(53);
      });
    });

    it('should handle months with different number of days', () => {
      // February 2024 is a leap year - 29 days
      const feb2024 = DateTime.fromISO('2024-02-01', { zone: 'America/Los_Angeles' });
      const grid = buildCalendarGrid(feb2024);

      // Count total days
      let totalDays = 0;
      grid.weeks.forEach((week) => {
        week.days.forEach((day) => {
          if (day !== null) {
            totalDays++;
          }
        });
      });

      expect(totalDays).toBe(29);
    });
  });

  describe('buildTwoMonthGrids', () => {
    it('should return left and right grids', () => {
      const jan2026 = DateTime.fromISO('2026-01-01', { zone: 'America/Los_Angeles' });
      const { left, right } = buildTwoMonthGrids(jan2026);

      expect(left.month.month).toBe(1); // January
      expect(right.month.month).toBe(2); // February
    });

    it('should handle year boundary', () => {
      const dec2025 = DateTime.fromISO('2025-12-01', { zone: 'America/Los_Angeles' });
      const { left, right } = buildTwoMonthGrids(dec2025);

      expect(left.month.month).toBe(12); // December
      expect(left.month.year).toBe(2025);
      expect(right.month.month).toBe(1); // January
      expect(right.month.year).toBe(2026);
    });
  });

  describe('getWeekDateRange', () => {
    it('should return Monday-Sunday range', () => {
      // Week 1 of 2026 starts on Dec 29, 2025 (Monday)
      const range = getWeekDateRange(2026, 1);

      expect(range.start.weekday).toBe(1); // Monday
      expect(range.end.weekday).toBe(7); // Sunday
    });

    it('should span 7 days', () => {
      const range = getWeekDateRange(2026, 5);
      const diff = range.end.diff(range.start, 'days').days;

      // Should be 6+ days (endOf('day') to startOf('day') = 6.999...)
      expect(diff).toBeGreaterThanOrEqual(6);
      expect(diff).toBeLessThan(8);
    });
  });

  describe('getMonthDateRange', () => {
    it('should return first to last day of month', () => {
      const jan2026 = DateTime.fromISO('2026-01-15', { zone: 'America/Los_Angeles' });
      const range = getMonthDateRange(jan2026);

      expect(range.start.day).toBe(1);
      expect(range.end.day).toBe(31);
      expect(range.start.month).toBe(1);
      expect(range.end.month).toBe(1);
    });

    it('should handle February correctly', () => {
      const feb2024 = DateTime.fromISO('2024-02-15', { zone: 'America/Los_Angeles' });
      const range = getMonthDateRange(feb2024);

      expect(range.start.day).toBe(1);
      expect(range.end.day).toBe(29); // Leap year
    });
  });

  describe('isDateInRange', () => {
    it('should return true for dates in range', () => {
      const start = DateTime.fromISO('2026-01-05', { zone: 'America/Los_Angeles' });
      const end = DateTime.fromISO('2026-01-10', { zone: 'America/Los_Angeles' });
      const middle = DateTime.fromISO('2026-01-07', { zone: 'America/Los_Angeles' });

      expect(isDateInRange(middle, start, end)).toBe(true);
    });

    it('should return true for range boundaries', () => {
      const start = DateTime.fromISO('2026-01-05', { zone: 'America/Los_Angeles' });
      const end = DateTime.fromISO('2026-01-10', { zone: 'America/Los_Angeles' });

      expect(isDateInRange(start, start, end)).toBe(true);
      expect(isDateInRange(end, start, end)).toBe(true);
    });

    it('should return false for dates outside range', () => {
      const start = DateTime.fromISO('2026-01-05', { zone: 'America/Los_Angeles' });
      const end = DateTime.fromISO('2026-01-10', { zone: 'America/Los_Angeles' });
      const before = DateTime.fromISO('2026-01-03', { zone: 'America/Los_Angeles' });
      const after = DateTime.fromISO('2026-01-15', { zone: 'America/Los_Angeles' });

      expect(isDateInRange(before, start, end)).toBe(false);
      expect(isDateInRange(after, start, end)).toBe(false);
    });

    it('should handle reversed range (end before start)', () => {
      const start = DateTime.fromISO('2026-01-10', { zone: 'America/Los_Angeles' });
      const end = DateTime.fromISO('2026-01-05', { zone: 'America/Los_Angeles' });
      const middle = DateTime.fromISO('2026-01-07', { zone: 'America/Los_Angeles' });

      expect(isDateInRange(middle, start, end)).toBe(true);
    });

    it('should handle null rangeStart', () => {
      const date = DateTime.fromISO('2026-01-07', { zone: 'America/Los_Angeles' });
      const end = DateTime.fromISO('2026-01-10', { zone: 'America/Los_Angeles' });

      expect(isDateInRange(date, null, end)).toBe(false);
    });

    it('should match single date when rangeEnd is null', () => {
      const start = DateTime.fromISO('2026-01-07', { zone: 'America/Los_Angeles' });
      const sameDate = DateTime.fromISO('2026-01-07', { zone: 'America/Los_Angeles' });
      const differentDate = DateTime.fromISO('2026-01-08', { zone: 'America/Los_Angeles' });

      expect(isDateInRange(sameDate, start, null)).toBe(true);
      expect(isDateInRange(differentDate, start, null)).toBe(false);
    });
  });

  describe('normalizeRange', () => {
    it('should keep range unchanged if start <= end', () => {
      const start = DateTime.fromISO('2026-01-05', { zone: 'America/Los_Angeles' });
      const end = DateTime.fromISO('2026-01-10', { zone: 'America/Los_Angeles' });

      const range = normalizeRange(start, end);

      expect(range.start.day).toBe(5);
      expect(range.end.day).toBe(10);
    });

    it('should swap dates if start > end', () => {
      const start = DateTime.fromISO('2026-01-10', { zone: 'America/Los_Angeles' });
      const end = DateTime.fromISO('2026-01-05', { zone: 'America/Los_Angeles' });

      const range = normalizeRange(start, end);

      expect(range.start.day).toBe(5);
      expect(range.end.day).toBe(10);
    });

    it('should set start to startOf(day) and end to endOf(day)', () => {
      const start = DateTime.fromISO('2026-01-05T14:30:00', { zone: 'America/Los_Angeles' });
      const end = DateTime.fromISO('2026-01-10T10:15:00', { zone: 'America/Los_Angeles' });

      const range = normalizeRange(start, end);

      expect(range.start.hour).toBe(0);
      expect(range.start.minute).toBe(0);
      expect(range.end.hour).toBe(23);
      expect(range.end.minute).toBe(59);
    });
  });

  describe('navigateDays', () => {
    it('should move forward within same month', () => {
      const month = DateTime.fromISO('2026-01-01', { zone: 'America/Los_Angeles' });
      const result = navigateDays(month, 10, 5);

      expect(result.month.month).toBe(1);
      expect(result.day).toBe(15);
    });

    it('should move backward within same month', () => {
      const month = DateTime.fromISO('2026-01-01', { zone: 'America/Los_Angeles' });
      const result = navigateDays(month, 15, -5);

      expect(result.month.month).toBe(1);
      expect(result.day).toBe(10);
    });

    it('should cross month boundary forward', () => {
      const month = DateTime.fromISO('2026-01-01', { zone: 'America/Los_Angeles' });
      const result = navigateDays(month, 30, 5);

      expect(result.month.month).toBe(2); // February
      expect(result.day).toBe(4);
    });

    it('should cross month boundary backward', () => {
      const month = DateTime.fromISO('2026-02-01', { zone: 'America/Los_Angeles' });
      const result = navigateDays(month, 3, -5);

      expect(result.month.month).toBe(1); // January
      expect(result.day).toBe(29);
    });
  });

  describe('navigateMonth', () => {
    it('should move to previous month', () => {
      const month = DateTime.fromISO('2026-02-01', { zone: 'America/Los_Angeles' });
      const result = navigateMonth(month, 15, 'prev');

      expect(result.month.month).toBe(1);
      expect(result.day).toBe(15);
    });

    it('should move to next month', () => {
      const month = DateTime.fromISO('2026-01-01', { zone: 'America/Los_Angeles' });
      const result = navigateMonth(month, 15, 'next');

      expect(result.month.month).toBe(2);
      expect(result.day).toBe(15);
    });

    it('should clamp day if new month has fewer days', () => {
      // Moving from January (31 days) to February (28 days in 2026)
      const month = DateTime.fromISO('2026-01-01', { zone: 'America/Los_Angeles' });
      const result = navigateMonth(month, 31, 'next');

      expect(result.month.month).toBe(2);
      expect(result.day).toBe(28); // Clamped to Feb 28
    });

    it('should handle year boundary', () => {
      const month = DateTime.fromISO('2026-01-01', { zone: 'America/Los_Angeles' });
      const result = navigateMonth(month, 15, 'prev');

      expect(result.month.year).toBe(2025);
      expect(result.month.month).toBe(12);
      expect(result.day).toBe(15);
    });
  });

  describe('getWeekNumber', () => {
    it('should return ISO week number', () => {
      // January 1, 2026 is in week 1
      const jan1 = DateTime.fromISO('2026-01-01', { zone: 'America/Los_Angeles' });
      expect(getWeekNumber(jan1)).toBe(1);
    });

    it('should handle week 53', () => {
      // December 31, 2020 is in week 53
      const dec31_2020 = DateTime.fromISO('2020-12-31', { zone: 'America/Los_Angeles' });
      expect(getWeekNumber(dec31_2020)).toBe(53);
    });
  });

  describe('getWeekYear', () => {
    it('should return week year (may differ from calendar year)', () => {
      // December 29, 2025 is in week 1 of 2026
      const dec29_2025 = DateTime.fromISO('2025-12-29', { zone: 'America/Los_Angeles' });
      expect(getWeekYear(dec29_2025)).toBe(2026);
    });
  });

  describe('isInVisibleRange', () => {
    it('should return true for left month', () => {
      const target = DateTime.fromISO('2026-01-15', { zone: 'America/Los_Angeles' });
      const left = DateTime.fromISO('2026-01-01', { zone: 'America/Los_Angeles' });

      expect(isInVisibleRange(target, left)).toBe(true);
    });

    it('should return true for right month', () => {
      const target = DateTime.fromISO('2026-02-15', { zone: 'America/Los_Angeles' });
      const left = DateTime.fromISO('2026-01-01', { zone: 'America/Los_Angeles' });

      expect(isInVisibleRange(target, left)).toBe(true);
    });

    it('should return false for months outside visible range', () => {
      const target = DateTime.fromISO('2026-03-15', { zone: 'America/Los_Angeles' });
      const left = DateTime.fromISO('2026-01-01', { zone: 'America/Los_Angeles' });

      expect(isInVisibleRange(target, left)).toBe(false);
    });
  });
});
