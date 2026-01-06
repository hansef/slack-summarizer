/**
 * Tests for the LoadingScreen component.
 *
 * The LoadingScreen:
 * 1. Displays the date range being processed
 * 2. Shows progress stage and counts
 * 3. Shows current processing message
 */

import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { LoadingScreen } from '@/cli/tui/screens/LoadingScreen.js';
import { DateTime } from 'luxon';

describe('LoadingScreen', () => {
  const singleDayRange = {
    start: DateTime.fromISO('2024-01-15'),
    end: DateTime.fromISO('2024-01-15'),
  };

  const multiDayRange = {
    start: DateTime.fromISO('2024-01-01'),
    end: DateTime.fromISO('2024-01-07'),
  };

  it('should display single day date', () => {
    const { lastFrame } = render(<LoadingScreen dateRange={singleDayRange} progress={null} />);

    expect(lastFrame()).toContain('Jan 15, 2024');
  });

  it('should display date range for multiple days', () => {
    const { lastFrame } = render(<LoadingScreen dateRange={multiDayRange} progress={null} />);

    expect(lastFrame()).toContain('Jan 1, 2024');
    expect(lastFrame()).toContain('Jan 7, 2024');
  });

  it('should show Starting when no progress', () => {
    const { lastFrame } = render(<LoadingScreen dateRange={singleDayRange} progress={null} />);

    expect(lastFrame()).toContain('Starting');
  });

  it('should show fetching stage', () => {
    const { lastFrame } = render(
      <LoadingScreen
        dateRange={singleDayRange}
        progress={{ stage: 'fetching', message: 'Fetching Slack data' }}
      />
    );

    expect(lastFrame()).toContain('Fetching Slack data');
  });

  it('should show segmenting stage', () => {
    const { lastFrame } = render(
      <LoadingScreen
        dateRange={singleDayRange}
        progress={{ stage: 'segmenting', message: 'Processing' }}
      />
    );

    expect(lastFrame()).toContain('Segmenting');
  });

  it('should show summarizing stage with progress count', () => {
    const { lastFrame } = render(
      <LoadingScreen
        dateRange={singleDayRange}
        progress={{ stage: 'summarizing', message: '#general', current: 3, total: 10 }}
      />
    );

    expect(lastFrame()).toContain('Generating summaries');
    expect(lastFrame()).toContain('3/10');
  });

  it('should display channel name being processed', () => {
    const { lastFrame } = render(
      <LoadingScreen
        dateRange={singleDayRange}
        progress={{ stage: 'summarizing', message: '#engineering', current: 1, total: 5 }}
      />
    );

    expect(lastFrame()).toContain('#engineering');
  });

  it('should show complete stage', () => {
    const { lastFrame } = render(
      <LoadingScreen
        dateRange={singleDayRange}
        progress={{ stage: 'complete', message: 'Done' }}
      />
    );

    expect(lastFrame()).toContain('Complete');
  });

  it('should display wait message', () => {
    const { lastFrame } = render(<LoadingScreen dateRange={singleDayRange} progress={null} />);

    expect(lastFrame()).toContain('This may take a minute or two');
  });

  it('should show consolidating stage', () => {
    const { lastFrame } = render(
      <LoadingScreen
        dateRange={singleDayRange}
        progress={{ stage: 'consolidating', message: 'Consolidating' }}
      />
    );

    expect(lastFrame()).toContain('Consolidating');
  });

  it('should handle unknown stage gracefully', () => {
    const { lastFrame } = render(
      <LoadingScreen
        dateRange={singleDayRange}
        progress={{ stage: 'unknown' as any, message: 'Unknown operation' }}
      />
    );

    // Should fall back to showing the stage name
    expect(lastFrame()).toContain('unknown');
  });
});
