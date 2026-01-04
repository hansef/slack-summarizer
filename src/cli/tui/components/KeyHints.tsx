/**
 * Key hints footer component
 */

import React from 'react';
import { Box, Text } from 'ink';

interface KeyHint {
  key: string;
  label: string;
}

interface KeyHintsProps {
  hints: KeyHint[];
}

export function KeyHints({ hints }: KeyHintsProps): React.ReactElement {
  return (
    <Box marginTop={1}>
      <Text dimColor>{'─'.repeat(50)}</Text>
      <Box marginTop={0}>
        {hints.map((hint, index) => (
          <React.Fragment key={hint.key}>
            {index > 0 && <Text dimColor> │ </Text>}
            <Text>
              <Text color="cyan">{hint.key}</Text>
              <Text dimColor> {hint.label}</Text>
            </Text>
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
}
