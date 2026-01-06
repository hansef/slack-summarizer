/**
 * Tests for the Claude CLI backend.
 *
 * The ClaudeCliBackend:
 * 1. Spawns the claude CLI with OAuth token
 * 2. Runs from a temp directory for isolation
 * 3. Parses JSON responses from the CLI
 * 4. Handles timeouts and errors
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess, Serializable } from 'child_process';
import type { Readable, Writable } from 'stream';

// Mock child_process
const mockSpawn = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]): unknown => mockSpawn(...args),
}));

// Mock fs - only mock what claude-cli.ts needs, let other modules use real fs
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
  };
});

// Mock os - include homedir for config loader
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    tmpdir: vi.fn().mockReturnValue('/tmp'),
  };
});

// Import after mocks
import { ClaudeCliBackend } from '@/core/llm/backends/claude-cli.js';

/**
 * Creates a mock ChildProcess with configurable behavior
 */
function createMockProcess(options: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: Error;
}) {
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();

  const proc = Object.assign(new EventEmitter(), {
    stdin: { end: vi.fn() } as unknown as Writable,
    stdout: stdoutEmitter as unknown as Readable,
    stderr: stderrEmitter as unknown as Readable,
    kill: vi.fn().mockReturnValue(true),
    pid: 12345,
    connected: false,
    exitCode: null,
    signalCode: null,
    spawnargs: [],
    spawnfile: 'claude',
    killed: false,
    ref: vi.fn(),
    unref: vi.fn(),
    disconnect: vi.fn(),
    send: vi.fn() as (message: Serializable) => boolean,
    channel: null,
    stdio: [null, null, null, null, null] as unknown as ChildProcess['stdio'],
    [Symbol.dispose]: vi.fn(),
  }) as ChildProcess;

  // Schedule the events using setImmediate for proper sequencing
  setImmediate(() => {
    if (options.error) {
      proc.emit('error', options.error);
    } else {
      if (options.stderr) {
        stderrEmitter.emit('data', Buffer.from(options.stderr));
      }
      if (options.stdout) {
        stdoutEmitter.emit('data', Buffer.from(options.stdout));
      }
      setImmediate(() => {
        proc.emit('close', options.exitCode ?? 0);
      });
    }
  });

  return proc;
}

describe('ClaudeCliBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create backend with OAuth token', () => {
      const backend = new ClaudeCliBackend({ oauthToken: 'sk-ant-oat01-test' });
      expect(backend).toBeDefined();
      expect(backend.backendType).toBe('cli');
    });

    it('should accept custom CLI path', () => {
      const backend = new ClaudeCliBackend({
        oauthToken: 'sk-ant-oat01-test',
        cliPath: '/custom/path/claude',
      });
      expect(backend).toBeDefined();
    });
  });

  describe('createMessage', () => {
    it('should spawn CLI with correct arguments', async () => {
      const mockResponse = JSON.stringify({
        type: 'result',
        result: 'Hello from Claude CLI!',
      });

      mockSpawn.mockReturnValue(
        createMockProcess({
          stdout: mockResponse,
          exitCode: 0,
        })
      );

      const backend = new ClaudeCliBackend({ oauthToken: 'sk-ant-oat01-test' });

      const response = await backend.createMessage({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining([
          '-p',
          'Hello',
          '--model',
          'claude-haiku-4-5-20251001',
          '--output-format',
          'json',
          '--no-session-persistence',
        ]),
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          cwd: expect.stringContaining('slack-summarizer-claude'),
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          env: expect.objectContaining({
            CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-test',
            ANTHROPIC_API_KEY: '',
          }),
        })
      );

      expect(response.content).toHaveLength(1);
      expect(response.content[0].text).toBe('Hello from Claude CLI!');
    });

    it('should concatenate multiple messages into single prompt', async () => {
      const mockResponse = JSON.stringify({
        type: 'result',
        result: 'Multi-message response',
      });

      mockSpawn.mockReturnValue(
        createMockProcess({
          stdout: mockResponse,
          exitCode: 0,
        })
      );

      const backend = new ClaudeCliBackend({ oauthToken: 'sk-ant-oat01-test' });

      await backend.createMessage({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [
          { role: 'user', content: 'First message' },
          { role: 'assistant', content: 'First response' },
          { role: 'user', content: 'Second message' },
        ],
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining([
          '-p',
          'First message\n\nFirst response\n\nSecond message',
        ]),
        expect.anything()
      );
    });

    it('should parse JSON response with result field', async () => {
      mockSpawn.mockReturnValue(
        createMockProcess({
          stdout: JSON.stringify({ type: 'result', result: 'The answer is 42' }),
          exitCode: 0,
        })
      );

      const backend = new ClaudeCliBackend({ oauthToken: 'sk-ant-oat01-test' });

      const response = await backend.createMessage({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{ role: 'user', content: 'What is the meaning?' }],
      });

      expect(response.content[0].text).toBe('The answer is 42');
    });

    it('should parse JSON response with text field', async () => {
      mockSpawn.mockReturnValue(
        createMockProcess({
          stdout: JSON.stringify({ type: 'message', text: 'Alternative format' }),
          exitCode: 0,
        })
      );

      const backend = new ClaudeCliBackend({ oauthToken: 'sk-ant-oat01-test' });

      const response = await backend.createMessage({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(response.content[0].text).toBe('Alternative format');
    });

    it('should parse JSON response with response field', async () => {
      mockSpawn.mockReturnValue(
        createMockProcess({
          stdout: JSON.stringify({ type: 'output', response: 'Yet another format' }),
          exitCode: 0,
        })
      );

      const backend = new ClaudeCliBackend({ oauthToken: 'sk-ant-oat01-test' });

      const response = await backend.createMessage({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(response.content[0].text).toBe('Yet another format');
    });

    it('should stringify non-string result values', async () => {
      mockSpawn.mockReturnValue(
        createMockProcess({
          stdout: JSON.stringify({ type: 'result', result: { key: 'value' } }),
          exitCode: 0,
        })
      );

      const backend = new ClaudeCliBackend({ oauthToken: 'sk-ant-oat01-test' });

      const response = await backend.createMessage({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(response.content[0].text).toBe('{"key":"value"}');
    });

    it('should fallback to raw output on invalid JSON', async () => {
      mockSpawn.mockReturnValue(
        createMockProcess({
          stdout: 'Just plain text response',
          exitCode: 0,
        })
      );

      const backend = new ClaudeCliBackend({ oauthToken: 'sk-ant-oat01-test' });

      const response = await backend.createMessage({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(response.content[0].text).toBe('Just plain text response');
    });

    it('should reject on non-zero exit code', async () => {
      mockSpawn.mockReturnValue(
        createMockProcess({
          stdout: '',
          stderr: 'Authentication failed',
          exitCode: 1,
        })
      );

      const backend = new ClaudeCliBackend({ oauthToken: 'sk-ant-oat01-bad' });

      await expect(
        backend.createMessage({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1000,
          messages: [{ role: 'user', content: 'Hello' }],
        })
      ).rejects.toThrow('Claude CLI exited with code 1');
    });

    it('should reject on empty response', async () => {
      mockSpawn.mockReturnValue(
        createMockProcess({
          stdout: '',
          stderr: '',
          exitCode: 0,
        })
      );

      const backend = new ClaudeCliBackend({ oauthToken: 'sk-ant-oat01-test' });

      await expect(
        backend.createMessage({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1000,
          messages: [{ role: 'user', content: 'Hello' }],
        })
      ).rejects.toThrow('Claude CLI returned empty response');
    });

    it('should reject on spawn error', async () => {
      mockSpawn.mockReturnValue(
        createMockProcess({
          error: new Error('ENOENT: command not found'),
        })
      );

      const backend = new ClaudeCliBackend({ oauthToken: 'sk-ant-oat01-test' });

      await expect(
        backend.createMessage({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1000,
          messages: [{ role: 'user', content: 'Hello' }],
        })
      ).rejects.toThrow('Failed to spawn claude CLI');
    });

    it('should use custom CLI path when provided', async () => {
      mockSpawn.mockReturnValue(
        createMockProcess({
          stdout: JSON.stringify({ type: 'result', result: 'Custom path works' }),
          exitCode: 0,
        })
      );

      const backend = new ClaudeCliBackend({
        oauthToken: 'sk-ant-oat01-test',
        cliPath: '/opt/bin/claude-custom',
      });

      await backend.createMessage({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        '/opt/bin/claude-custom',
        expect.any(Array),
        expect.anything()
      );
    });
  });
});
