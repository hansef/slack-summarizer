/**
 * Hook for managing summary generation state
 */

import { useState, useCallback } from 'react';
import { createSummaryAggregator, type ProgressEvent } from '../../../core/summarization/aggregator.js';
import type { SummaryOutput } from '../../../core/models/summary.js';
import type { DateRange } from '../../../utils/dates.js';

export interface SummaryProgress {
  stage: ProgressEvent['stage'];
  message: string;
  current?: number;
  total?: number;
}

export interface UseSummaryReturn {
  summary: SummaryOutput | null;
  loading: boolean;
  error: Error | null;
  progress: SummaryProgress | null;
  generate: (dateRange: DateRange) => Promise<void>;
  reset: () => void;
}

export function useSummary(): UseSummaryReturn {
  const [summary, setSummary] = useState<SummaryOutput | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [progress, setProgress] = useState<SummaryProgress | null>(null);

  const generate = useCallback(async (dateRange: DateRange) => {
    setLoading(true);
    setError(null);
    setSummary(null);
    setProgress({ stage: 'fetching', message: 'Starting...' });

    try {
      // Build timespan string from date range
      const startStr = dateRange.start.toFormat('yyyy-MM-dd');
      const endStr = dateRange.end.toFormat('yyyy-MM-dd');
      const timespan = startStr === endStr ? startStr : `${startStr}..${endStr}`;

      const aggregator = createSummaryAggregator({
        onProgress: (event: ProgressEvent) => {
          setProgress({
            stage: event.stage,
            message: event.message,
            current: event.current,
            total: event.total,
          });
        },
      });

      const result = await aggregator.generateSummary(timespan);
      setSummary(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setSummary(null);
    setLoading(false);
    setError(null);
    setProgress(null);
  }, []);

  return {
    summary,
    loading,
    error,
    progress,
    generate,
    reset,
  };
}
