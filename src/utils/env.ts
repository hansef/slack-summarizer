import { config } from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file
config();

const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
const ClaudeModelSchema = z.enum([
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-5-20250929',
]);

const EnvSchema = z.object({
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

export type Env = z.infer<typeof EnvSchema>;
export type LogLevel = z.infer<typeof LogLevelSchema>;
export type ClaudeModel = z.infer<typeof ClaudeModelSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) {
    return cachedEnv;
  }

  const result = EnvSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${errors}`);
  }

  cachedEnv = result.data;
  return cachedEnv;
}

export function validateEnv(): void {
  getEnv();
}

// For testing purposes - allows resetting the cached env
export function resetEnvCache(): void {
  cachedEnv = null;
}
