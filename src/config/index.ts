/**
 * Configuration module for Slack Summarizer.
 *
 * This module provides a clean interface for loading and managing configuration
 * from multiple sources with the following priority (highest to lowest):
 *
 * 1. Environment variables (process.env)
 * 2. Config file (~/.config/slack-summarizer/config.toml)
 * 3. Schema defaults
 *
 * @example
 * ```typescript
 * import { getConfig, getConfigFilePath } from './config/index.js';
 *
 * // Get merged configuration
 * const config = getConfig();
 * console.log(config.SLACK_USER_TOKEN);
 *
 * // Check where config file is located
 * console.log(getConfigFilePath());
 * ```
 */

// Re-export everything for convenience
export {
  getConfig,
  loadConfigFile,
  resetConfigCache,
  validateConfig,
  getConfigFilePath,
  getConfigDir,
  configFileExists,
  getDisplayPath,
  type Config,
  type ConfigFile,
} from './loader.js';

export {
  formatConfigToml,
  writeConfigFile,
  createMinimalConfig,
  createFullConfig,
} from './writer.js';

export {
  ConfigSchema,
  ConfigFileSchema,
  LogLevelSchema,
  ClaudeModelSchema,
  configFileToEnvObject,
  type LogLevel,
  type ClaudeModel,
} from './schema.js';

export {
  ensureConfigDir,
  ensureDataDir,
  getDataDir,
  getDefaultDbPath,
} from './paths.js';
