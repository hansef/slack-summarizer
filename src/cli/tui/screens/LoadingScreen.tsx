/**
 * Loading screen with progress display
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import type { SummaryProgress } from '../hooks/useSummary.js';
import type { DateRange } from '../../../utils/dates.js';

interface LoadingScreenProps {
  dateRange: DateRange;
  progress: SummaryProgress | null;
}

const STAGE_LABELS: Record<string, string> = {
  fetching: 'Fetching Slack data',
  segmenting: 'Segmenting conversations',
  consolidating: 'Consolidating topics',
  summarizing: 'Generating summaries',
  complete: 'Complete',
};

export function LoadingScreen({ dateRange, progress }: LoadingScreenProps): React.ReactElement {
  const startStr = dateRange.start.toFormat('MMM d, yyyy');
  const endStr = dateRange.end.toFormat('MMM d, yyyy');
  const periodStr = startStr === endStr ? startStr : `${startStr} - ${endStr}`;

  const stageLabel = progress?.stage ? STAGE_LABELS[progress.stage] || progress.stage : 'Starting';
  const hasProgress = progress?.current !== undefined && progress?.total !== undefined;

  // Build the spinner label with progress info
  let spinnerLabel = stageLabel;
  if (hasProgress) {
    spinnerLabel = `${stageLabel} (${progress.current}/${progress.total})`;
  }

  return (
    <Box flexDirection="column">
      <Text>
        Generating summary for <Text bold>{periodStr}</Text>
      </Text>
      <Box marginTop={1}>
        <Spinner label={spinnerLabel} />
      </Box>
      {progress?.message && !progress.message.startsWith('#') && progress.message !== stageLabel && (
        <Box marginTop={1}>
          <Text dimColor>  {progress.message}</Text>
        </Box>
      )}
      {progress?.message?.startsWith('#') && (
        <Box marginTop={1}>
          <Text dimColor>  Processing {progress.message}</Text>
        </Box>
      )}
      <Box marginTop={2}>
        <Text dimColor>This may take a minute or two...</Text>
      </Box>
    </Box>
  );
}
