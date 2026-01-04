/**
 * Error display screen
 */

import React from 'react';
import { Box, Text, useInput } from 'ink';
import { StatusMessage } from '@inkjs/ui';

interface ErrorScreenProps {
  error: Error;
  onRetry: () => void;
  onQuit: () => void;
}

export function ErrorScreen({ error, onRetry, onQuit }: ErrorScreenProps): React.ReactElement {
  useInput((input) => {
    if (input === 'r') {
      onRetry();
    } else if (input === 'q') {
      onQuit();
    }
  });

  return (
    <Box flexDirection="column">
      <StatusMessage variant="error">An error occurred</StatusMessage>
      <Box marginTop={1} flexDirection="column">
        <Text color="red">{error.message}</Text>
        {error.stack && (
          <Box marginTop={1}>
            <Text dimColor>{error.stack.split('\n').slice(1, 4).join('\n')}</Text>
          </Box>
        )}
      </Box>
      <Box marginTop={2}>
        <Text>
          <Text color="cyan">r</Text>
          <Text dimColor> retry │ </Text>
          <Text color="cyan">q</Text>
          <Text dimColor> quit</Text>
        </Text>
      </Box>
    </Box>
  );
}
