/**
 * Main TUI App component with screen routing
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Box, useApp } from 'ink';
import type { DateRange } from '../../utils/dates.js';
import type { SummaryOutput } from '../../core/models/summary.js';
import type { Screen } from './types.js';
import { useConfig } from './hooks/useConfig.js';
import { useSummary } from './hooks/useSummary.js';
import { Header } from './components/Header.js';
import { DateSelectionScreen } from './screens/DateSelectionScreen.js';
import { LoadingScreen } from './screens/LoadingScreen.js';
import { SummaryScreen } from './screens/SummaryScreen.js';
import { SetupScreen } from './screens/SetupScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
import { ErrorScreen } from './screens/ErrorScreen.js';

interface AppState {
  screen: Screen;
  dateRange: DateRange | null;
  summary: SummaryOutput | null;
  savedFilePath: string | null;
}

export function App(): React.ReactElement {
  const { exit } = useApp();
  const { isConfigured, loading: configLoading, reload: reloadConfig } = useConfig();
  const {
    summary,
    loading: summaryLoading,
    error: summaryError,
    progress,
    generate,
    reset: resetSummary,
  } = useSummary();

  const [state, setState] = useState<AppState>({
    screen: 'date-selection', // Will be updated after config check
    dateRange: null,
    summary: null,
    savedFilePath: null,
  });

  // Check config on mount and set initial screen
  useEffect(() => {
    if (!configLoading) {
      if (!isConfigured) {
        setState((s) => ({ ...s, screen: 'setup' }));
      } else {
        setState((s) => ({ ...s, screen: 'date-selection' }));
      }
    }
  }, [configLoading, isConfigured]);

  // Handle summary completion
  useEffect(() => {
    if (summary && !summaryLoading) {
      setState((s) => ({
        ...s,
        screen: 'summary',
        summary,
      }));
    }
  }, [summary, summaryLoading]);

  // Handle summary error
  useEffect(() => {
    if (summaryError) {
      setState((s) => ({ ...s, screen: 'error' }));
    }
  }, [summaryError]);

  const handleDateSelect = useCallback(
    (dateRange: DateRange) => {
      setState((s) => ({
        ...s,
        dateRange,
        screen: 'loading',
        savedFilePath: null,
      }));
      generate(dateRange);
    },
    [generate]
  );

  const handleSetupComplete = useCallback(() => {
    reloadConfig();
    setState((s) => ({ ...s, screen: 'date-selection' }));
  }, [reloadConfig]);

  const handleNewSummary = useCallback(() => {
    resetSummary();
    setState((s) => ({
      ...s,
      screen: 'date-selection',
      summary: null,
      savedFilePath: null,
    }));
  }, [resetSummary]);

  const handleSave = useCallback((path: string) => {
    setState((s) => ({ ...s, savedFilePath: path }));
  }, []);

  const handleSettings = useCallback(() => {
    setState((s) => ({ ...s, screen: 'settings' }));
  }, []);

  const handleSettingsBack = useCallback(() => {
    // Reload config in case credentials changed
    reloadConfig();
    // Go back to previous screen (summary if we have one, otherwise date selection)
    setState((s) => ({
      ...s,
      screen: s.summary ? 'summary' : 'date-selection',
    }));
  }, [reloadConfig]);

  const handleQuit = useCallback(() => {
    exit();
  }, [exit]);

  const handleRetry = useCallback(() => {
    if (state.dateRange) {
      setState((s) => ({ ...s, screen: 'loading' }));
      generate(state.dateRange);
    } else {
      setState((s) => ({ ...s, screen: 'date-selection' }));
    }
  }, [state.dateRange, generate]);

  // Show nothing while checking config
  if (configLoading) {
    return <Box />;
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Header screen={state.screen} />

      {state.screen === 'setup' && (
        <SetupScreen onComplete={handleSetupComplete} onSkip={handleQuit} />
      )}

      {state.screen === 'date-selection' && isConfigured && (
        <DateSelectionScreen
          onSelect={handleDateSelect}
          onSettings={handleSettings}
          onQuit={handleQuit}
        />
      )}

      {state.screen === 'loading' && state.dateRange && (
        <LoadingScreen dateRange={state.dateRange} progress={progress} />
      )}

      {state.screen === 'summary' && state.summary && state.dateRange && (
        <SummaryScreen
          summary={state.summary}
          dateRange={state.dateRange}
          savedFilePath={state.savedFilePath}
          onSave={handleSave}
          onNewSummary={handleNewSummary}
          onSettings={handleSettings}
          onQuit={handleQuit}
        />
      )}

      {state.screen === 'settings' && <SettingsScreen onBack={handleSettingsBack} />}

      {state.screen === 'error' && summaryError && (
        <ErrorScreen error={summaryError} onRetry={handleRetry} onQuit={handleQuit} />
      )}
    </Box>
  );
}
