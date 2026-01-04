/**
 * Factory for creating and managing Claude backend instances.
 * Automatically selects backend based on available credentials.
 *
 * Priority:
 * 1. OAuth token (CLAUDE_CODE_OAUTH_TOKEN) → CLI backend
 * 2. API key (ANTHROPIC_API_KEY) → SDK backend
 */

import { execSync } from 'child_process';
import { logger } from '../../utils/logger.js';
import type { ClaudeBackend } from './types.js';
import { AnthropicSdkBackend } from './backends/anthropic-sdk.js';
import { ClaudeCliBackend } from './backends/claude-cli.js';

export interface ClaudeProviderConfig {
  // Explicit backend selection (optional, auto-detected if not provided)
  backend?: 'sdk' | 'cli';

  // SDK credentials
  apiKey?: string;

  // CLI credentials
  oauthToken?: string;
  cliPath?: string;
}

export class ClaudeProvider {
  private backend: ClaudeBackend;

  constructor(config: ClaudeProviderConfig = {}) {
    this.backend = this.createBackend(config);
  }

  /**
   * Get the active backend instance
   */
  getBackend(): ClaudeBackend {
    return this.backend;
  }

  /**
   * Create appropriate backend based on config and environment
   */
  private createBackend(config: ClaudeProviderConfig): ClaudeBackend {
    // Explicit backend selection
    if (config.backend === 'sdk') {
      return this.createSdkBackend(config);
    }
    if (config.backend === 'cli') {
      return this.createCliBackend(config);
    }

    // Auto-detect based on credentials
    const oauthToken = config.oauthToken ?? process.env.CLAUDE_CODE_OAUTH_TOKEN;
    const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;

    // Prioritize OAuth if present (assume user wants CLI if they set OAuth token)
    if (oauthToken && oauthToken.startsWith('sk-ant-oat')) {
      // Verify claude CLI is available
      if (!this.isClaudeCliAvailable(config.cliPath)) {
        if (apiKey && apiKey.startsWith('sk-ant-')) {
          logger.warn(
            'OAuth token found but claude CLI not available, falling back to SDK backend'
          );
          return this.createSdkBackend({ ...config, apiKey });
        }
        throw new Error(
          'CLAUDE_CODE_OAUTH_TOKEN is set but `claude` CLI not found in PATH.\n' +
            'Install Claude Code: npm install -g @anthropic-ai/claude-code\n' +
            'Or set ANTHROPIC_API_KEY to use the SDK backend instead.'
        );
      }
      logger.info('Using Claude CLI backend (OAuth token detected)');
      return this.createCliBackend({ ...config, oauthToken });
    }

    if (apiKey && apiKey.startsWith('sk-ant-')) {
      logger.info('Using Anthropic SDK backend (API key detected)');
      return this.createSdkBackend({ ...config, apiKey });
    }

    // No valid credentials found
    throw new Error(
      'No Claude credentials found. Set one of:\n' +
        '  - CLAUDE_CODE_OAUTH_TOKEN (format: sk-ant-oat01-...) for OAuth/subscription\n' +
        '  - ANTHROPIC_API_KEY (format: sk-ant-...) for API key\n\n' +
        'Run `slack-summarizer configure` to set up credentials.'
    );
  }

  private createSdkBackend(config: ClaudeProviderConfig): ClaudeBackend {
    const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY required for SDK backend');
    }
    return new AnthropicSdkBackend({ apiKey });
  }

  private createCliBackend(config: ClaudeProviderConfig): ClaudeBackend {
    const oauthToken = config.oauthToken ?? process.env.CLAUDE_CODE_OAUTH_TOKEN;
    if (!oauthToken) {
      throw new Error('CLAUDE_CODE_OAUTH_TOKEN required for CLI backend');
    }
    return new ClaudeCliBackend({
      oauthToken,
      cliPath: config.cliPath,
    });
  }

  private isClaudeCliAvailable(cliPath?: string): boolean {
    const cli = cliPath ?? 'claude';
    // Validate CLI path to prevent shell injection
    if (!/^[a-zA-Z0-9_\-/.]+$/.test(cli)) {
      logger.warn('Invalid CLI path characters, rejecting', { cliPath: cli });
      return false;
    }
    try {
      execSync(`which ${cli}`, { encoding: 'utf-8', stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton instance
let globalProvider: ClaudeProvider | null = null;

/**
 * Get or create the global Claude provider singleton
 */
export function getClaudeProvider(config?: ClaudeProviderConfig): ClaudeProvider {
  if (!globalProvider) {
    globalProvider = new ClaudeProvider(config);
  }
  return globalProvider;
}

/**
 * Reset the global provider (for testing)
 */
export function resetClaudeProvider(): void {
  globalProvider = null;
}
