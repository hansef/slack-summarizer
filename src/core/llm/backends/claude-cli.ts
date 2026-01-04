/**
 * Claude backend implementation using claude CLI via child_process.
 * Uses OAuth tokens (sk-ant-oat01-...) via CLAUDE_CODE_OAUTH_TOKEN.
 *
 * Runs from a temp directory to avoid polluting user's Claude Code sessions.
 */

import { spawn } from 'child_process';
import { mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { logger } from '../../../utils/logger.js';
import type { ClaudeBackend, MessageCreateParams, MessageResponse } from '../types.js';

export interface ClaudeCliConfig {
  oauthToken: string;
  cliPath?: string; // Default: 'claude' (assumes in PATH)
}

// Temp directory for isolated CLI sessions
const CLI_TEMP_DIR = join(tmpdir(), 'slack-summarizer-claude');

export class ClaudeCliBackend implements ClaudeBackend {
  private oauthToken: string;
  private cliPath: string;
  readonly backendType = 'cli' as const;

  constructor(config: ClaudeCliConfig) {
    this.oauthToken = config.oauthToken;
    this.cliPath = config.cliPath ?? 'claude';
    logger.debug('Initialized Claude CLI backend', { cliPath: this.cliPath });

    // Ensure temp directory exists
    if (!existsSync(CLI_TEMP_DIR)) {
      mkdirSync(CLI_TEMP_DIR, { recursive: true });
    }
  }

  async createMessage(params: MessageCreateParams): Promise<MessageResponse> {
    logger.debug('Creating message via Claude CLI', {
      model: params.model,
      max_tokens: params.max_tokens,
      messageCount: params.messages.length,
    });

    // Build prompt from messages array (CLI expects single prompt via stdin)
    const prompt = params.messages.map((msg) => msg.content).join('\n\n');

    // Invoke claude CLI and get response
    const response = await this.invokeCli({
      prompt,
      model: params.model,
      maxTokens: params.max_tokens,
    });

    // Parse JSON response from CLI
    return this.parseCliResponse(response);
  }

  /**
   * Invoke claude CLI and return stdout
   */
  private async invokeCli(opts: {
    prompt: string;
    model: string;
    maxTokens: number;
  }): Promise<string> {
    // Timeout after 5 minutes
    const TIMEOUT_MS = 5 * 60 * 1000;

    return new Promise((resolve, reject) => {
      // Build args for claude -p
      // Note: --tools "" disables all tools for pure text completion
      const args = [
        '-p', // Print mode (non-interactive)
        opts.prompt,
        '--model',
        opts.model,
        '--output-format',
        'json', // Request JSON output for structured parsing
        '--no-session-persistence', // Don't save session history
      ];

      logger.debug('Spawning claude CLI', {
        model: opts.model,
        promptLength: opts.prompt.length,
      });

      const child = spawn(this.cliPath, args, {
        cwd: CLI_TEMP_DIR, // Run from temp dir to avoid polluting user's project sessions
        env: {
          ...process.env,
          CLAUDE_CODE_OAUTH_TOKEN: this.oauthToken,
          // Clear API key to ensure OAuth is used
          ANTHROPIC_API_KEY: '',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Close stdin immediately - we're passing prompt via args, not stdin
      child.stdin.end();

      // Set up timeout to kill hung processes
      const timeout = setTimeout(() => {
        logger.error('Claude CLI timeout', {
          model: opts.model,
          promptLength: opts.prompt.length,
        });
        child.kill('SIGTERM');
        reject(new Error(`Claude CLI timed out after ${TIMEOUT_MS / 1000}s`));
      }, TIMEOUT_MS);

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
        // Log stderr in real-time for debugging
        logger.debug('Claude CLI stderr', { chunk: data.toString().substring(0, 200) });
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          logger.error('Claude CLI failed', {
            code,
            stderr: stderr.substring(0, 500),
          });
          reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
        } else {
          logger.debug('Claude CLI completed', { stdoutLength: stdout.length });
          resolve(stdout);
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        logger.error('Failed to spawn claude CLI', { error: err.message });
        reject(new Error(`Failed to spawn claude CLI: ${err.message}`));
      });
    });
  }

  /**
   * Parse JSON response from claude CLI to unified format.
   *
   * The CLI with --output-format json returns:
   * {
   *   "type": "result",
   *   "result": "the actual text response",
   *   ...metadata
   * }
   */
  private parseCliResponse(stdout: string): MessageResponse {
    try {
      const parsed = JSON.parse(stdout) as Record<string, unknown>;

      // CLI returns { type: "result", result: "text", ... }
      const rawText = parsed.result ?? parsed.text ?? parsed.response ?? stdout;
      const text = typeof rawText === 'string' ? rawText : JSON.stringify(rawText);

      return {
        content: [
          {
            type: 'text' as const,
            text,
          },
        ],
      };
    } catch (error) {
      logger.warn('Failed to parse CLI JSON response, using raw output', {
        error: error instanceof Error ? error.message : String(error),
        stdoutPreview: stdout.substring(0, 200),
      });

      // Fallback: treat entire stdout as text response
      return {
        content: [{ type: 'text' as const, text: stdout.trim() }],
      };
    }
  }
}
