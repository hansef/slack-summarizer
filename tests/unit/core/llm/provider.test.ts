/**
 * Tests for Claude LLM provider selection and backend abstraction.
 *
 * The provider factory:
 * 1. Auto-selects backend based on available credentials
 * 2. Prioritizes OAuth token (CLI backend) over API key (SDK backend)
 * 3. Falls back gracefully if CLI is not available
 * 4. Provides clear error messages for missing credentials
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { execSync } from 'child_process';
import {
  ClaudeProvider,
  getClaudeProvider,
  resetClaudeProvider,
} from '@/core/llm/provider.js';

// Mock child_process for CLI availability checks
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

// Mock the env utility
vi.mock('@/utils/env.js', () => ({
  getEnv: vi.fn(),
}));

// Mock the backends to avoid real API calls
vi.mock('@/core/llm/backends/anthropic-sdk.js', () => {
  return {
    AnthropicSdkBackend: class MockSdkBackend {
      readonly backendType = 'sdk' as const;
      constructor(public config: { apiKey: string }) {}
      createMessage() { return Promise.resolve({ content: [] }); }
    },
  };
});

vi.mock('@/core/llm/backends/claude-cli.js', () => {
  return {
    ClaudeCliBackend: class MockCliBackend {
      readonly backendType = 'cli' as const;
      constructor(public config: { oauthToken: string; cliPath?: string }) {}
      createMessage() { return Promise.resolve({ content: [] }); }
    },
  };
});

// Import mocked modules
import { getEnv } from '@/utils/env.js';

describe('ClaudeProvider', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetClaudeProvider();
    // Default: no credentials, no CLI
    vi.mocked(getEnv).mockReturnValue({
      SLACK_USER_TOKEN: 'xoxp-test',
      SLACK_SUMMARIZER_DB_PATH: '/tmp/test.db',
      SLACK_SUMMARIZER_LOG_LEVEL: 'info',
      SLACK_SUMMARIZER_CLAUDE_MODEL: 'claude-haiku-4-5-20251001',
      SLACK_SUMMARIZER_TIMEZONE: 'America/Los_Angeles',
      SLACK_SUMMARIZER_RATE_LIMIT: 10,
      SLACK_SUMMARIZER_ENABLE_EMBEDDINGS: false,
      SLACK_SUMMARIZER_EMBEDDING_REF_WEIGHT: 0.6,
      SLACK_SUMMARIZER_EMBEDDING_EMB_WEIGHT: 0.4,
      SLACK_SUMMARIZER_CHANNEL_CONCURRENCY: 10,
      SLACK_SUMMARIZER_CLAUDE_CONCURRENCY: 20,
      SLACK_SUMMARIZER_SLACK_CONCURRENCY: 10,
    });
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('command not found');
    });
  });

  describe('explicit backend selection', () => {
    it('should use SDK backend when explicitly requested', () => {
      const provider = new ClaudeProvider({
        backend: 'sdk',
        apiKey: 'sk-ant-test-key',
      });

      const backend = provider.getBackend();
      expect(backend.backendType).toBe('sdk');
      // Verify the backend was constructed with the correct config
      expect((backend as unknown as { config: { apiKey: string } }).config.apiKey).toBe('sk-ant-test-key');
    });

    it('should use CLI backend when explicitly requested', () => {
      const provider = new ClaudeProvider({
        backend: 'cli',
        oauthToken: 'sk-ant-oat-test-token',
      });

      const backend = provider.getBackend();
      expect(backend.backendType).toBe('cli');
      expect((backend as unknown as { config: { oauthToken: string } }).config.oauthToken).toBe('sk-ant-oat-test-token');
    });

    it('should throw when SDK backend requested without API key', () => {
      expect(() => new ClaudeProvider({ backend: 'sdk' })).toThrow(
        /ANTHROPIC_API_KEY required/
      );
    });

    it('should throw when CLI backend requested without OAuth token', () => {
      expect(() => new ClaudeProvider({ backend: 'cli' })).toThrow(
        /CLAUDE_CODE_OAUTH_TOKEN required/
      );
    });
  });

  describe('auto-detection with OAuth token', () => {
    it('should prefer CLI backend when OAuth token is present and CLI available', () => {
      vi.mocked(getEnv).mockReturnValue({
        SLACK_USER_TOKEN: 'xoxp-test',
        CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-auto-token',
        SLACK_SUMMARIZER_DB_PATH: '/tmp/test.db',
        SLACK_SUMMARIZER_LOG_LEVEL: 'info',
        SLACK_SUMMARIZER_CLAUDE_MODEL: 'claude-haiku-4-5-20251001',
        SLACK_SUMMARIZER_TIMEZONE: 'America/Los_Angeles',
        SLACK_SUMMARIZER_RATE_LIMIT: 10,
        SLACK_SUMMARIZER_ENABLE_EMBEDDINGS: false,
        SLACK_SUMMARIZER_EMBEDDING_REF_WEIGHT: 0.6,
        SLACK_SUMMARIZER_EMBEDDING_EMB_WEIGHT: 0.4,
        SLACK_SUMMARIZER_CHANNEL_CONCURRENCY: 10,
        SLACK_SUMMARIZER_CLAUDE_CONCURRENCY: 20,
        SLACK_SUMMARIZER_SLACK_CONCURRENCY: 10,
      });
      vi.mocked(execSync).mockReturnValue('/usr/local/bin/claude');

      const provider = new ClaudeProvider();
      const backend = provider.getBackend();

      expect(backend.backendType).toBe('cli');
    });

    it('should fall back to SDK when OAuth present but CLI not available', () => {
      vi.mocked(getEnv).mockReturnValue({
        SLACK_USER_TOKEN: 'xoxp-test',
        CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-auto-token',
        ANTHROPIC_API_KEY: 'sk-ant-fallback-key',
        SLACK_SUMMARIZER_DB_PATH: '/tmp/test.db',
        SLACK_SUMMARIZER_LOG_LEVEL: 'info',
        SLACK_SUMMARIZER_CLAUDE_MODEL: 'claude-haiku-4-5-20251001',
        SLACK_SUMMARIZER_TIMEZONE: 'America/Los_Angeles',
        SLACK_SUMMARIZER_RATE_LIMIT: 10,
        SLACK_SUMMARIZER_ENABLE_EMBEDDINGS: false,
        SLACK_SUMMARIZER_EMBEDDING_REF_WEIGHT: 0.6,
        SLACK_SUMMARIZER_EMBEDDING_EMB_WEIGHT: 0.4,
        SLACK_SUMMARIZER_CHANNEL_CONCURRENCY: 10,
        SLACK_SUMMARIZER_CLAUDE_CONCURRENCY: 20,
        SLACK_SUMMARIZER_SLACK_CONCURRENCY: 10,
      });
      // CLI not available
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('command not found');
      });

      const provider = new ClaudeProvider();
      const backend = provider.getBackend();

      expect(backend.backendType).toBe('sdk');
      expect((backend as unknown as { config: { apiKey: string } }).config.apiKey).toBe('sk-ant-fallback-key');
    });

    it('should throw when OAuth present, CLI not available, and no API key fallback', () => {
      vi.mocked(getEnv).mockReturnValue({
        SLACK_USER_TOKEN: 'xoxp-test',
        CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-auto-token',
        // No ANTHROPIC_API_KEY
        SLACK_SUMMARIZER_DB_PATH: '/tmp/test.db',
        SLACK_SUMMARIZER_LOG_LEVEL: 'info',
        SLACK_SUMMARIZER_CLAUDE_MODEL: 'claude-haiku-4-5-20251001',
        SLACK_SUMMARIZER_TIMEZONE: 'America/Los_Angeles',
        SLACK_SUMMARIZER_RATE_LIMIT: 10,
        SLACK_SUMMARIZER_ENABLE_EMBEDDINGS: false,
        SLACK_SUMMARIZER_EMBEDDING_REF_WEIGHT: 0.6,
        SLACK_SUMMARIZER_EMBEDDING_EMB_WEIGHT: 0.4,
        SLACK_SUMMARIZER_CHANNEL_CONCURRENCY: 10,
        SLACK_SUMMARIZER_CLAUDE_CONCURRENCY: 20,
        SLACK_SUMMARIZER_SLACK_CONCURRENCY: 10,
      });
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('command not found');
      });

      expect(() => new ClaudeProvider()).toThrow(/claude.*CLI not found/);
    });
  });

  describe('auto-detection with API key only', () => {
    it('should use SDK backend when only API key is present', () => {
      vi.mocked(getEnv).mockReturnValue({
        SLACK_USER_TOKEN: 'xoxp-test',
        ANTHROPIC_API_KEY: 'sk-ant-api-only',
        SLACK_SUMMARIZER_DB_PATH: '/tmp/test.db',
        SLACK_SUMMARIZER_LOG_LEVEL: 'info',
        SLACK_SUMMARIZER_CLAUDE_MODEL: 'claude-haiku-4-5-20251001',
        SLACK_SUMMARIZER_TIMEZONE: 'America/Los_Angeles',
        SLACK_SUMMARIZER_RATE_LIMIT: 10,
        SLACK_SUMMARIZER_ENABLE_EMBEDDINGS: false,
        SLACK_SUMMARIZER_EMBEDDING_REF_WEIGHT: 0.6,
        SLACK_SUMMARIZER_EMBEDDING_EMB_WEIGHT: 0.4,
        SLACK_SUMMARIZER_CHANNEL_CONCURRENCY: 10,
        SLACK_SUMMARIZER_CLAUDE_CONCURRENCY: 20,
        SLACK_SUMMARIZER_SLACK_CONCURRENCY: 10,
      });

      const provider = new ClaudeProvider();
      const backend = provider.getBackend();

      expect(backend.backendType).toBe('sdk');
    });
  });

  describe('no credentials', () => {
    it('should throw helpful error when no credentials found', () => {
      // No credentials configured (from beforeEach)

      expect(() => new ClaudeProvider()).toThrow(/No Claude credentials found/);
    });

    it('should suggest slack-summarizer configure in error', () => {
      expect(() => new ClaudeProvider()).toThrow(/slack-summarizer configure/);
    });
  });

  describe('token format validation', () => {
    it('should ignore OAuth token without correct prefix', () => {
      vi.mocked(getEnv).mockReturnValue({
        SLACK_USER_TOKEN: 'xoxp-test',
        CLAUDE_CODE_OAUTH_TOKEN: 'invalid-prefix-token',
        ANTHROPIC_API_KEY: 'sk-ant-valid-key',
        SLACK_SUMMARIZER_DB_PATH: '/tmp/test.db',
        SLACK_SUMMARIZER_LOG_LEVEL: 'info',
        SLACK_SUMMARIZER_CLAUDE_MODEL: 'claude-haiku-4-5-20251001',
        SLACK_SUMMARIZER_TIMEZONE: 'America/Los_Angeles',
        SLACK_SUMMARIZER_RATE_LIMIT: 10,
        SLACK_SUMMARIZER_ENABLE_EMBEDDINGS: false,
        SLACK_SUMMARIZER_EMBEDDING_REF_WEIGHT: 0.6,
        SLACK_SUMMARIZER_EMBEDDING_EMB_WEIGHT: 0.4,
        SLACK_SUMMARIZER_CHANNEL_CONCURRENCY: 10,
        SLACK_SUMMARIZER_CLAUDE_CONCURRENCY: 20,
        SLACK_SUMMARIZER_SLACK_CONCURRENCY: 10,
      });

      // OAuth token doesn't start with sk-ant-oat, so should use SDK
      const provider = new ClaudeProvider();
      expect(provider.getBackend().backendType).toBe('sdk');
    });

    it('should ignore API key without correct prefix', () => {
      vi.mocked(getEnv).mockReturnValue({
        SLACK_USER_TOKEN: 'xoxp-test',
        ANTHROPIC_API_KEY: 'invalid-key-format',
        SLACK_SUMMARIZER_DB_PATH: '/tmp/test.db',
        SLACK_SUMMARIZER_LOG_LEVEL: 'info',
        SLACK_SUMMARIZER_CLAUDE_MODEL: 'claude-haiku-4-5-20251001',
        SLACK_SUMMARIZER_TIMEZONE: 'America/Los_Angeles',
        SLACK_SUMMARIZER_RATE_LIMIT: 10,
        SLACK_SUMMARIZER_ENABLE_EMBEDDINGS: false,
        SLACK_SUMMARIZER_EMBEDDING_REF_WEIGHT: 0.6,
        SLACK_SUMMARIZER_EMBEDDING_EMB_WEIGHT: 0.4,
        SLACK_SUMMARIZER_CHANNEL_CONCURRENCY: 10,
        SLACK_SUMMARIZER_CLAUDE_CONCURRENCY: 20,
        SLACK_SUMMARIZER_SLACK_CONCURRENCY: 10,
      });

      // API key doesn't start with sk-ant-, so should fail
      expect(() => new ClaudeProvider()).toThrow(/No Claude credentials found/);
    });
  });

  describe('config override', () => {
    it('should prefer config values over env values', () => {
      vi.mocked(getEnv).mockReturnValue({
        SLACK_USER_TOKEN: 'xoxp-test',
        ANTHROPIC_API_KEY: 'sk-ant-env-key',
        SLACK_SUMMARIZER_DB_PATH: '/tmp/test.db',
        SLACK_SUMMARIZER_LOG_LEVEL: 'info',
        SLACK_SUMMARIZER_CLAUDE_MODEL: 'claude-haiku-4-5-20251001',
        SLACK_SUMMARIZER_TIMEZONE: 'America/Los_Angeles',
        SLACK_SUMMARIZER_RATE_LIMIT: 10,
        SLACK_SUMMARIZER_ENABLE_EMBEDDINGS: false,
        SLACK_SUMMARIZER_EMBEDDING_REF_WEIGHT: 0.6,
        SLACK_SUMMARIZER_EMBEDDING_EMB_WEIGHT: 0.4,
        SLACK_SUMMARIZER_CHANNEL_CONCURRENCY: 10,
        SLACK_SUMMARIZER_CLAUDE_CONCURRENCY: 20,
        SLACK_SUMMARIZER_SLACK_CONCURRENCY: 10,
      });

      const provider = new ClaudeProvider({
        apiKey: 'sk-ant-config-key',
      });

      // Should use config key, not env key
      const backend = provider.getBackend();
      expect((backend as unknown as { config: { apiKey: string } }).config.apiKey).toBe('sk-ant-config-key');
    });
  });

  describe('CLI path validation', () => {
    it('should reject CLI paths with shell injection characters', () => {
      vi.mocked(getEnv).mockReturnValue({
        SLACK_USER_TOKEN: 'xoxp-test',
        CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-test',
        ANTHROPIC_API_KEY: 'sk-ant-fallback',
        SLACK_SUMMARIZER_DB_PATH: '/tmp/test.db',
        SLACK_SUMMARIZER_LOG_LEVEL: 'info',
        SLACK_SUMMARIZER_CLAUDE_MODEL: 'claude-haiku-4-5-20251001',
        SLACK_SUMMARIZER_TIMEZONE: 'America/Los_Angeles',
        SLACK_SUMMARIZER_RATE_LIMIT: 10,
        SLACK_SUMMARIZER_ENABLE_EMBEDDINGS: false,
        SLACK_SUMMARIZER_EMBEDDING_REF_WEIGHT: 0.6,
        SLACK_SUMMARIZER_EMBEDDING_EMB_WEIGHT: 0.4,
        SLACK_SUMMARIZER_CHANNEL_CONCURRENCY: 10,
        SLACK_SUMMARIZER_CLAUDE_CONCURRENCY: 20,
        SLACK_SUMMARIZER_SLACK_CONCURRENCY: 10,
      });

      // Malicious CLI path - should fail validation and fall back to SDK
      const provider = new ClaudeProvider({
        cliPath: 'claude; rm -rf /',
      });

      // Should fall back to SDK due to invalid CLI path
      expect(provider.getBackend().backendType).toBe('sdk');
    });

    it('should accept valid CLI paths', () => {
      vi.mocked(getEnv).mockReturnValue({
        SLACK_USER_TOKEN: 'xoxp-test',
        CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-test',
        SLACK_SUMMARIZER_DB_PATH: '/tmp/test.db',
        SLACK_SUMMARIZER_LOG_LEVEL: 'info',
        SLACK_SUMMARIZER_CLAUDE_MODEL: 'claude-haiku-4-5-20251001',
        SLACK_SUMMARIZER_TIMEZONE: 'America/Los_Angeles',
        SLACK_SUMMARIZER_RATE_LIMIT: 10,
        SLACK_SUMMARIZER_ENABLE_EMBEDDINGS: false,
        SLACK_SUMMARIZER_EMBEDDING_REF_WEIGHT: 0.6,
        SLACK_SUMMARIZER_EMBEDDING_EMB_WEIGHT: 0.4,
        SLACK_SUMMARIZER_CHANNEL_CONCURRENCY: 10,
        SLACK_SUMMARIZER_CLAUDE_CONCURRENCY: 20,
        SLACK_SUMMARIZER_SLACK_CONCURRENCY: 10,
      });
      vi.mocked(execSync).mockReturnValue('/custom/path/to/claude');

      const provider = new ClaudeProvider({
        cliPath: '/custom/path/to/claude',
      });

      expect(provider.getBackend().backendType).toBe('cli');
    });
  });
});

describe('getClaudeProvider singleton', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetClaudeProvider();
  });

  it('should return same instance on multiple calls', () => {
    vi.mocked(getEnv).mockReturnValue({
      SLACK_USER_TOKEN: 'xoxp-test',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      SLACK_SUMMARIZER_DB_PATH: '/tmp/test.db',
      SLACK_SUMMARIZER_LOG_LEVEL: 'info',
      SLACK_SUMMARIZER_CLAUDE_MODEL: 'claude-haiku-4-5-20251001',
      SLACK_SUMMARIZER_TIMEZONE: 'America/Los_Angeles',
      SLACK_SUMMARIZER_RATE_LIMIT: 10,
      SLACK_SUMMARIZER_ENABLE_EMBEDDINGS: false,
      SLACK_SUMMARIZER_EMBEDDING_REF_WEIGHT: 0.6,
      SLACK_SUMMARIZER_EMBEDDING_EMB_WEIGHT: 0.4,
      SLACK_SUMMARIZER_CHANNEL_CONCURRENCY: 10,
      SLACK_SUMMARIZER_CLAUDE_CONCURRENCY: 20,
      SLACK_SUMMARIZER_SLACK_CONCURRENCY: 10,
    });

    const provider1 = getClaudeProvider();
    const provider2 = getClaudeProvider();

    expect(provider1).toBe(provider2);
  });

  it('should create new instance after reset', () => {
    vi.mocked(getEnv).mockReturnValue({
      SLACK_USER_TOKEN: 'xoxp-test',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      SLACK_SUMMARIZER_DB_PATH: '/tmp/test.db',
      SLACK_SUMMARIZER_LOG_LEVEL: 'info',
      SLACK_SUMMARIZER_CLAUDE_MODEL: 'claude-haiku-4-5-20251001',
      SLACK_SUMMARIZER_TIMEZONE: 'America/Los_Angeles',
      SLACK_SUMMARIZER_RATE_LIMIT: 10,
      SLACK_SUMMARIZER_ENABLE_EMBEDDINGS: false,
      SLACK_SUMMARIZER_EMBEDDING_REF_WEIGHT: 0.6,
      SLACK_SUMMARIZER_EMBEDDING_EMB_WEIGHT: 0.4,
      SLACK_SUMMARIZER_CHANNEL_CONCURRENCY: 10,
      SLACK_SUMMARIZER_CLAUDE_CONCURRENCY: 20,
      SLACK_SUMMARIZER_SLACK_CONCURRENCY: 10,
    });

    const provider1 = getClaudeProvider();
    resetClaudeProvider();
    const provider2 = getClaudeProvider();

    expect(provider1).not.toBe(provider2);
  });

  it('should use config from first call', () => {
    vi.mocked(getEnv).mockReturnValue({
      SLACK_USER_TOKEN: 'xoxp-test',
      ANTHROPIC_API_KEY: 'sk-ant-env-key',
      SLACK_SUMMARIZER_DB_PATH: '/tmp/test.db',
      SLACK_SUMMARIZER_LOG_LEVEL: 'info',
      SLACK_SUMMARIZER_CLAUDE_MODEL: 'claude-haiku-4-5-20251001',
      SLACK_SUMMARIZER_TIMEZONE: 'America/Los_Angeles',
      SLACK_SUMMARIZER_RATE_LIMIT: 10,
      SLACK_SUMMARIZER_ENABLE_EMBEDDINGS: false,
      SLACK_SUMMARIZER_EMBEDDING_REF_WEIGHT: 0.6,
      SLACK_SUMMARIZER_EMBEDDING_EMB_WEIGHT: 0.4,
      SLACK_SUMMARIZER_CHANNEL_CONCURRENCY: 10,
      SLACK_SUMMARIZER_CLAUDE_CONCURRENCY: 20,
      SLACK_SUMMARIZER_SLACK_CONCURRENCY: 10,
    });

    const provider1 = getClaudeProvider({ apiKey: 'sk-ant-first-key' });
    const provider2 = getClaudeProvider({ apiKey: 'sk-ant-second-key' });

    // Second config should be ignored
    expect(provider1).toBe(provider2);
    // Verify the first config was used
    const backend = provider1.getBackend();
    expect((backend as unknown as { config: { apiKey: string } }).config.apiKey).toBe('sk-ant-first-key');
  });
});
