/**
 * Summary display screen with scrollable markdown viewer
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import type { SummaryOutput } from '@/core/models/summary.js';
import type { DateRange } from '@/utils/dates.js';
import { formatSummaryAsMarkdown } from '@/cli/formatters/markdown.js';
import { saveSummaryToFile, formatPathForDisplay } from '../utils/file-save.js';

interface SummaryScreenProps {
  summary: SummaryOutput;
  dateRange: DateRange;
  savedFilePath: string | null;
  onSave: (path: string) => void;
  onNewSummary: () => void;
  onSettings: () => void;
  onQuit: () => void;
}

export function SummaryScreen({
  summary,
  dateRange,
  savedFilePath,
  onSave,
  onNewSummary,
  onSettings,
  onQuit,
}: SummaryScreenProps): React.ReactElement {
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  // Reserve space for: stats bar (2), scroll indicator (2), status/saved (2), key hints (2)
  const viewportHeight = Math.max(5, terminalHeight - 8);

  const markdown = useMemo(() => formatSummaryAsMarkdown(summary), [summary]);
  const lines = useMemo(() => markdown.split('\n'), [markdown]);

  const [scrollOffset, setScrollOffset] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const maxScroll = Math.max(0, lines.length - viewportHeight);

  const showStatus = useCallback((message: string) => {
    setStatusMessage(message);
    setTimeout(() => setStatusMessage(null), 3000);
  }, []);

  const handleSave = useCallback(() => {
    try {
      const path = saveSummaryToFile(markdown, dateRange);
      onSave(path);
      showStatus(`Saved to ${formatPathForDisplay(path)}`);
    } catch (err) {
      showStatus(`Error saving: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [markdown, dateRange, onSave, showStatus]);

  useInput((input, key) => {
    if (key.upArrow) {
      setScrollOffset((s) => Math.max(0, s - 1));
    } else if (key.downArrow) {
      setScrollOffset((s) => Math.min(maxScroll, s + 1));
    } else if (key.pageUp || input === 'k') {
      setScrollOffset((s) => Math.max(0, s - viewportHeight));
    } else if (key.pageDown || input === 'j') {
      setScrollOffset((s) => Math.min(maxScroll, s + viewportHeight));
    } else if (input === 'g') {
      setScrollOffset(0);
    } else if (input === 'G') {
      setScrollOffset(maxScroll);
    } else if (input === 'w') {
      handleSave();
    } else if (input === 'n') {
      onNewSummary();
    } else if (input === 's') {
      onSettings();
    } else if (input === 'q') {
      onQuit();
    }
  });

  // Get visible lines for current scroll position
  const visibleLines = lines.slice(scrollOffset, scrollOffset + viewportHeight);

  // Pad to exactly viewportHeight lines to prevent layout shifts
  while (visibleLines.length < viewportHeight) {
    visibleLines.push('');
  }

  return (
    <Box flexDirection="column">
      {/* Stats bar */}
      <Box marginBottom={1}>
        <Text dimColor>
          {summary.summary.total_channels} channels │ {summary.summary.total_messages} messages │{' '}
          {summary.summary.mentions_received} mentions │ {summary.summary.threads_participated} threads
        </Text>
      </Box>

      {/* Main content area - fixed height with exact line count */}
      <Box flexDirection="column">
        {visibleLines.map((line, index) => (
          <Box key={index}>
            {renderMarkdownLine(line)}
          </Box>
        ))}
      </Box>

      {/* Scroll indicator */}
      <Box marginTop={1}>
        <Text dimColor>
          Line {scrollOffset + 1}-{Math.min(scrollOffset + viewportHeight, lines.length)} of{' '}
          {lines.length}
          {maxScroll > 0 && ` (${Math.round((scrollOffset / maxScroll) * 100)}%)`}
        </Text>
      </Box>

      {/* Status message or saved indicator */}
      <Box>
        {statusMessage ? (
          <Text color="green">{statusMessage}</Text>
        ) : savedFilePath ? (
          <Text color="green">Saved to {formatPathForDisplay(savedFilePath)}</Text>
        ) : (
          <Text> </Text>
        )}
      </Box>

      {/* Key hints */}
      <Box>
        <Text dimColor>
          ↑↓ scroll │ j/k page │ g/G top/bottom │ w save │ n new │ s settings │ q quit
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Render a markdown line with basic syntax highlighting
 */
function renderMarkdownLine(line: string): React.ReactElement {
  // Empty lines - render a space to maintain line height
  if (!line || line.trim() === '') {
    return <Text> </Text>;
  }

  // Headers
  if (line.startsWith('# ')) {
    return <Text bold color="cyan">{line}</Text>;
  }
  if (line.startsWith('## ')) {
    return <Text bold color="blue">{line}</Text>;
  }
  if (line.startsWith('### ')) {
    return <Text bold>{line}</Text>;
  }

  // Blockquotes (narrative summaries)
  if (line.startsWith('> ')) {
    return <Text color="yellow">{line}</Text>;
  }

  // Horizontal rules
  if (line === '---' || line === '***') {
    return <Text dimColor>{'─'.repeat(40)}</Text>;
  }

  // Bold text within lines
  if (line.includes('**')) {
    const parts: React.ReactElement[] = [];
    let remaining = line;
    let key = 0;

    while (remaining.includes('**')) {
      const startIndex = remaining.indexOf('**');
      const endIndex = remaining.indexOf('**', startIndex + 2);

      if (endIndex === -1) break;

      // Text before bold
      if (startIndex > 0) {
        parts.push(<Text key={key++}>{remaining.slice(0, startIndex)}</Text>);
      }

      // Bold text
      parts.push(
        <Text key={key++} bold>
          {remaining.slice(startIndex + 2, endIndex)}
        </Text>
      );

      remaining = remaining.slice(endIndex + 2);
    }

    // Remaining text
    if (remaining) {
      parts.push(<Text key={key++}>{remaining}</Text>);
    }

    return <Text>{parts}</Text>;
  }

  // Table rows
  if (line.startsWith('|')) {
    return <Text dimColor>{line}</Text>;
  }

  // Default
  return <Text>{line}</Text>;
}
