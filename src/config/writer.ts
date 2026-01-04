import { writeFileSync } from 'node:fs';
import type { ConfigFile } from './schema.js';
import { ensureConfigDir, getConfigFilePath } from './paths.js';

/**
 * Generate a well-formatted TOML config file with comments.
 */
export function formatConfigToml(config: ConfigFile): string {
  const lines: string[] = [];

  // Header
  lines.push('# Slack Summarizer Configuration');
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push('#');
  lines.push('# Documentation: https://github.com/hansef/slack-summarizer');
  lines.push('');

  // Slack section
  if (config.slack) {
    lines.push('[slack]');
    lines.push('# Your Slack user token (must start with xoxp-)');
    lines.push('# Get this from: https://api.slack.com/apps → OAuth & Permissions');
    if (config.slack.user_token) {
      lines.push(`user_token = "${config.slack.user_token}"`);
    } else {
      lines.push('# user_token = "xoxp-..."');
    }
    lines.push('');

    if (config.slack.rate_limit !== undefined) {
      lines.push('# Slack API rate limit (requests per second)');
      lines.push(`rate_limit = ${config.slack.rate_limit}`);
      lines.push('');
    }

    if (config.slack.concurrency !== undefined) {
      lines.push('# Parallel Slack API calls');
      lines.push(`concurrency = ${config.slack.concurrency}`);
      lines.push('');
    }
  }

  // Anthropic section
  if (config.anthropic) {
    lines.push('[anthropic]');
    lines.push('# Your Anthropic API key (must start with sk-ant-)');
    lines.push('# Get this from: https://console.anthropic.com/settings/keys');
    if (config.anthropic.api_key) {
      lines.push(`api_key = "${config.anthropic.api_key}"`);
    } else {
      lines.push('# api_key = "sk-ant-..."');
    }
    lines.push('');

    if (config.anthropic.model) {
      lines.push('# Claude model for summarization');
      lines.push('# Options: claude-haiku-4-5-20251001, claude-sonnet-4-5-20250929');
      lines.push(`model = "${config.anthropic.model}"`);
      lines.push('');
    }

    if (config.anthropic.concurrency !== undefined) {
      lines.push('# Parallel Claude API calls');
      lines.push(`concurrency = ${config.anthropic.concurrency}`);
      lines.push('');
    }
  }

  // Database section
  if (config.database?.path) {
    lines.push('[database]');
    lines.push('# SQLite database path for message caching');
    lines.push(`path = "${config.database.path}"`);
    lines.push('');
  }

  // Logging section
  if (config.logging?.level) {
    lines.push('[logging]');
    lines.push('# Log level: debug, info, warn, error');
    lines.push(`level = "${config.logging.level}"`);
    lines.push('');
  }

  // Performance section
  if (config.performance?.channel_concurrency) {
    lines.push('[performance]');
    lines.push('# Parallel channel processing');
    lines.push(`channel_concurrency = ${config.performance.channel_concurrency}`);
    lines.push('');
  }

  // Settings section
  if (config.settings?.timezone) {
    lines.push('[settings]');
    lines.push('# Timezone for date interpretation (IANA format)');
    lines.push(`timezone = "${config.settings.timezone}"`);
    lines.push('');
  }

  // Embeddings section
  if (config.embeddings) {
    lines.push('[embeddings]');
    lines.push('# Enable semantic similarity using OpenAI embeddings');
    lines.push('# This improves conversation grouping but requires an OpenAI API key');
    lines.push(`enabled = ${config.embeddings.enabled ?? false}`);
    lines.push('');

    if (config.embeddings.api_key) {
      lines.push('# OpenAI API key (only needed if embeddings enabled)');
      lines.push(`api_key = "${config.embeddings.api_key}"`);
      lines.push('');
    }

    if (
      config.embeddings.reference_weight !== undefined ||
      config.embeddings.embedding_weight !== undefined
    ) {
      lines.push('# Similarity weights (should sum to 1.0)');
      if (config.embeddings.reference_weight !== undefined) {
        lines.push(`reference_weight = ${config.embeddings.reference_weight}`);
      }
      if (config.embeddings.embedding_weight !== undefined) {
        lines.push(`embedding_weight = ${config.embeddings.embedding_weight}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Write a config file to disk.
 * Creates the config directory if needed.
 * Uses restricted permissions (0600) for security.
 */
export function writeConfigFile(config: ConfigFile, path?: string): void {
  ensureConfigDir();

  const configPath = path ?? getConfigFilePath();
  const content = formatConfigToml(config);

  writeFileSync(configPath, content, {
    encoding: 'utf-8',
    mode: 0o600, // Owner read/write only
  });
}

/**
 * Create a minimal config file with just the required settings.
 */
export function createMinimalConfig(slackToken: string, anthropicKey: string): ConfigFile {
  return {
    slack: {
      user_token: slackToken,
    },
    anthropic: {
      api_key: anthropicKey,
    },
  };
}

/**
 * Create a full config file with all settings.
 */
export function createFullConfig(options: {
  slackToken: string;
  anthropicKey: string;
  model?: string;
  timezone?: string;
  dbPath?: string;
  logLevel?: string;
  enableEmbeddings?: boolean;
  openaiKey?: string;
}): ConfigFile {
  const config: ConfigFile = {
    slack: {
      user_token: options.slackToken,
    },
    anthropic: {
      api_key: options.anthropicKey,
    },
  };

  if (options.model) {
    config.anthropic = {
      ...config.anthropic,
      model: options.model as 'claude-haiku-4-5-20251001' | 'claude-sonnet-4-5-20250929',
    };
  }

  if (options.timezone) {
    config.settings = { timezone: options.timezone };
  }

  if (options.dbPath) {
    config.database = { path: options.dbPath };
  }

  if (options.logLevel) {
    config.logging = { level: options.logLevel as 'debug' | 'info' | 'warn' | 'error' };
  }

  if (options.enableEmbeddings || options.openaiKey) {
    config.embeddings = {
      enabled: options.enableEmbeddings ?? false,
      api_key: options.openaiKey,
    };
  }

  return config;
}
