/**
 * Hook for checking and managing configuration state
 */

import { useState, useEffect, useCallback } from 'react';
import { getConfig, resetConfigCache } from '@/config/loader.js';
import { configFileExists } from '@/config/paths.js';
import type { Config } from '@/config/schema.js';

export interface UseConfigReturn {
  config: Config | null;
  loading: boolean;
  isConfigured: boolean;
  error: Error | null;
  reload: () => void;
}

export function useConfig(): UseConfigReturn {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadConfig = useCallback(() => {
    setLoading(true);
    setError(null);

    try {
      // Check if config file exists first
      if (!configFileExists()) {
        setConfig(null);
        setLoading(false);
        return;
      }

      // Reset cache to get fresh config
      resetConfigCache();
      const cfg = getConfig();
      setConfig(cfg);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  return {
    config,
    loading,
    isConfigured: config !== null,
    error,
    reload: loadConfig,
  };
}
