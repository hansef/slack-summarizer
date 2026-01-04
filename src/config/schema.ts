import { z } from 'zod';

// Log level enum
export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
export type LogLevel = z.infer<typeof LogLevelSchema>;

// Claude model enum
export const ClaudeModelSchema = z.enum([
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-5-20250929',
]);
export type ClaudeModel = z.infer<typeof ClaudeModelSchema>;

/**
 * Schema for the TOML config file structure.
 * Uses snake_case keys and nested sections for clarity.
 */
export const ConfigFileSchema = z.object({
  slack: z
    .object({
      user_token: z.string().optional(),
      rate_limit: z.coerce.number().positive().optional(),
      concurrency: z.coerce.number().positive().optional(),
    })
    .optional(),

  anthropic: z
    .object({
      api_key: z.string().optional(),
      model: ClaudeModelSchema.optional(),
      concurrency: z.coerce.number().positive().optional(),
    })
    .optional(),

  database: z
    .object({
      path: z.string().optional(),
    })
    .optional(),

  logging: z
    .object({
      level: LogLevelSchema.optional(),
    })
    .optional(),

  performance: z
    .object({
      channel_concurrency: z.coerce.number().positive().optional(),
    })
    .optional(),

  settings: z
    .object({
      timezone: z.string().optional(),
    })
    .optional(),

  embeddings: z
    .object({
      enabled: z.coerce.boolean().optional(),
      api_key: z.string().optional(),
      reference_weight: z.coerce.number().min(0).max(1).optional(),
      embedding_weight: z.coerce.number().min(0).max(1).optional(),
    })
    .optional(),
});

export type ConfigFile = z.infer<typeof ConfigFileSchema>;

/**
 * Schema for the runtime configuration.
 * Matches the existing Env type for backward compatibility.
 * Uses SCREAMING_SNAKE_CASE to match environment variables.
 */
export const ConfigSchema = z.object({
  // Required
  SLACK_USER_TOKEN: z
    .string()
    .min(1, 'SLACK_USER_TOKEN is required')
    .startsWith('xoxp-', 'SLACK_USER_TOKEN must be a user token (starts with xoxp-)'),
  ANTHROPIC_API_KEY: z
    .string()
    .min(1, 'ANTHROPIC_API_KEY is required')
    .startsWith('sk-ant-', 'ANTHROPIC_API_KEY must start with sk-ant-'),

  // Optional with defaults
  SLACK_SUMMARIZER_DB_PATH: z.string().default('./cache/slack.db'),
  SLACK_SUMMARIZER_LOG_LEVEL: LogLevelSchema.default('info'),
  SLACK_SUMMARIZER_CLAUDE_MODEL: ClaudeModelSchema.default('claude-haiku-4-5-20251001'),
  SLACK_SUMMARIZER_TIMEZONE: z.string().default('America/Los_Angeles'),
  SLACK_SUMMARIZER_RATE_LIMIT: z.coerce.number().positive().default(10),

  // OpenAI embeddings (optional)
  OPENAI_API_KEY: z.string().optional(),
  SLACK_SUMMARIZER_ENABLE_EMBEDDINGS: z.coerce.boolean().default(false),
  SLACK_SUMMARIZER_EMBEDDING_REF_WEIGHT: z.coerce.number().min(0).max(1).default(0.6),
  SLACK_SUMMARIZER_EMBEDDING_EMB_WEIGHT: z.coerce.number().min(0).max(1).default(0.4),

  // Concurrency settings for parallel processing
  SLACK_SUMMARIZER_CHANNEL_CONCURRENCY: z.coerce.number().positive().default(10),
  SLACK_SUMMARIZER_CLAUDE_CONCURRENCY: z.coerce.number().positive().default(20),
  SLACK_SUMMARIZER_SLACK_CONCURRENCY: z.coerce.number().positive().default(10),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Convert a ConfigFile (TOML structure) to a flat env-like object.
 * Only includes defined values (doesn't include undefined).
 */
export function configFileToEnvObject(file: ConfigFile): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};

  // Slack settings
  if (file.slack?.user_token) result.SLACK_USER_TOKEN = file.slack.user_token;
  if (file.slack?.rate_limit) result.SLACK_SUMMARIZER_RATE_LIMIT = file.slack.rate_limit;
  if (file.slack?.concurrency) result.SLACK_SUMMARIZER_SLACK_CONCURRENCY = file.slack.concurrency;

  // Anthropic settings
  if (file.anthropic?.api_key) result.ANTHROPIC_API_KEY = file.anthropic.api_key;
  if (file.anthropic?.model) result.SLACK_SUMMARIZER_CLAUDE_MODEL = file.anthropic.model;
  if (file.anthropic?.concurrency)
    result.SLACK_SUMMARIZER_CLAUDE_CONCURRENCY = file.anthropic.concurrency;

  // Database settings
  if (file.database?.path) result.SLACK_SUMMARIZER_DB_PATH = file.database.path;

  // Logging settings
  if (file.logging?.level) result.SLACK_SUMMARIZER_LOG_LEVEL = file.logging.level;

  // Performance settings
  if (file.performance?.channel_concurrency)
    result.SLACK_SUMMARIZER_CHANNEL_CONCURRENCY = file.performance.channel_concurrency;

  // General settings
  if (file.settings?.timezone) result.SLACK_SUMMARIZER_TIMEZONE = file.settings.timezone;

  // Embeddings settings
  if (file.embeddings?.enabled !== undefined)
    result.SLACK_SUMMARIZER_ENABLE_EMBEDDINGS = file.embeddings.enabled;
  if (file.embeddings?.api_key) result.OPENAI_API_KEY = file.embeddings.api_key;
  if (file.embeddings?.reference_weight !== undefined)
    result.SLACK_SUMMARIZER_EMBEDDING_REF_WEIGHT = file.embeddings.reference_weight;
  if (file.embeddings?.embedding_weight !== undefined)
    result.SLACK_SUMMARIZER_EMBEDDING_EMB_WEIGHT = file.embeddings.embedding_weight;

  return result;
}
