import { DateTime, IANAZone } from 'luxon';
import { getEnv } from './env.js';

export interface DateRange {
  start: DateTime;
  end: DateTime;
}

export interface SlackTimestampRange {
  oldest: string;
  latest: string;
}

function getTimezone(): string {
  return getEnv().SLACK_SUMMARIZER_TIMEZONE;
}

export function parseTimespan(timespan: string): DateRange {
  const tz = getTimezone();
  const now = DateTime.now().setZone(tz);

  switch (timespan.toLowerCase()) {
    case 'today':
      return {
        start: now.startOf('day'),
        end: now.endOf('day'),
      };

    case 'yesterday': {
      const yesterday = now.minus({ days: 1 });
      return {
        start: yesterday.startOf('day'),
        end: yesterday.endOf('day'),
      };
    }

    case 'last-week':
    case 'lastweek':
    case 'last_week':
      return {
        start: now.minus({ weeks: 1 }).startOf('day'),
        end: now.endOf('day'),
      };

    default:
      // Try to parse as date range (YYYY-MM-DD..YYYY-MM-DD)
      if (timespan.includes('..')) {
        const [startStr, endStr] = timespan.split('..');
        const start = DateTime.fromISO(startStr, { zone: tz });
        const end = DateTime.fromISO(endStr, { zone: tz });

        if (!start.isValid || !end.isValid) {
          throw new Error(`Invalid date range: ${timespan}. Use format YYYY-MM-DD..YYYY-MM-DD`);
        }

        return {
          start: start.startOf('day'),
          end: end.endOf('day'),
        };
      }

      // Try to parse as single date (YYYY-MM-DD)
      {
        const singleDate = DateTime.fromISO(timespan, { zone: tz });
        if (!singleDate.isValid) {
          throw new Error(
            `Invalid timespan: ${timespan}. Use: today, yesterday, last-week, YYYY-MM-DD, or YYYY-MM-DD..YYYY-MM-DD`
          );
        }

        return {
          start: singleDate.startOf('day'),
          end: singleDate.endOf('day'),
        };
      }
  }
}

export function toSlackTimestamp(dt: DateTime): string {
  // Slack uses Unix timestamps as strings (seconds since epoch)
  return (dt.toMillis() / 1000).toFixed(6);
}

export function fromSlackTimestamp(ts: string): DateTime {
  const tz = getTimezone();
  const millis = parseFloat(ts) * 1000;
  return DateTime.fromMillis(millis, { zone: tz });
}

export function toSlackTimestampRange(range: DateRange): SlackTimestampRange {
  return {
    oldest: toSlackTimestamp(range.start),
    latest: toSlackTimestamp(range.end),
  };
}

export function formatForDisplay(dt: DateTime): string {
  return dt.toFormat('yyyy-MM-dd HH:mm:ss ZZZZ');
}

export function formatISO(dt: DateTime): string {
  return dt.toISO() ?? dt.toString();
}

export function getDayBucket(dt: DateTime): string {
  const tz = getTimezone();
  return dt.setZone(tz).toFormat('yyyy-MM-dd');
}

export function isToday(dt: DateTime): boolean {
  const tz = getTimezone();
  const now = DateTime.now().setZone(tz);
  return dt.setZone(tz).hasSame(now, 'day');
}

export function getMinutesBetween(dt1: DateTime, dt2: DateTime): number {
  const diff = dt2.diff(dt1, 'minutes');
  return Math.abs(diff.minutes);
}

export function isValidTimezone(tz: string): boolean {
  return IANAZone.isValidZone(tz);
}

export function now(): DateTime {
  const tz = getTimezone();
  return DateTime.now().setZone(tz);
}
