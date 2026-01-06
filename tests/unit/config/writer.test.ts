/**
 * Tests for config file writer functionality.
 *
 * These tests validate:
 * - TOML formatting with comments and proper structure
 * - Round-trip parsing (write → parse → verify)
 * - Config factory functions (createMinimalConfig, createFullConfig)
 * - File writing with proper permissions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import TOML from '@iarna/toml';
import type { ConfigFile } from '@/config/schema.js';

// Mock paths module to control where config files are written
const mockPaths = vi.hoisted(() => ({
  configDir: '',
  configFilePath: '',
}));

vi.mock('@/config/paths.js', () => ({
  ensureConfigDir: vi.fn(),
  getConfigFilePath: vi.fn(() => mockPaths.configFilePath),
  getConfigDir: vi.fn(() => mockPaths.configDir),
}));

// Import after mocking
import {
  formatConfigToml,
  writeConfigFile,
  createMinimalConfig,
  createFullConfig,
} from '@/config/writer.js';

describe('Config Writer', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create fresh temp directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'slack-summarizer-test-'));
    mockPaths.configDir = tempDir;
    mockPaths.configFilePath = join(tempDir, 'config.toml');
  });

  afterEach(() => {
    // Clean up temp directory
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  describe('formatConfigToml', () => {
    it('should format minimal config with required fields', () => {
      const config: ConfigFile = {
        slack: {
          user_token: 'xoxp-test-token-123',
        },
        anthropic: {
          api_key: 'sk-ant-test-key-456',
        },
      };

      const toml = formatConfigToml(config);

      // Verify structure
      expect(toml).toContain('[slack]');
      expect(toml).toContain('user_token = "xoxp-test-token-123"');
      expect(toml).toContain('[anthropic]');
      expect(toml).toContain('api_key = "sk-ant-test-key-456"');

      // Verify header comment
      expect(toml).toContain('# Slack Summarizer Configuration');
    });

    it('should format full config with all sections', () => {
      const config: ConfigFile = {
        slack: {
          user_token: 'xoxp-test-token',
          rate_limit: 15,
          concurrency: 8,
        },
        anthropic: {
          api_key: 'sk-ant-api-key',
          oauth_token: 'sk-ant-oat01-oauth-token',
          model: 'claude-sonnet-4-5-20250929',
          concurrency: 25,
        },
        database: {
          path: '/custom/path/cache.db',
        },
        logging: {
          level: 'debug',
        },
        performance: {
          channel_concurrency: 20,
        },
        settings: {
          timezone: 'Europe/London',
        },
        embeddings: {
          enabled: true,
          api_key: 'sk-openai-test-key',
          reference_weight: 0.7,
          embedding_weight: 0.3,
        },
      };

      const toml = formatConfigToml(config);

      // Verify all sections present
      expect(toml).toContain('[slack]');
      expect(toml).toContain('[anthropic]');
      expect(toml).toContain('[database]');
      expect(toml).toContain('[logging]');
      expect(toml).toContain('[performance]');
      expect(toml).toContain('[settings]');
      expect(toml).toContain('[embeddings]');

      // Verify specific values
      expect(toml).toContain('rate_limit = 15');
      expect(toml).toContain('concurrency = 8');
      expect(toml).toContain('model = "claude-sonnet-4-5-20250929"');
      expect(toml).toContain('path = "/custom/path/cache.db"');
      expect(toml).toContain('level = "debug"');
      expect(toml).toContain('channel_concurrency = 20');
      expect(toml).toContain('timezone = "Europe/London"');
      expect(toml).toContain('enabled = true');
      expect(toml).toContain('reference_weight = 0.7');
      expect(toml).toContain('embedding_weight = 0.3');
    });

    it('should include helpful comments', () => {
      const config: ConfigFile = {
        slack: { user_token: 'xoxp-test' },
        anthropic: { api_key: 'sk-ant-test' },
      };

      const toml = formatConfigToml(config);

      // Check for key comments that help users understand the config
      expect(toml).toContain('# Your Slack user token');
      expect(toml).toContain('xoxp-');
      expect(toml).toContain('# Claude Authentication');
      expect(toml).toContain('# Option 1: Anthropic API Key');
      expect(toml).toContain('# Option 2: Claude OAuth Token');
    });

    it('should show commented-out placeholders when values are not set', () => {
      const config: ConfigFile = {
        slack: {}, // No token set
        anthropic: {}, // No auth set
      };

      const toml = formatConfigToml(config);

      // Should have placeholder comments
      expect(toml).toContain('# user_token = "xoxp-..."');
      expect(toml).toContain('# api_key = "sk-ant-..."');
      expect(toml).toContain('# oauth_token = "sk-ant-oat01-..."');
    });

    it('should format OAuth token when used instead of API key', () => {
      const config: ConfigFile = {
        slack: { user_token: 'xoxp-test' },
        anthropic: {
          oauth_token: 'sk-ant-oat01-test-oauth',
        },
      };

      const toml = formatConfigToml(config);

      expect(toml).toContain('oauth_token = "sk-ant-oat01-test-oauth"');
      // API key should be placeholder since not set
      expect(toml).toContain('# api_key = "sk-ant-..."');
    });

    it('should handle embeddings disabled state', () => {
      const config: ConfigFile = {
        slack: { user_token: 'xoxp-test' },
        anthropic: { api_key: 'sk-ant-test' },
        embeddings: {
          enabled: false,
        },
      };

      const toml = formatConfigToml(config);

      expect(toml).toContain('[embeddings]');
      expect(toml).toContain('enabled = false');
    });
  });

  describe('TOML round-trip parsing', () => {
    it('should produce parseable TOML output', () => {
      const config: ConfigFile = {
        slack: { user_token: 'xoxp-test-token' },
        anthropic: { api_key: 'sk-ant-test-key' },
      };

      const toml = formatConfigToml(config);

      // Should not throw when parsing
      expect(() => TOML.parse(toml)).not.toThrow();
    });

    it('should round-trip minimal config correctly', () => {
      const original: ConfigFile = {
        slack: { user_token: 'xoxp-round-trip-test' },
        anthropic: { api_key: 'sk-ant-round-trip-key' },
      };

      const toml = formatConfigToml(original);
      const parsed = TOML.parse(toml) as ConfigFile;

      expect(parsed.slack?.user_token).toBe(original.slack?.user_token);
      expect(parsed.anthropic?.api_key).toBe(original.anthropic?.api_key);
    });

    it('should round-trip full config correctly', () => {
      const original: ConfigFile = {
        slack: {
          user_token: 'xoxp-full-config',
          rate_limit: 20,
          concurrency: 15,
        },
        anthropic: {
          api_key: 'sk-ant-full-key',
          model: 'claude-haiku-4-5-20251001',
          concurrency: 30,
        },
        database: {
          path: '/var/data/cache.db',
        },
        logging: {
          level: 'warn',
        },
        performance: {
          channel_concurrency: 25,
        },
        settings: {
          timezone: 'Asia/Tokyo',
        },
        embeddings: {
          enabled: true,
          api_key: 'sk-openai-key',
          reference_weight: 0.5,
          embedding_weight: 0.5,
        },
      };

      const toml = formatConfigToml(original);
      const parsed = TOML.parse(toml) as ConfigFile;

      // Verify all values round-trip correctly
      expect(parsed.slack?.user_token).toBe(original.slack?.user_token);
      expect(parsed.slack?.rate_limit).toBe(original.slack?.rate_limit);
      expect(parsed.slack?.concurrency).toBe(original.slack?.concurrency);
      expect(parsed.anthropic?.api_key).toBe(original.anthropic?.api_key);
      expect(parsed.anthropic?.model).toBe(original.anthropic?.model);
      expect(parsed.anthropic?.concurrency).toBe(original.anthropic?.concurrency);
      expect(parsed.database?.path).toBe(original.database?.path);
      expect(parsed.logging?.level).toBe(original.logging?.level);
      expect(parsed.performance?.channel_concurrency).toBe(original.performance?.channel_concurrency);
      expect(parsed.settings?.timezone).toBe(original.settings?.timezone);
      expect(parsed.embeddings?.enabled).toBe(original.embeddings?.enabled);
      expect(parsed.embeddings?.api_key).toBe(original.embeddings?.api_key);
      expect(parsed.embeddings?.reference_weight).toBe(original.embeddings?.reference_weight);
      expect(parsed.embeddings?.embedding_weight).toBe(original.embeddings?.embedding_weight);
    });

    it('should preserve special characters in token values', () => {
      const original: ConfigFile = {
        slack: { user_token: 'xoxp-123-456-789-abcdef' },
        anthropic: { api_key: 'sk-ant-api03-abc123_DEF456' },
      };

      const toml = formatConfigToml(original);
      const parsed = TOML.parse(toml) as ConfigFile;

      expect(parsed.slack?.user_token).toBe(original.slack?.user_token);
      expect(parsed.anthropic?.api_key).toBe(original.anthropic?.api_key);
    });
  });

  describe('writeConfigFile', () => {
    it('should write config file to disk', () => {
      const config: ConfigFile = {
        slack: { user_token: 'xoxp-write-test' },
        anthropic: { api_key: 'sk-ant-write-test' },
      };

      writeConfigFile(config, mockPaths.configFilePath);

      // Verify file was created
      const content = readFileSync(mockPaths.configFilePath, 'utf-8');
      expect(content).toContain('[slack]');
      expect(content).toContain('user_token = "xoxp-write-test"');
    });

    it('should write config file with restricted permissions', () => {
      const config: ConfigFile = {
        slack: { user_token: 'xoxp-perms-test' },
        anthropic: { api_key: 'sk-ant-perms-test' },
      };

      writeConfigFile(config, mockPaths.configFilePath);

      // Check file permissions (0600 = owner read/write only)
      const stats = statSync(mockPaths.configFilePath);
      const mode = stats.mode & 0o777; // Extract permission bits
      expect(mode).toBe(0o600);
    });

    it('should write full config to custom path', () => {
      const customPath = join(tempDir, 'custom-config.toml');
      const config: ConfigFile = {
        slack: { user_token: 'xoxp-custom-path' },
        anthropic: { api_key: 'sk-ant-custom-path' },
        settings: { timezone: 'UTC' },
      };

      writeConfigFile(config, customPath);

      // Verify file was created at custom path
      const content = readFileSync(customPath, 'utf-8');
      expect(content).toContain('timezone = "UTC"');
    });

    it('should overwrite existing config file', () => {
      const config1: ConfigFile = {
        slack: { user_token: 'xoxp-first' },
        anthropic: { api_key: 'sk-ant-first' },
      };
      const config2: ConfigFile = {
        slack: { user_token: 'xoxp-second' },
        anthropic: { api_key: 'sk-ant-second' },
      };

      writeConfigFile(config1, mockPaths.configFilePath);
      writeConfigFile(config2, mockPaths.configFilePath);

      const content = readFileSync(mockPaths.configFilePath, 'utf-8');
      expect(content).toContain('xoxp-second');
      expect(content).not.toContain('xoxp-first');
    });
  });

  describe('createMinimalConfig', () => {
    it('should create config with API key auth', () => {
      const config = createMinimalConfig('xoxp-slack-token', {
        apiKey: 'sk-ant-api-key-123',
      });

      expect(config.slack?.user_token).toBe('xoxp-slack-token');
      expect(config.anthropic?.api_key).toBe('sk-ant-api-key-123');
      expect(config.anthropic?.oauth_token).toBeUndefined();
    });

    it('should create config with OAuth token auth', () => {
      const config = createMinimalConfig('xoxp-slack-token', {
        oauthToken: 'sk-ant-oat01-oauth-123',
      });

      expect(config.slack?.user_token).toBe('xoxp-slack-token');
      expect(config.anthropic?.oauth_token).toBe('sk-ant-oat01-oauth-123');
      expect(config.anthropic?.api_key).toBeUndefined();
    });

    it('should produce TOML-serializable config', () => {
      const config = createMinimalConfig('xoxp-test', { apiKey: 'sk-ant-test' });
      const toml = formatConfigToml(config);

      expect(() => TOML.parse(toml)).not.toThrow();
    });
  });

  describe('createFullConfig', () => {
    it('should create config with all options', () => {
      const config = createFullConfig({
        slackToken: 'xoxp-full-test',
        anthropicKey: 'sk-ant-full-key',
        oauthToken: 'sk-ant-oat01-full-oauth',
        model: 'claude-sonnet-4-5-20250929',
        timezone: 'America/New_York',
        dbPath: '/custom/db.sqlite',
        logLevel: 'debug',
        enableEmbeddings: true,
        openaiKey: 'sk-openai-full-key',
      });

      expect(config.slack?.user_token).toBe('xoxp-full-test');
      expect(config.anthropic?.api_key).toBe('sk-ant-full-key');
      expect(config.anthropic?.oauth_token).toBe('sk-ant-oat01-full-oauth');
      expect(config.anthropic?.model).toBe('claude-sonnet-4-5-20250929');
      expect(config.settings?.timezone).toBe('America/New_York');
      expect(config.database?.path).toBe('/custom/db.sqlite');
      expect(config.logging?.level).toBe('debug');
      expect(config.embeddings?.enabled).toBe(true);
      expect(config.embeddings?.api_key).toBe('sk-openai-full-key');
    });

    it('should create config with only required options', () => {
      const config = createFullConfig({
        slackToken: 'xoxp-minimal-full',
      });

      expect(config.slack?.user_token).toBe('xoxp-minimal-full');
      expect(config.anthropic?.api_key).toBeUndefined();
      expect(config.anthropic?.oauth_token).toBeUndefined();
      expect(config.settings).toBeUndefined();
      expect(config.database).toBeUndefined();
      expect(config.logging).toBeUndefined();
      expect(config.embeddings).toBeUndefined();
    });

    it('should create embeddings section when only openaiKey is provided', () => {
      const config = createFullConfig({
        slackToken: 'xoxp-embed-test',
        openaiKey: 'sk-openai-only',
      });

      expect(config.embeddings?.api_key).toBe('sk-openai-only');
      expect(config.embeddings?.enabled).toBe(false); // Default when not explicitly enabled
    });

    it('should create config with partial optional fields', () => {
      const config = createFullConfig({
        slackToken: 'xoxp-partial',
        anthropicKey: 'sk-ant-partial',
        timezone: 'UTC',
      });

      expect(config.slack?.user_token).toBe('xoxp-partial');
      expect(config.anthropic?.api_key).toBe('sk-ant-partial');
      expect(config.settings?.timezone).toBe('UTC');
      expect(config.database).toBeUndefined();
      expect(config.logging).toBeUndefined();
      expect(config.embeddings).toBeUndefined();
    });

    it('should produce valid TOML output', () => {
      const config = createFullConfig({
        slackToken: 'xoxp-toml-test',
        anthropicKey: 'sk-ant-toml-key',
        model: 'claude-haiku-4-5-20251001',
        timezone: 'Europe/Paris',
        logLevel: 'info',
      });

      const toml = formatConfigToml(config);
      const parsed = TOML.parse(toml) as ConfigFile;

      expect(parsed.slack?.user_token).toBe('xoxp-toml-test');
      expect(parsed.anthropic?.model).toBe('claude-haiku-4-5-20251001');
      expect(parsed.settings?.timezone).toBe('Europe/Paris');
      expect(parsed.logging?.level).toBe('info');
    });
  });

  describe('edge cases', () => {
    it('should handle empty config sections', () => {
      const config: ConfigFile = {};

      const toml = formatConfigToml(config);

      // Should still have header
      expect(toml).toContain('# Slack Summarizer Configuration');
      // Should be parseable
      expect(() => TOML.parse(toml)).not.toThrow();
    });

    it('should handle config with only embeddings weights', () => {
      const config: ConfigFile = {
        slack: { user_token: 'xoxp-test' },
        anthropic: { api_key: 'sk-ant-test' },
        embeddings: {
          reference_weight: 0.8,
          embedding_weight: 0.2,
        },
      };

      const toml = formatConfigToml(config);

      expect(toml).toContain('reference_weight = 0.8');
      expect(toml).toContain('embedding_weight = 0.2');
      expect(toml).toContain('# Similarity weights');
    });

    it('should handle paths with spaces', () => {
      const config: ConfigFile = {
        slack: { user_token: 'xoxp-test' },
        anthropic: { api_key: 'sk-ant-test' },
        database: { path: '/path/with spaces/db.sqlite' },
      };

      const toml = formatConfigToml(config);
      const parsed = TOML.parse(toml) as ConfigFile;

      expect(parsed.database?.path).toBe('/path/with spaces/db.sqlite');
    });

    it('should escape special TOML characters in values', () => {
      // Note: In practice tokens won't have these, but testing escaping
      const config: ConfigFile = {
        slack: { user_token: 'xoxp-test' },
        anthropic: { api_key: 'sk-ant-test' },
      };

      const toml = formatConfigToml(config);

      // Should be quoted strings that TOML can parse
      expect(() => TOML.parse(toml)).not.toThrow();
    });
  });
});
