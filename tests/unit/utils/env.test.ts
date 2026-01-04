import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getEnv, validateEnv, resetEnvCache } from '../../../src/utils/env.js';

describe('env', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetEnvCache();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    resetEnvCache();
  });

  describe('getEnv', () => {
    it('should return valid environment when all required vars are set', () => {
      process.env.SLACK_USER_TOKEN = 'xoxp-test-token';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      // Delete optional vars to test defaults
      delete process.env.SLACK_SUMMARIZER_DB_PATH;
      delete process.env.SLACK_SUMMARIZER_LOG_LEVEL;
      delete process.env.SLACK_SUMMARIZER_CLAUDE_MODEL;
      delete process.env.SLACK_SUMMARIZER_TIMEZONE;

      const env = getEnv();

      expect(env.SLACK_USER_TOKEN).toBe('xoxp-test-token');
      expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test-key');
      expect(env.SLACK_SUMMARIZER_DB_PATH).toBe('./cache/slack.db');
      expect(env.SLACK_SUMMARIZER_LOG_LEVEL).toBe('info');
      expect(env.SLACK_SUMMARIZER_CLAUDE_MODEL).toBe('claude-haiku-4-5-20251001');
      expect(env.SLACK_SUMMARIZER_TIMEZONE).toBe('America/Los_Angeles');
    });

    it('should throw error when SLACK_USER_TOKEN is missing', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      delete process.env.SLACK_USER_TOKEN;

      expect(() => getEnv()).toThrow('Configuration validation failed');
    });

    it('should throw error when SLACK_USER_TOKEN has wrong prefix', () => {
      process.env.SLACK_USER_TOKEN = 'xoxb-bot-token';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

      expect(() => getEnv()).toThrow('must be a user token');
    });

    it('should throw error when ANTHROPIC_API_KEY is missing', () => {
      process.env.SLACK_USER_TOKEN = 'xoxp-test-token';
      delete process.env.ANTHROPIC_API_KEY;

      expect(() => getEnv()).toThrow('Configuration validation failed');
    });

    it('should throw error when ANTHROPIC_API_KEY has wrong prefix', () => {
      process.env.SLACK_USER_TOKEN = 'xoxp-test-token';
      process.env.ANTHROPIC_API_KEY = 'invalid-key';

      expect(() => getEnv()).toThrow('must start with sk-ant-');
    });

    it('should accept custom optional values', () => {
      process.env.SLACK_USER_TOKEN = 'xoxp-test-token';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      process.env.SLACK_SUMMARIZER_DB_PATH = '/custom/path/db.sqlite';
      process.env.SLACK_SUMMARIZER_LOG_LEVEL = 'debug';
      process.env.SLACK_SUMMARIZER_CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';
      process.env.SLACK_SUMMARIZER_TIMEZONE = 'America/New_York';

      const env = getEnv();

      expect(env.SLACK_SUMMARIZER_DB_PATH).toBe('/custom/path/db.sqlite');
      expect(env.SLACK_SUMMARIZER_LOG_LEVEL).toBe('debug');
      expect(env.SLACK_SUMMARIZER_CLAUDE_MODEL).toBe('claude-sonnet-4-5-20250929');
      expect(env.SLACK_SUMMARIZER_TIMEZONE).toBe('America/New_York');
    });

    it('should cache the environment after first call', () => {
      process.env.SLACK_USER_TOKEN = 'xoxp-test-token';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

      const env1 = getEnv();
      process.env.SLACK_USER_TOKEN = 'xoxp-changed-token';
      const env2 = getEnv();

      expect(env1).toBe(env2);
      expect(env2.SLACK_USER_TOKEN).toBe('xoxp-test-token');
    });
  });

  describe('validateEnv', () => {
    it('should not throw when environment is valid', () => {
      process.env.SLACK_USER_TOKEN = 'xoxp-test-token';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

      expect(() => validateEnv()).not.toThrow();
    });

    it('should throw when environment is invalid', () => {
      delete process.env.SLACK_USER_TOKEN;
      delete process.env.ANTHROPIC_API_KEY;

      expect(() => validateEnv()).toThrow();
    });
  });
});
