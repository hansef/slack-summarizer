import { config as loadDotenv } from 'dotenv';
import { readFileSync } from 'node:fs';
import TOML from '@iarna/toml';
import {
  ConfigFileSchema,
  ConfigSchema,
  configFileToEnvObject,
  type Config,
  type ConfigFile,
} from './schema.js';
import { configFileExists, getConfigFilePath, getDisplayPath } from './paths.js';
import { logger } from '../utils/logger.js';

// Load .env file on module import (same as before)
loadDotenv();

let cachedConfig: Config | null = null;

/**
 * Load and parse the TOML config file.
 * Returns null if the file doesn't exist.
 * Throws an error if the file exists but is invalid.
 */
export function loadConfigFile(): ConfigFile | null {
  if (!configFileExists()) {
    return null;
  }

  const configPath = getConfigFilePath();

  try {
    const content = readFileSync(configPath, 'utf-8');
    const parsed = TOML.parse(content);

    // Validate structure
    const result = ConfigFileSchema.safeParse(parsed);
    if (!result.success) {
      const errors = result.error.errors.map((e) => `  - ${e.path.join('.')}: ${e.message}`);
      throw new Error(
        `Invalid config file structure:\n${errors.join('\n')}\n\nFile: ${getDisplayPath(configPath)}`
      );
    }

    return result.data;
  } catch (error) {
    // Re-throw with file context if it's a TOML parse error
    if (error instanceof Error && !error.message.includes('config file')) {
      const displayPath = getDisplayPath(configPath);
      throw new Error(`Failed to parse config file (${displayPath}):\n${error.message}`);
    }
    throw error;
  }
}

/**
 * Get the merged configuration from all sources.
 *
 * Priority (highest to lowest):
 * 1. Environment variables (process.env)
 * 2. Config file (~/.config/slack-summarizer/config.toml)
 * 3. Schema defaults
 *
 * The result is cached after first call.
 */
export function getConfig(): Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  // Load config file (if exists)
  let fileConfig: Record<string, string | number | boolean> = {};
  try {
    const configFile = loadConfigFile();
    if (configFile) {
      fileConfig = configFileToEnvObject(configFile);
    }
  } catch (error) {
    // Log warning but don't fail - env vars might be sufficient
    logger.warn('Failed to load config file', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Merge: env vars override file config
  // Convert file config values to strings for process.env compatibility
  const stringifiedFileConfig: Record<string, string> = {};
  for (const [key, value] of Object.entries(fileConfig)) {
    stringifiedFileConfig[key] = String(value);
  }

  const merged = {
    ...stringifiedFileConfig,
    ...process.env,
  };

  // Validate and apply defaults
  const result = ConfigSchema.safeParse(merged);

  if (!result.success) {
    const errors = result.error.errors.map((e) => `  - ${e.path.join('.')}: ${e.message}`);

    // Provide helpful error message based on what's missing
    const missingRequired = result.error.errors.filter(
      (e) => e.path[0] === 'SLACK_USER_TOKEN' || e.path[0] === 'ANTHROPIC_API_KEY'
    );

    let helpText = '';
    if (missingRequired.length > 0) {
      helpText = `\n\nTo configure, run:\n  slack-summarizer configure\n\nOr set environment variables:\n  export SLACK_USER_TOKEN="xoxp-..."\n  export ANTHROPIC_API_KEY="sk-ant-..."`;
    }

    throw new Error(`Configuration validation failed:\n${errors.join('\n')}${helpText}`);
  }

  cachedConfig = result.data;
  return cachedConfig;
}

/**
 * Reset the cached config.
 * Useful for testing or when config file changes.
 */
export function resetConfigCache(): void {
  cachedConfig = null;
}

/**
 * Validate configuration without caching.
 * Useful for testing config before saving.
 */
export function validateConfig(
  config: Record<string, unknown>
): { success: true; data: Config } | { success: false; errors: string[] } {
  const result = ConfigSchema.safeParse(config);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    errors: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
  };
}

// Re-export for convenience
export { getConfigFilePath, getConfigDir, configFileExists, getDisplayPath } from './paths.js';
export type { Config, ConfigFile } from './schema.js';
