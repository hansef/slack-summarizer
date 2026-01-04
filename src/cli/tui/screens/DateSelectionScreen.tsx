/**
 * Date selection screen with quick presets and calendar mode
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { Select, TextInput } from '@inkjs/ui';
import { DateTime } from 'luxon';
import { parseTimespan, type DateRange } from '../../../utils/dates.js';
import { getEnv } from '../../../utils/env.js';

interface DateSelectionScreenProps {
  onSelect: (dateRange: DateRange) => void;
  onSettings: () => void;
  onQuit: () => void;
}

type Mode = 'presets' | 'calendar' | 'custom';

interface PresetOption {
  label: string;
  value: string;
}

const PRESET_OPTIONS: PresetOption[] = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Last 7 Days', value: 'last-week' },
  { label: 'This Week (Mon-Today)', value: 'this-week' },
  { label: 'Last Week (Mon-Sun)', value: 'previous-week' },
  { label: 'Custom Date Range...', value: 'custom' },
  { label: 'Calendar View...', value: 'calendar' },
];

function getThisWeekRange(): DateRange {
  const tz = getEnv().SLACK_SUMMARIZER_TIMEZONE;
  const now = DateTime.now().setZone(tz);
  const monday = now.startOf('week');
  return {
    start: monday.startOf('day'),
    end: now.endOf('day'),
  };
}

function getPreviousWeekRange(): DateRange {
  const tz = getEnv().SLACK_SUMMARIZER_TIMEZONE;
  const now = DateTime.now().setZone(tz);
  const lastMonday = now.startOf('week').minus({ weeks: 1 });
  const lastSunday = lastMonday.plus({ days: 6 });
  return {
    start: lastMonday.startOf('day'),
    end: lastSunday.endOf('day'),
  };
}

export function DateSelectionScreen({
  onSelect,
  onSettings,
  onQuit,
}: DateSelectionScreenProps): React.ReactElement {
  const [mode, setMode] = useState<Mode>('presets');
  const [customError, setCustomError] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => DateTime.now());
  const [calendarDay, setCalendarDay] = useState<number>(() => DateTime.now().day);
  const [calendarSelecting, setCalendarSelecting] = useState(false);
  const [calendarStartDate, setCalendarStartDate] = useState<DateTime | null>(null);

  useInput((input, key) => {
    if (input === 'q' && mode === 'presets') {
      onQuit();
    }
    if (input === 's' && mode === 'presets') {
      onSettings();
    }
    if (key.escape) {
      if (mode !== 'presets') {
        setMode('presets');
        setCustomError(null);
      }
    }
  });

  const handlePresetSelect = useCallback(
    (value: string) => {
      if (value === 'custom') {
        setMode('custom');
        return;
      }
      if (value === 'calendar') {
        setMode('calendar');
        return;
      }
      if (value === 'this-week') {
        onSelect(getThisWeekRange());
        return;
      }
      if (value === 'previous-week') {
        onSelect(getPreviousWeekRange());
        return;
      }

      try {
        const dateRange = parseTimespan(value);
        onSelect(dateRange);
      } catch {
        // Should not happen with preset values
      }
    },
    [onSelect]
  );

  const handleCustomSubmit = useCallback(
    (value: string) => {
      try {
        const dateRange = parseTimespan(value);
        onSelect(dateRange);
      } catch (err) {
        setCustomError(err instanceof Error ? err.message : 'Invalid date format');
      }
    },
    [onSelect]
  );

  const handleCalendarSelect = useCallback(() => {
    const tz = getEnv().SLACK_SUMMARIZER_TIMEZONE;
    const selectedDate = calendarMonth.set({ day: calendarDay }).setZone(tz);

    if (!calendarSelecting) {
      // First click - start selecting range
      setCalendarStartDate(selectedDate);
      setCalendarSelecting(true);
    } else {
      // Second click - end range
      const startDate = calendarStartDate!;
      const endDate = selectedDate;

      // Ensure start is before end
      const [rangeStart, rangeEnd] =
        startDate <= endDate ? [startDate, endDate] : [endDate, startDate];

      onSelect({
        start: rangeStart.startOf('day'),
        end: rangeEnd.endOf('day'),
      });
    }
  }, [calendarMonth, calendarDay, calendarSelecting, calendarStartDate, onSelect]);

  // Calendar navigation
  useInput(
    (input, key) => {
      if (mode !== 'calendar') return;

      const daysInMonth = calendarMonth.daysInMonth || 30;

      if (key.leftArrow) {
        setCalendarDay((d) => Math.max(1, d - 1));
      } else if (key.rightArrow) {
        setCalendarDay((d) => Math.min(daysInMonth, d + 1));
      } else if (key.upArrow) {
        setCalendarDay((d) => Math.max(1, d - 7));
      } else if (key.downArrow) {
        setCalendarDay((d) => Math.min(daysInMonth, d + 7));
      } else if (input === '[' || input === 'h') {
        // Previous month
        const newMonth = calendarMonth.minus({ months: 1 });
        setCalendarMonth(newMonth);
        setCalendarDay(Math.min(calendarDay, newMonth.daysInMonth || 30));
      } else if (input === ']' || input === 'l') {
        // Next month
        const newMonth = calendarMonth.plus({ months: 1 });
        setCalendarMonth(newMonth);
        setCalendarDay(Math.min(calendarDay, newMonth.daysInMonth || 30));
      } else if (key.return) {
        handleCalendarSelect();
      }
    },
    { isActive: mode === 'calendar' }
  );

  if (mode === 'custom') {
    return (
      <Box flexDirection="column">
        <Text>Enter date or date range:</Text>
        <Text dimColor>
          Format: YYYY-MM-DD or YYYY-MM-DD..YYYY-MM-DD
        </Text>
        <Box marginTop={1}>
          <TextInput
            placeholder="e.g., 2026-01-01 or 2026-01-01..2026-01-07"
            onSubmit={handleCustomSubmit}
          />
        </Box>
        {customError && (
          <Box marginTop={1}>
            <Text color="red">{customError}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>Press Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  if (mode === 'calendar') {
    const daysInMonth = calendarMonth.daysInMonth || 30;
    const firstDayOfWeek = calendarMonth.startOf('month').weekday; // 1 = Monday
    const weeks: (number | null)[][] = [];
    let currentWeek: (number | null)[] = Array(firstDayOfWeek - 1).fill(null);

    for (let day = 1; day <= daysInMonth; day++) {
      currentWeek.push(day);
      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    }
    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) {
        currentWeek.push(null);
      }
      weeks.push(currentWeek);
    }

    return (
      <Box flexDirection="column">
        <Box justifyContent="space-between" marginBottom={1}>
          <Text color="cyan">[</Text>
          <Text bold>{calendarMonth.toFormat('MMMM yyyy')}</Text>
          <Text color="cyan">]</Text>
        </Box>
        <Text dimColor>Mo Tu We Th Fr Sa Su</Text>
        {weeks.map((week, weekIndex) => (
          <Box key={weekIndex}>
            {week.map((day, dayIndex) => {
              if (day === null) {
                return (
                  <Box key={dayIndex} width={3}>
                    <Text> </Text>
                  </Box>
                );
              }
              const isSelected = day === calendarDay;
              const isRangeStart =
                calendarStartDate &&
                calendarMonth.year === calendarStartDate.year &&
                calendarMonth.month === calendarStartDate.month &&
                day === calendarStartDate.day;
              const isInRange =
                calendarSelecting &&
                calendarStartDate &&
                calendarMonth.year === calendarStartDate.year &&
                calendarMonth.month === calendarStartDate.month &&
                ((day >= calendarStartDate.day && day <= calendarDay) ||
                  (day <= calendarStartDate.day && day >= calendarDay));

              return (
                <Box key={dayIndex} width={3}>
                  <Text
                    backgroundColor={isSelected ? 'cyan' : isInRange ? 'blue' : undefined}
                    color={isSelected ? 'black' : isRangeStart ? 'green' : undefined}
                    bold={isSelected || !!isRangeStart}
                  >
                    {day.toString().padStart(2, ' ')}
                  </Text>
                </Box>
              );
            })}
          </Box>
        ))}
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>
            Arrow keys: navigate │ Enter: {calendarSelecting ? 'end range' : 'start range'} │ [ ]: month │ Esc: back
          </Text>
          {calendarSelecting && calendarStartDate && (
            <Text color="green">
              Range start: {calendarStartDate.toFormat('MMM d, yyyy')}
            </Text>
          )}
        </Box>
      </Box>
    );
  }

  // Preset mode
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text>Select a time period to summarize:</Text>
      </Box>
      <Select
        options={PRESET_OPTIONS}
        onChange={handlePresetSelect}
      />
      <Box marginTop={1}>
        <Text dimColor>q quit │ s settings</Text>
      </Box>
    </Box>
  );
}
