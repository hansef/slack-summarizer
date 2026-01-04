/**
 * Shared validation utilities for credential testing.
 * Extracted from SetupScreen for reuse in SettingsScreen.
 */

import { WebClient } from '@slack/web-api';
import Anthropic from '@anthropic-ai/sdk';
import { spawn, execSync } from 'child_process';
import { mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Temp directory for isolated CLI sessions (matches claude-cli.ts pattern)
const CLI_TEMP_DIR = join(tmpdir(), 'slack-summarizer-claude');

export interface ValidationResult {
  success: boolean;
  error?: string;
  /** Additional data from successful validation */
  metadata?: {
    userId?: string;
    userName?: string;
  };
}

/**
 * Check if claude CLI is available in PATH.
 */
export function isClaudeCliAvailable(): boolean {
  try {
    execSync('which claude', { encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a Slack user token by testing the API connection.
 * Returns user info on success.
 */
export async function validateSlackToken(token: string): Promise<ValidationResult> {
  // Format validation
  if (!token.startsWith('xoxp-')) {
    return { success: false, error: 'Token must start with xoxp-' };
  }

  try {
    const client = new WebClient(token);
    const auth = await client.auth.test();

    if (!auth.ok || !auth.user_id) {
      return { success: false, error: 'Authentication failed' };
    }

    const userInfo = await client.users.info({ user: auth.user_id });
    const userName =
      userInfo.user?.profile?.display_name ||
      userInfo.user?.profile?.real_name ||
      userInfo.user?.name ||
      'Unknown';

    return {
      success: true,
      metadata: {
        userId: auth.user_id,
        userName,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: `Slack connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
    };
  }
}

/**
 * Validate an Anthropic API key by making a minimal API call.
 */
export async function validateAnthropicApiKey(apiKey: string): Promise<ValidationResult> {
  // Format validation
  if (!apiKey.startsWith('sk-ant-')) {
    return { success: false, error: 'API key must start with sk-ant-' };
  }

  try {
    const anthropic = new Anthropic({ apiKey });
    await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Say "ok"' }],
    });

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: `Anthropic connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
    };
  }
}

/**
 * Validate a Claude OAuth token by making a minimal CLI call.
 */
export async function validateClaudeOAuthToken(oauthToken: string): Promise<ValidationResult> {
  // Format validation
  if (!oauthToken.startsWith('sk-ant-oat')) {
    return { success: false, error: 'OAuth token must start with sk-ant-oat' };
  }

  // Ensure temp directory exists (matches claude-cli.ts pattern)
  if (!existsSync(CLI_TEMP_DIR)) {
    mkdirSync(CLI_TEMP_DIR, { recursive: true });
  }

  return new Promise((resolve) => {
    const child = spawn('claude', ['-p', 'Say "ok"', '--output-format', 'json'], {
      cwd: CLI_TEMP_DIR, // Run from temp dir to avoid polluting user's project sessions
      env: {
        ...process.env,
        CLAUDE_CODE_OAUTH_TOKEN: oauthToken,
        ANTHROPIC_API_KEY: '',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    // Close stdin immediately - claude CLI doesn't need input for -p flag
    child.stdin.end();

    // Set a timeout to avoid hanging forever
    const timeout = setTimeout(() => {
      child.kill();
      resolve({ success: false, error: 'OAuth test timed out after 30 seconds' });
    }, 30000);

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        // Use stderr if available, otherwise stdout, otherwise generic message
        resolve({ success: false, error: stderr || stdout || `CLI exited with code ${code}` });
      } else {
        resolve({ success: true });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ success: false, error: `Failed to spawn claude CLI: ${err.message}` });
    });
  });
}

/**
 * Validate an OpenAI API key by making a test embeddings request.
 */
export async function validateOpenAIKey(apiKey: string): Promise<ValidationResult> {
  // Format validation
  if (!apiKey.startsWith('sk-')) {
    return { success: false, error: 'API key must start with sk-' };
  }

  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: 'test',
      }),
    });

    if (!response.ok) {
      const errorData = (await response.json()) as { error?: { message?: string } };
      const message = errorData.error?.message || 'API request failed';
      // Provide more specific error messages based on status code
      if (response.status === 401) {
        return { success: false, error: `OpenAI authentication failed: ${message}` };
      } else if (response.status === 429) {
        return { success: false, error: `OpenAI rate limit exceeded: ${message}` };
      }
      return { success: false, error: `OpenAI API error: ${message}` };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: `OpenAI connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
    };
  }
}
