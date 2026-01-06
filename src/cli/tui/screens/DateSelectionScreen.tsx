/**
 * Date selection screen with quick presets and enhanced calendar mode
 *
 * Features:
 * - Two-month side-by-side view
 * - Week numbers with week selection
 * - Month header selection
 * - Cross-month range selection
 * - Today indicator, weekend coloring
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { Select } from '@inkjs/ui';
import { DateTime } from 'luxon';
import { parseTimespan, type DateRange } from '@/utils/dates.js';
import { getEnv } from '@/utils/env.js';
import type { CalendarState } from '../types.js';
import {
  buildTwoMonthGrids,
  getWeekDateRange,
  getMonthDateRange,
  isDateInRange,
  normalizeRange,
  navigateMonth,
  getWeekYear,
  type CalendarGrid,
  type CalendarWeek,
  type CalendarDay,
} from '../utils/calendar.js';

interface DateSelectionScreenProps {
  onSelect: (dateRange: DateRange) => void;
  onSettings: () => void;
  onQuit: () => void;
}

type Mode = 'presets' | 'calendar';

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
  { label: 'Calendar View...', value: 'calendar' },
];

function getTimezone(): string {
  try {
    return getEnv().SLACK_SUMMARIZER_TIMEZONE;
  } catch {
    return 'America/Los_Angeles';
  }
}

function getThisWeekRange(): DateRange {
  const tz = getTimezone();
  const now = DateTime.now().setZone(tz);
  const monday = now.startOf('week');
  return {
    start: monday.startOf('day'),
    end: now.endOf('day'),
  };
}

function getPreviousWeekRange(): DateRange {
  const tz = getTimezone();
  const now = DateTime.now().setZone(tz);
  const lastMonday = now.startOf('week').minus({ weeks: 1 });
  const lastSunday = lastMonday.plus({ days: 6 });
  return {
    start: lastMonday.startOf('day'),
    end: lastSunday.endOf('day'),
  };
}

/**
 * Initialize calendar state
 */
function createInitialCalendarState(): CalendarState {
  const tz = getTimezone();
  const now = DateTime.now().setZone(tz);
  return {
    mode: 'day',
    cursorMonth: now.startOf('month'),
    cursorDay: now.day,
    cursorSide: 'left',
    cursorWeekIndex: 0,
    selecting: false,
    rangeStart: null,
  };
}

export function DateSelectionScreen({
  onSelect,
  onSettings,
  onQuit,
}: DateSelectionScreenProps): React.ReactElement {
  const [mode, setMode] = useState<Mode>('presets');
  const [calendar, setCalendar] = useState<CalendarState>(
    createInitialCalendarState
  );

  // Build the two-month calendar grids
  const { left: leftGrid, right: rightGrid } = useMemo(
    () => buildTwoMonthGrids(calendar.cursorMonth),
    [calendar.cursorMonth]
  );

  // Get current cursor date
  const getCursorDate = useCallback((): DateTime => {
    const month =
      calendar.cursorSide === 'left'
        ? calendar.cursorMonth
        : calendar.cursorMonth.plus({ months: 1 });
    return month.set({ day: calendar.cursorDay });
  }, [calendar.cursorMonth, calendar.cursorDay, calendar.cursorSide]);

  // Handle escape and global keys
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
        setCalendar(createInitialCalendarState());
      }
    }
  });

  const handlePresetSelect = useCallback(
    (value: string) => {
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

  // Handle day selection (range start/end)
  const handleDaySelect = useCallback(() => {
    const selectedDate = getCursorDate();

    if (!calendar.selecting) {
      // Start range selection
      setCalendar((prev) => ({
        ...prev,
        selecting: true,
        rangeStart: selectedDate,
      }));
    } else {
      // Complete range selection
      const range = normalizeRange(calendar.rangeStart!, selectedDate);
      onSelect(range);
    }
  }, [calendar.selecting, calendar.rangeStart, getCursorDate, onSelect]);

  // Handle week selection
  const handleWeekSelect = useCallback(() => {
    const cursorDate = getCursorDate();
    const weekYear = getWeekYear(cursorDate);
    const weekNumber = cursorDate.weekNumber;
    const range = getWeekDateRange(weekYear, weekNumber);
    onSelect(range);
  }, [getCursorDate, onSelect]);

  // Handle month selection
  const handleMonthSelect = useCallback(() => {
    const month =
      calendar.cursorSide === 'left'
        ? calendar.cursorMonth
        : calendar.cursorMonth.plus({ months: 1 });
    const range = getMonthDateRange(month);
    onSelect(range);
  }, [calendar.cursorMonth, calendar.cursorSide, onSelect]);

  // Calendar navigation
  useInput(
    (input, key) => {
      if (mode !== 'calendar') return;

      const currentGrid =
        calendar.cursorSide === 'left' ? leftGrid : rightGrid;
      const daysInCurrentMonth =
        calendar.cursorSide === 'left'
          ? calendar.cursorMonth.daysInMonth ?? 31
          : calendar.cursorMonth.plus({ months: 1 }).daysInMonth ?? 31;

      // Mode switching
      if (input === 'w') {
        setCalendar((prev) => ({
          ...prev,
          mode: prev.mode === 'week' ? 'day' : 'week',
          cursorWeekIndex: 0,
        }));
        return;
      }

      if (input === 'm') {
        setCalendar((prev) => ({
          ...prev,
          mode: prev.mode === 'month-header' ? 'day' : 'month-header',
        }));
        return;
      }

      // Handle Enter based on current mode
      if (key.return) {
        if (calendar.mode === 'week') {
          handleWeekSelect();
        } else if (calendar.mode === 'month-header') {
          handleMonthSelect();
        } else {
          handleDaySelect();
        }
        return;
      }

      // Navigation based on mode
      if (calendar.mode === 'week') {
        // Week mode: up/down to navigate weeks
        if (key.upArrow) {
          if (calendar.cursorWeekIndex > 0) {
            // Move up within current month
            setCalendar((prev) => ({
              ...prev,
              cursorWeekIndex: prev.cursorWeekIndex - 1,
            }));
          } else if (calendar.cursorSide === 'right') {
            // At top of right month, move to bottom of left month
            setCalendar((prev) => ({
              ...prev,
              cursorSide: 'left',
              cursorWeekIndex: leftGrid.weeks.length - 1,
            }));
          } else {
            // At top of left month, shift view back
            setCalendar((prev) => ({
              ...prev,
              cursorMonth: prev.cursorMonth.minus({ months: 1 }),
              cursorWeekIndex: 0, // Stay at top after shift
            }));
          }
        } else if (key.downArrow) {
          if (calendar.cursorWeekIndex < currentGrid.weeks.length - 1) {
            // Move down within current month
            setCalendar((prev) => ({
              ...prev,
              cursorWeekIndex: prev.cursorWeekIndex + 1,
            }));
          } else if (calendar.cursorSide === 'left') {
            // At bottom of left month, move to top of right month
            setCalendar((prev) => ({
              ...prev,
              cursorSide: 'right',
              cursorWeekIndex: 0,
            }));
          } else {
            // At bottom of right month, shift view forward
            setCalendar((prev) => ({
              ...prev,
              cursorMonth: prev.cursorMonth.plus({ months: 1 }),
              cursorSide: 'left',
              cursorWeekIndex: leftGrid.weeks.length - 1, // Go to bottom of new left month
            }));
          }
        } else if (key.leftArrow) {
          if (calendar.cursorSide === 'right') {
            // Move from right to left month
            setCalendar((prev) => ({
              ...prev,
              cursorSide: 'left',
              cursorWeekIndex: Math.min(prev.cursorWeekIndex, leftGrid.weeks.length - 1),
            }));
          } else {
            // On left month, shift view back
            setCalendar((prev) => ({
              ...prev,
              cursorMonth: prev.cursorMonth.minus({ months: 1 }),
              cursorWeekIndex: Math.min(prev.cursorWeekIndex, leftGrid.weeks.length - 1),
            }));
          }
        } else if (key.rightArrow) {
          if (calendar.cursorSide === 'left') {
            // Move from left to right month
            setCalendar((prev) => ({
              ...prev,
              cursorSide: 'right',
              cursorWeekIndex: Math.min(prev.cursorWeekIndex, rightGrid.weeks.length - 1),
            }));
          } else {
            // On right month, shift view forward
            setCalendar((prev) => ({
              ...prev,
              cursorMonth: prev.cursorMonth.plus({ months: 1 }),
              cursorSide: 'left',
              cursorWeekIndex: Math.min(prev.cursorWeekIndex, rightGrid.weeks.length - 1),
            }));
          }
        }
        return;
      }

      if (calendar.mode === 'month-header') {
        // Month header mode: left/right to navigate months
        if (key.leftArrow) {
          if (calendar.cursorSide === 'right') {
            // Move from right to left month
            setCalendar((prev) => ({
              ...prev,
              cursorSide: 'left',
            }));
          } else {
            // On left month, shift view back
            setCalendar((prev) => ({
              ...prev,
              cursorMonth: prev.cursorMonth.minus({ months: 1 }),
            }));
          }
        } else if (key.rightArrow) {
          if (calendar.cursorSide === 'left') {
            // Move from left to right month
            setCalendar((prev) => ({
              ...prev,
              cursorSide: 'right',
            }));
          } else {
            // On right month, shift view forward
            setCalendar((prev) => ({
              ...prev,
              cursorMonth: prev.cursorMonth.plus({ months: 1 }),
              cursorSide: 'left',
            }));
          }
        }
        return;
      }

      // Day mode navigation
      if (key.leftArrow) {
        if (calendar.cursorDay === 1) {
          if (calendar.cursorSide === 'right') {
            // Move from right month first day to left month last day
            const leftDays = calendar.cursorMonth.daysInMonth ?? 31;
            setCalendar((prev) => ({
              ...prev,
              cursorSide: 'left',
              cursorDay: leftDays,
            }));
          } else {
            // Move to previous month (shift entire view)
            const newMonth = calendar.cursorMonth.minus({ months: 1 });
            const newDays = newMonth.daysInMonth ?? 31;
            setCalendar((prev) => ({
              ...prev,
              cursorMonth: newMonth,
              cursorDay: newDays,
              cursorSide: 'left',
            }));
          }
        } else {
          setCalendar((prev) => ({
            ...prev,
            cursorDay: prev.cursorDay - 1,
          }));
        }
      } else if (key.rightArrow) {
        if (calendar.cursorDay === daysInCurrentMonth) {
          if (calendar.cursorSide === 'left') {
            // Move from left month last day to right month first day
            setCalendar((prev) => ({
              ...prev,
              cursorSide: 'right',
              cursorDay: 1,
            }));
          } else {
            // Move to next month (shift entire view)
            const newMonth = calendar.cursorMonth.plus({ months: 1 });
            setCalendar((prev) => ({
              ...prev,
              cursorMonth: newMonth,
              cursorDay: 1,
              cursorSide: 'left',
            }));
          }
        } else {
          setCalendar((prev) => ({
            ...prev,
            cursorDay: prev.cursorDay + 1,
          }));
        }
      } else if (key.upArrow) {
        const currentDate = getCursorDate();
        const newDate = currentDate.minus({ days: 7 });

        // Check if we need to switch months (using hasSame to compare year+month)
        if (
          calendar.cursorSide === 'left' &&
          !newDate.hasSame(calendar.cursorMonth, 'month')
        ) {
          // Shift entire view back
          setCalendar((prev) => ({
            ...prev,
            cursorMonth: prev.cursorMonth.minus({ months: 1 }),
            cursorDay: newDate.day,
            cursorSide: 'left',
          }));
        } else if (
          calendar.cursorSide === 'right' &&
          newDate.hasSame(calendar.cursorMonth, 'month')
        ) {
          // Move from right to left month
          setCalendar((prev) => ({
            ...prev,
            cursorSide: 'left',
            cursorDay: newDate.day,
          }));
        } else {
          setCalendar((prev) => ({
            ...prev,
            cursorDay: newDate.day,
          }));
        }
      } else if (key.downArrow) {
        const currentDate = getCursorDate();
        const newDate = currentDate.plus({ days: 7 });
        const rightMonth = calendar.cursorMonth.plus({ months: 1 });

        // Check if we need to switch months (using hasSame to compare year+month)
        if (
          calendar.cursorSide === 'right' &&
          !newDate.hasSame(rightMonth, 'month')
        ) {
          // Shift entire view forward
          setCalendar((prev) => ({
            ...prev,
            cursorMonth: prev.cursorMonth.plus({ months: 1 }),
            cursorDay: newDate.day,
            cursorSide: 'left',
          }));
        } else if (
          calendar.cursorSide === 'left' &&
          newDate.hasSame(rightMonth, 'month')
        ) {
          // Move from left to right month
          setCalendar((prev) => ({
            ...prev,
            cursorSide: 'right',
            cursorDay: newDate.day,
          }));
        } else {
          setCalendar((prev) => ({
            ...prev,
            cursorDay: newDate.day,
          }));
        }
      } else if (input === '[' || input === 'h') {
        // Manual previous month
        const nav = navigateMonth(calendar.cursorMonth, calendar.cursorDay, 'prev');
        setCalendar((prev) => ({
          ...prev,
          cursorMonth: nav.month,
          cursorDay: nav.day,
          cursorSide: 'left',
        }));
      } else if (input === ']' || input === 'l') {
        // Manual next month
        const nav = navigateMonth(calendar.cursorMonth, calendar.cursorDay, 'next');
        setCalendar((prev) => ({
          ...prev,
          cursorMonth: nav.month,
          cursorDay: nav.day,
          cursorSide: 'left',
        }));
      }
    },
    { isActive: mode === 'calendar' }
  );

  // Render calendar mode
  if (mode === 'calendar') {
    return (
      <Box flexDirection="column">
        {/* Two-month header */}
        <Box flexDirection="row" marginBottom={1}>
          <Box width={27}>
            <Text
              bold={calendar.mode === 'month-header' && calendar.cursorSide === 'left'}
              inverse={calendar.mode === 'month-header' && calendar.cursorSide === 'left'}
              color={calendar.cursorSide === 'left' ? 'cyan' : undefined}
            >
              {'<'} {leftGrid.month.toFormat('MMMM yyyy')}
            </Text>
          </Box>
          <Box width={2} />
          <Box width={27}>
            <Text
              bold={calendar.mode === 'month-header' && calendar.cursorSide === 'right'}
              inverse={calendar.mode === 'month-header' && calendar.cursorSide === 'right'}
              color={calendar.cursorSide === 'right' ? 'cyan' : undefined}
            >
              {rightGrid.month.toFormat('MMMM yyyy')} {'>'}
            </Text>
          </Box>
        </Box>

        {/* Column headers */}
        <Box flexDirection="row">
          <Box width={27}>
            <Text dimColor>Wk  Mo Tu We Th Fr </Text>
            <Text color="gray">Sa Su</Text>
          </Box>
          <Box width={2} />
          <Box width={27}>
            <Text dimColor>Wk  Mo Tu We Th Fr </Text>
            <Text color="gray">Sa Su</Text>
          </Box>
        </Box>

        {/* Calendar weeks */}
        {renderCalendarRows(
          leftGrid,
          rightGrid,
          calendar,
          getCursorDate()
        )}

        {/* Help text and status */}
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>
            {calendar.mode === 'day' && 'Arrows: nav │ Enter: select │ w: week mode │ m: month mode │ []: ±month'}
            {calendar.mode === 'week' && 'Up/Down: weeks │ Left/Right: month │ Enter: select week │ w: day mode'}
            {calendar.mode === 'month-header' && 'Left/Right: month │ Enter: select month │ m: day mode'}
          </Text>
          {calendar.selecting && calendar.rangeStart && (
            <Text color="green">
              Range start: {calendar.rangeStart.toFormat('MMM d, yyyy')}
            </Text>
          )}
          <Text dimColor>Press Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  // Preset mode (default)
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text>Select a time period to summarize:</Text>
      </Box>
      <Select options={PRESET_OPTIONS} onChange={handlePresetSelect} />
      <Box marginTop={1}>
        <Text dimColor>q quit │ s settings</Text>
      </Box>
    </Box>
  );
}

/**
 * Render both calendar grids side by side
 */
function renderCalendarRows(
  leftGrid: CalendarGrid,
  rightGrid: CalendarGrid,
  calendar: CalendarState,
  cursorDate: DateTime
): React.ReactElement[] {
  const maxWeeks = Math.max(leftGrid.weeks.length, rightGrid.weeks.length);
  const rows: React.ReactElement[] = [];

  for (let weekIndex = 0; weekIndex < maxWeeks; weekIndex++) {
    const leftWeek = leftGrid.weeks[weekIndex];
    const rightWeek = rightGrid.weeks[weekIndex];

    rows.push(
      <Box key={weekIndex} flexDirection="row">
        {/* Left month week */}
        <Box width={27}>
          {leftWeek ? (
            renderWeekRow(
              leftWeek,
              calendar,
              cursorDate,
              'left',
              weekIndex
            )
          ) : (
            <Text> </Text>
          )}
        </Box>
        <Box width={2} />
        {/* Right month week */}
        <Box width={27}>
          {rightWeek ? (
            renderWeekRow(
              rightWeek,
              calendar,
              cursorDate,
              'right',
              weekIndex
            )
          ) : (
            <Text> </Text>
          )}
        </Box>
      </Box>
    );
  }

  return rows;
}

/**
 * Render a single week row with week number and days
 */
function renderWeekRow(
  week: CalendarWeek,
  calendar: CalendarState,
  cursorDate: DateTime,
  side: 'left' | 'right',
  weekIndex: number
): React.ReactElement {
  const isWeekMode = calendar.mode === 'week';
  const isWeekSelected =
    isWeekMode && calendar.cursorSide === side && calendar.cursorWeekIndex === weekIndex;

  return (
    <Box>
      {/* Week number */}
      <Text
        color={isWeekSelected ? 'green' : 'yellow'}
        bold={isWeekSelected}
        inverse={isWeekSelected}
      >
        {week.weekNumber.toString().padStart(2, ' ')}
      </Text>
      <Text>  </Text>

      {/* Days */}
      {week.days.map((day, dayIndex) => (
        <React.Fragment key={dayIndex}>
          {renderDayCell(day, calendar, cursorDate, side)}
        </React.Fragment>
      ))}
    </Box>
  );
}

/**
 * Render a single day cell
 */
function renderDayCell(
  day: CalendarDay | null,
  calendar: CalendarState,
  cursorDate: DateTime,
  side: 'left' | 'right'
): React.ReactElement {
  if (!day) {
    return <Text>   </Text>;
  }

  const isCursor =
    calendar.mode === 'day' &&
    calendar.cursorSide === side &&
    calendar.cursorDay === day.day;

  const isRangeStart =
    calendar.rangeStart &&
    calendar.rangeStart.year === day.date.year &&
    calendar.rangeStart.month === day.date.month &&
    calendar.rangeStart.day === day.day;

  const isInRange =
    calendar.selecting &&
    calendar.rangeStart &&
    isDateInRange(day.date, calendar.rangeStart, cursorDate);

  // Determine background color (priority: cursor > range start > in range)
  let backgroundColor: string | undefined;
  if (isCursor) {
    backgroundColor = 'cyan';
  } else if (isRangeStart) {
    backgroundColor = 'green';
  } else if (isInRange) {
    backgroundColor = 'blue';
  }

  // Determine text color
  let textColor: string | undefined;
  if (isCursor) {
    textColor = 'black';
  } else if (day.isToday) {
    textColor = 'yellow';
  } else if (day.isWeekend) {
    textColor = 'gray';
  }

  return (
    <Text
      backgroundColor={backgroundColor}
      color={textColor}
      bold={isCursor || day.isToday || !!isRangeStart}
      dimColor={day.isWeekend && !isCursor && !isInRange}
    >
      {day.day.toString().padStart(2, ' ')}
      {' '}
    </Text>
  );
}
