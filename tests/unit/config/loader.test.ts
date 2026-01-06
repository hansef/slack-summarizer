/**
 * Tests for configuration loading and validation.
 *
 * The configuration system loads from multiple sources with this priority:
 * 1. Environment variables (highest priority)
 * 2. TOML config file (~/.config/slack-summarizer/config.toml)
 * 3. Schema defaults (lowest priority)
 *
 * Tests verify:
 * - TOML parsing (valid, partial, malformed)
 * - Schema validation (required fields, format validation)
 * - Source merging and priority
 * - Error messages for common misconfigurations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import {
  ConfigFileSchema,
  ConfigSchema,
  configFileToEnvObject,
  type ConfigFile,
} from '@/config/schema.js';
import {
  loadConfigFile,
  getConfig,
  resetConfigCache,
  validateConfig,
} from '@/config/loader.js';

// Mock the paths module to control config file location
vi.mock('@/config/paths.js', () => ({
  configFileExists: vi.fn(),
  getConfigFilePath: vi.fn(),
  getDisplayPath: vi.fn((path: string): string => path),
  getConfigDir: vi.fn(() => '/mock/config'),
  getDefaultDbPath: vi.fn(() => '/mock/data/cache.db'),
}));

// Import mocked functions for test control
import {
  configFileExists,
  getConfigFilePath,
} from '@/config/paths.js';

const fixturesDir = join(__dirname, '../../fixtures/config');

describe('ConfigFileSchema', () => {
  it('should accept empty object (all sections optional)', () => {
    const result = ConfigFileSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should accept valid complete config', () => {
    const config = {
      slack: {
        user_token: 'xoxp-test',
        rate_limit: 10,
        concurrency: 5,
      },
      anthropic: {
        api_key: 'sk-ant-test',
        model: 'claude-haiku-4-5-20251001',
        concurrency: 20,
      },
      database: {
        path: '/tmp/test.db',
      },
      logging: {
        level: 'debug',
      },
      performance: {
        channel_concurrency: 8,
      },
      settings: {
        timezone: 'America/New_York',
      },
      embeddings: {
        enabled: true,
        api_key: 'sk-openai-test',
        reference_weight: 0.7,
        embedding_weight: 0.3,
      },
    };

    const result = ConfigFileSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('should accept partial config with only slack section', () => {
    const config = {
      slack: {
        user_token: 'xoxp-partial',
      },
    };

    const result = ConfigFileSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('should reject invalid log level', () => {
    const config = {
      logging: {
        level: 'invalid-level',
      },
    };

    const result = ConfigFileSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should reject invalid model', () => {
    const config = {
      anthropic: {
        model: 'gpt-4',
      },
    };

    const result = ConfigFileSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should coerce string numbers to numbers', () => {
    const config = {
      slack: {
        rate_limit: '15', // String instead of number
      },
    };

    const result = ConfigFileSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slack?.rate_limit).toBe(15);
    }
  });

  it('should reject negative rate_limit', () => {
    const config = {
      slack: {
        rate_limit: -5,
      },
    };

    const result = ConfigFileSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should validate embedding weights are between 0 and 1', () => {
    const config = {
      embeddings: {
        reference_weight: 1.5, // > 1
      },
    };

    const result = ConfigFileSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});

describe('ConfigSchema', () => {
  it('should require SLACK_USER_TOKEN', () => {
    const result = ConfigSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = result.error.errors.map((e) => e.path.join('.'));
      expect(errors).toContain('SLACK_USER_TOKEN');
    }
  });

  it('should require xoxp- prefix for SLACK_USER_TOKEN', () => {
    const result = ConfigSchema.safeParse({
      SLACK_USER_TOKEN: 'invalid-token',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const tokenError = result.error.errors.find(
        (e) => e.path[0] === 'SLACK_USER_TOKEN'
      );
      expect(tokenError?.message).toContain('xoxp-');
    }
  });

  it('should accept valid SLACK_USER_TOKEN', () => {
    const result = ConfigSchema.safeParse({
      SLACK_USER_TOKEN: 'xoxp-valid-token',
    });
    expect(result.success).toBe(true);
  });

  it('should require sk-ant- prefix for ANTHROPIC_API_KEY', () => {
    const result = ConfigSchema.safeParse({
      SLACK_USER_TOKEN: 'xoxp-valid',
      ANTHROPIC_API_KEY: 'invalid-key',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const keyError = result.error.errors.find(
        (e) => e.path[0] === 'ANTHROPIC_API_KEY'
      );
      expect(keyError?.message).toContain('sk-ant-');
    }
  });

  it('should require sk-ant-oat prefix for CLAUDE_CODE_OAUTH_TOKEN', () => {
    const result = ConfigSchema.safeParse({
      SLACK_USER_TOKEN: 'xoxp-valid',
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-wrong-prefix',
    });
    expect(result.success).toBe(false);
  });

  it('should accept valid CLAUDE_CODE_OAUTH_TOKEN', () => {
    const result = ConfigSchema.safeParse({
      SLACK_USER_TOKEN: 'xoxp-valid',
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-valid-token',
    });
    expect(result.success).toBe(true);
  });

  it('should apply default values', () => {
    const result = ConfigSchema.safeParse({
      SLACK_USER_TOKEN: 'xoxp-valid',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.SLACK_SUMMARIZER_LOG_LEVEL).toBe('info');
      expect(result.data.SLACK_SUMMARIZER_TIMEZONE).toBe('America/Los_Angeles');
      expect(result.data.SLACK_SUMMARIZER_RATE_LIMIT).toBe(10);
      expect(result.data.SLACK_SUMMARIZER_ENABLE_EMBEDDINGS).toBe(false);
      expect(result.data.SLACK_SUMMARIZER_CHANNEL_CONCURRENCY).toBe(10);
      expect(result.data.SLACK_SUMMARIZER_CLAUDE_CONCURRENCY).toBe(20);
      expect(result.data.SLACK_SUMMARIZER_SLACK_CONCURRENCY).toBe(10);
    }
  });

  it('should coerce string booleans', () => {
    const result = ConfigSchema.safeParse({
      SLACK_USER_TOKEN: 'xoxp-valid',
      SLACK_SUMMARIZER_ENABLE_EMBEDDINGS: 'true',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.SLACK_SUMMARIZER_ENABLE_EMBEDDINGS).toBe(true);
    }
  });

  it('should coerce string numbers', () => {
    const result = ConfigSchema.safeParse({
      SLACK_USER_TOKEN: 'xoxp-valid',
      SLACK_SUMMARIZER_RATE_LIMIT: '25',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.SLACK_SUMMARIZER_RATE_LIMIT).toBe(25);
    }
  });
});

describe('configFileToEnvObject', () => {
  it('should convert empty config to empty object', () => {
    const result = configFileToEnvObject({});
    expect(result).toEqual({});
  });

  it('should map slack section correctly', () => {
    const config: ConfigFile = {
      slack: {
        user_token: 'xoxp-test',
        rate_limit: 15,
        concurrency: 8,
      },
    };

    const result = configFileToEnvObject(config);
    expect(result.SLACK_USER_TOKEN).toBe('xoxp-test');
    expect(result.SLACK_SUMMARIZER_RATE_LIMIT).toBe(15);
    expect(result.SLACK_SUMMARIZER_SLACK_CONCURRENCY).toBe(8);
  });

  it('should map anthropic section correctly', () => {
    const config: ConfigFile = {
      anthropic: {
        api_key: 'sk-ant-test',
        oauth_token: 'sk-ant-oat-test',
        model: 'claude-haiku-4-5-20251001',
        concurrency: 25,
      },
    };

    const result = configFileToEnvObject(config);
    expect(result.ANTHROPIC_API_KEY).toBe('sk-ant-test');
    expect(result.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat-test');
    expect(result.SLACK_SUMMARIZER_CLAUDE_MODEL).toBe('claude-haiku-4-5-20251001');
    expect(result.SLACK_SUMMARIZER_CLAUDE_CONCURRENCY).toBe(25);
  });

  it('should map embeddings section correctly', () => {
    const config: ConfigFile = {
      embeddings: {
        enabled: true,
        api_key: 'sk-openai-test',
        reference_weight: 0.7,
        embedding_weight: 0.3,
      },
    };

    const result = configFileToEnvObject(config);
    expect(result.SLACK_SUMMARIZER_ENABLE_EMBEDDINGS).toBe(true);
    expect(result.OPENAI_API_KEY).toBe('sk-openai-test');
    expect(result.SLACK_SUMMARIZER_EMBEDDING_REF_WEIGHT).toBe(0.7);
    expect(result.SLACK_SUMMARIZER_EMBEDDING_EMB_WEIGHT).toBe(0.3);
  });

  it('should map all other sections correctly', () => {
    const config: ConfigFile = {
      database: { path: '/tmp/db.sqlite' },
      logging: { level: 'debug' },
      performance: { channel_concurrency: 5 },
      settings: { timezone: 'Europe/London' },
    };

    const result = configFileToEnvObject(config);
    expect(result.SLACK_SUMMARIZER_DB_PATH).toBe('/tmp/db.sqlite');
    expect(result.SLACK_SUMMARIZER_LOG_LEVEL).toBe('debug');
    expect(result.SLACK_SUMMARIZER_CHANNEL_CONCURRENCY).toBe(5);
    expect(result.SLACK_SUMMARIZER_TIMEZONE).toBe('Europe/London');
  });

  it('should not include undefined values', () => {
    const config: ConfigFile = {
      slack: {
        user_token: 'xoxp-test',
        // rate_limit is undefined
      },
    };

    const result = configFileToEnvObject(config);
    expect(result.SLACK_USER_TOKEN).toBe('xoxp-test');
    expect('SLACK_SUMMARIZER_RATE_LIMIT' in result).toBe(false);
  });
});

describe('loadConfigFile', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return null when config file does not exist', () => {
    vi.mocked(configFileExists).mockReturnValue(false);

    const result = loadConfigFile();
    expect(result).toBeNull();
  });

  it('should parse valid TOML config file', () => {
    const validConfigPath = join(fixturesDir, 'valid.toml');
    vi.mocked(configFileExists).mockReturnValue(true);
    vi.mocked(getConfigFilePath).mockReturnValue(validConfigPath);

    const result = loadConfigFile();

    expect(result).not.toBeNull();
    expect(result?.slack?.user_token).toBe('xoxp-test-token-12345');
    expect(result?.anthropic?.api_key).toBe('sk-ant-api-test-key-12345');
    expect(result?.settings?.timezone).toBe('America/New_York');
  });

  it('should parse partial config file', () => {
    const partialConfigPath = join(fixturesDir, 'partial.toml');
    vi.mocked(configFileExists).mockReturnValue(true);
    vi.mocked(getConfigFilePath).mockReturnValue(partialConfigPath);

    const result = loadConfigFile();

    expect(result).not.toBeNull();
    expect(result?.slack?.user_token).toBe('xoxp-test-token-partial');
    expect(result?.anthropic).toBeUndefined();
  });

  it('should throw on malformed TOML', () => {
    const malformedConfigPath = join(fixturesDir, 'malformed.toml');
    vi.mocked(configFileExists).mockReturnValue(true);
    vi.mocked(getConfigFilePath).mockReturnValue(malformedConfigPath);

    expect(() => loadConfigFile()).toThrow(/Failed to parse config file/);
  });

  it('should throw on invalid schema with helpful error', () => {
    const invalidConfigPath = join(fixturesDir, 'invalid-schema.toml');
    vi.mocked(configFileExists).mockReturnValue(true);
    vi.mocked(getConfigFilePath).mockReturnValue(invalidConfigPath);

    expect(() => loadConfigFile()).toThrow(/Invalid config file structure/);
  });
});

describe('getConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetConfigCache();
    vi.resetAllMocks();
    // Clear all env vars that could affect config
    delete process.env.SLACK_USER_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.SLACK_SUMMARIZER_LOG_LEVEL;
    delete process.env.SLACK_SUMMARIZER_TIMEZONE;
    delete process.env.SLACK_SUMMARIZER_RATE_LIMIT;
    delete process.env.SLACK_SUMMARIZER_ENABLE_EMBEDDINGS;
    delete process.env.SLACK_SUMMARIZER_DB_PATH;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
    resetConfigCache();
  });

  it('should throw when SLACK_USER_TOKEN is missing', () => {
    vi.mocked(configFileExists).mockReturnValue(false);

    expect(() => getConfig()).toThrow(/SLACK_USER_TOKEN/);
  });

  it('should load config from environment variables', () => {
    vi.mocked(configFileExists).mockReturnValue(false);
    process.env.SLACK_USER_TOKEN = 'xoxp-from-env';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-from-env';
    process.env.SLACK_SUMMARIZER_TIMEZONE = 'Europe/Paris';

    const config = getConfig();

    expect(config.SLACK_USER_TOKEN).toBe('xoxp-from-env');
    expect(config.ANTHROPIC_API_KEY).toBe('sk-ant-from-env');
    expect(config.SLACK_SUMMARIZER_TIMEZONE).toBe('Europe/Paris');
  });

  it('should merge config file with env vars (env takes priority)', () => {
    const validConfigPath = join(fixturesDir, 'valid.toml');
    vi.mocked(configFileExists).mockReturnValue(true);
    vi.mocked(getConfigFilePath).mockReturnValue(validConfigPath);

    // Override timezone via env
    process.env.SLACK_SUMMARIZER_TIMEZONE = 'Europe/London';

    const config = getConfig();

    // Should use file token
    expect(config.SLACK_USER_TOKEN).toBe('xoxp-test-token-12345');
    // Should use env timezone (higher priority)
    expect(config.SLACK_SUMMARIZER_TIMEZONE).toBe('Europe/London');
  });

  it('should cache config after first call', () => {
    vi.mocked(configFileExists).mockReturnValue(false);
    process.env.SLACK_USER_TOKEN = 'xoxp-cached';

    const config1 = getConfig();
    process.env.SLACK_USER_TOKEN = 'xoxp-changed';
    const config2 = getConfig();

    // Should still have cached value
    expect(config2.SLACK_USER_TOKEN).toBe('xoxp-cached');
    expect(config1).toBe(config2); // Same reference
  });

  it('should return fresh config after resetConfigCache', () => {
    vi.mocked(configFileExists).mockReturnValue(false);
    process.env.SLACK_USER_TOKEN = 'xoxp-first';

    const config1 = getConfig();
    resetConfigCache();
    process.env.SLACK_USER_TOKEN = 'xoxp-second';
    const config2 = getConfig();

    expect(config1.SLACK_USER_TOKEN).toBe('xoxp-first');
    expect(config2.SLACK_USER_TOKEN).toBe('xoxp-second');
  });

  it('should apply schema defaults for missing optional fields', () => {
    vi.mocked(configFileExists).mockReturnValue(false);
    process.env.SLACK_USER_TOKEN = 'xoxp-test';

    const config = getConfig();

    expect(config.SLACK_SUMMARIZER_LOG_LEVEL).toBe('info');
    expect(config.SLACK_SUMMARIZER_RATE_LIMIT).toBe(10);
    expect(config.SLACK_SUMMARIZER_ENABLE_EMBEDDINGS).toBe(false);
  });

  it('should provide helpful error message when SLACK_USER_TOKEN is missing', () => {
    vi.mocked(configFileExists).mockReturnValue(false);
    delete process.env.SLACK_USER_TOKEN;

    try {
      getConfig();
      expect.fail('Should have thrown');
    } catch (error) {
      expect((error as Error).message).toContain('slack-summarizer configure');
      expect((error as Error).message).toContain('SLACK_USER_TOKEN');
    }
  });
});

describe('validateConfig', () => {
  it('should return success for valid config', () => {
    const result = validateConfig({
      SLACK_USER_TOKEN: 'xoxp-valid',
      ANTHROPIC_API_KEY: 'sk-ant-valid',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.SLACK_USER_TOKEN).toBe('xoxp-valid');
    }
  });

  it('should return errors array for invalid config', () => {
    const result = validateConfig({
      SLACK_USER_TOKEN: 'invalid-no-prefix',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('SLACK_USER_TOKEN');
    }
  });

  it('should validate without caching', () => {
    // First validation
    const result1 = validateConfig({
      SLACK_USER_TOKEN: 'xoxp-first',
    });

    // Second validation with different values
    const result2 = validateConfig({
      SLACK_USER_TOKEN: 'xoxp-second',
    });

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    if (result1.success && result2.success) {
      expect(result1.data.SLACK_USER_TOKEN).toBe('xoxp-first');
      expect(result2.data.SLACK_USER_TOKEN).toBe('xoxp-second');
    }
  });
});
