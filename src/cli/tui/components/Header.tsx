/**
 * Header component for the TUI
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { Screen } from '../types.js';

interface HeaderProps {
  screen: Screen;
}

const SCREEN_TITLES: Record<Screen, string> = {
  setup: 'Setup',
  'date-selection': 'Select Date',
  loading: 'Generating Summary',
  summary: 'Summary',
  settings: 'Settings',
  error: 'Error',
};

export function Header({ screen }: HeaderProps): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color="cyan">
          Slack Summarizer
        </Text>
        <Text dimColor> │ </Text>
        <Text>{SCREEN_TITLES[screen]}</Text>
      </Box>
      <Text dimColor>{'─'.repeat(50)}</Text>
    </Box>
  );
}
