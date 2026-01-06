/**
 * Environment/Configuration utilities.
 *
 * This module provides backward compatibility with existing code that imports
 * from `./env.js`. The actual configuration logic has moved to the config module
 * which supports both environment variables and TOML config files.
 *
 * For new code, consider importing directly from '../config/index.js'.
 */

import {
  getConfig,
  resetConfigCache,
  type Config,
  type LogLevel,
  type ClaudeModel,
} from '@/config/index.js';

// Re-export types for backward compatibility
export type { Config, LogLevel, ClaudeModel };

// Backward compatibility aliases
export type Env = Config;

/**
 * Get the validated configuration.
 *
 * This function merges configuration from multiple sources:
 * 1. Environment variables (highest priority)
 * 2. Config file (~/.config/slack-summarizer/config.toml)
 * 3. Schema defaults (lowest priority)
 *
 * @returns The validated configuration object
 * @throws Error if required configuration is missing or invalid
 */
export function getEnv(): Env {
  return getConfig();
}

/**
 * Validate configuration without returning it.
 * Useful for early validation at startup.
 */
export function validateEnv(): void {
  getConfig();
}

/**
 * Reset the cached configuration.
 * Useful for testing or when configuration changes.
 */
export function resetEnvCache(): void {
  resetConfigCache();
}
