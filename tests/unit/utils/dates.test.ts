import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DateTime } from 'luxon';
import {
  parseTimespan,
  toSlackTimestamp,
  fromSlackTimestamp,
  toSlackTimestampRange,
  formatISO,
  getDayBucket,
  isToday,
  getMinutesBetween,
  isValidTimezone,
  now,
} from '@/utils/dates.js';
import { resetEnvCache } from '@/utils/env.js';

describe('dates', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetEnvCache();
    process.env = { ...originalEnv };
    process.env.SLACK_USER_TOKEN = 'xoxp-test-token';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    process.env.SLACK_SUMMARIZER_TIMEZONE = 'America/Los_Angeles';
  });

  afterEach(() => {
    process.env = originalEnv;
    resetEnvCache();
  });

  describe('parseTimespan', () => {
    it('should parse "today" correctly', () => {
      const range = parseTimespan('today');

      expect(range.start.hour).toBe(0);
      expect(range.start.minute).toBe(0);
      expect(range.end.hour).toBe(23);
      expect(range.end.minute).toBe(59);
    });

    it('should parse "yesterday" correctly', () => {
      const range = parseTimespan('yesterday');
      const today = now();
      const yesterday = today.minus({ days: 1 });

      expect(range.start.day).toBe(yesterday.day);
      expect(range.start.month).toBe(yesterday.month);
    });

    it('should parse "last-week" correctly', () => {
      const range = parseTimespan('last-week');
      const today = now();

      expect(range.end.day).toBe(today.day);
      expect(range.start.day).toBe(today.minus({ weeks: 1 }).day);
    });

    it('should parse single date YYYY-MM-DD', () => {
      const range = parseTimespan('2024-06-15');

      expect(range.start.year).toBe(2024);
      expect(range.start.month).toBe(6);
      expect(range.start.day).toBe(15);
      expect(range.start.hour).toBe(0);
      expect(range.end.hour).toBe(23);
    });

    it('should parse date range YYYY-MM-DD..YYYY-MM-DD', () => {
      const range = parseTimespan('2024-06-10..2024-06-15');

      expect(range.start.year).toBe(2024);
      expect(range.start.month).toBe(6);
      expect(range.start.day).toBe(10);
      expect(range.end.day).toBe(15);
    });

    it('should throw on invalid timespan', () => {
      expect(() => parseTimespan('invalid')).toThrow('Invalid timespan');
    });

    it('should throw on invalid date range', () => {
      expect(() => parseTimespan('not-a-date..also-not')).toThrow('Invalid date range');
    });
  });

  describe('toSlackTimestamp', () => {
    it('should convert DateTime to Slack timestamp', () => {
      const dt = DateTime.fromMillis(1704067200000, { zone: 'UTC' }); // 2024-01-01 00:00:00 UTC
      const ts = toSlackTimestamp(dt);

      expect(ts).toBe('1704067200.000000');
    });
  });

  describe('fromSlackTimestamp', () => {
    it('should convert Slack timestamp to DateTime', () => {
      const dt = fromSlackTimestamp('1704067200.000000');

      expect(dt.toMillis()).toBe(1704067200000);
    });
  });

  describe('toSlackTimestampRange', () => {
    it('should convert DateRange to SlackTimestampRange', () => {
      const range = {
        start: DateTime.fromMillis(1704067200000, { zone: 'UTC' }),
        end: DateTime.fromMillis(1704153600000, { zone: 'UTC' }),
      };

      const slackRange = toSlackTimestampRange(range);

      expect(slackRange.oldest).toBe('1704067200.000000');
      expect(slackRange.latest).toBe('1704153600.000000');
    });
  });

  describe('getDayBucket', () => {
    it('should return YYYY-MM-DD format', () => {
      const dt = DateTime.fromISO('2024-06-15T14:30:00', { zone: 'America/Los_Angeles' });
      const bucket = getDayBucket(dt);

      expect(bucket).toBe('2024-06-15');
    });
  });

  describe('isToday', () => {
    it('should return true for today', () => {
      const today = now();
      expect(isToday(today)).toBe(true);
    });

    it('should return false for yesterday', () => {
      const yesterday = now().minus({ days: 1 });
      expect(isToday(yesterday)).toBe(false);
    });
  });

  describe('getMinutesBetween', () => {
    it('should calculate minutes between two DateTimes', () => {
      const dt1 = DateTime.fromISO('2024-06-15T14:00:00');
      const dt2 = DateTime.fromISO('2024-06-15T14:30:00');

      expect(getMinutesBetween(dt1, dt2)).toBe(30);
    });

    it('should return absolute value regardless of order', () => {
      const dt1 = DateTime.fromISO('2024-06-15T14:00:00');
      const dt2 = DateTime.fromISO('2024-06-15T14:30:00');

      expect(getMinutesBetween(dt2, dt1)).toBe(30);
    });
  });

  describe('isValidTimezone', () => {
    it('should return true for valid timezone', () => {
      expect(isValidTimezone('America/Los_Angeles')).toBe(true);
      expect(isValidTimezone('America/New_York')).toBe(true);
      expect(isValidTimezone('UTC')).toBe(true);
    });

    it('should return false for invalid timezone', () => {
      expect(isValidTimezone('Invalid/Timezone')).toBe(false);
      expect(isValidTimezone('Not_A_Zone')).toBe(false);
    });
  });

  describe('formatISO', () => {
    it('should return ISO 8601 formatted string', () => {
      const dt = DateTime.fromISO('2024-06-15T14:30:00', { zone: 'America/Los_Angeles' });
      const iso = formatISO(dt);

      expect(iso).toContain('2024-06-15');
      expect(iso).toContain('14:30:00');
    });
  });
});
