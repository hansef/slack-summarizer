/**
 * Tests for TUI credential validators.
 *
 * The validators check:
 * 1. Token/key format validation (prefix checking)
 * 2. API connectivity (mocked in tests)
 * 3. Error handling for various failure modes
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  validateSlackToken,
  validateAnthropicApiKey,
  validateClaudeOAuthToken,
  validateOpenAIKey,
  isClaudeCliAvailable,
} from '@/cli/tui/utils/validators.js';

// Mock @slack/web-api
vi.mock('@slack/web-api', () => ({
  WebClient: vi.fn().mockImplementation(() => ({
    auth: {
      test: vi.fn().mockResolvedValue({ ok: true, user_id: 'U123' }),
    },
    users: {
      info: vi.fn().mockResolvedValue({
        user: {
          profile: {
            display_name: 'Test User',
            real_name: 'Test User Real Name',
          },
          name: 'testuser',
        },
      }),
    },
  })),
}));

// Mock @anthropic-ai/sdk
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
      }),
    },
  })),
}));

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn().mockReturnValue('/usr/local/bin/claude'),
  spawn: vi.fn().mockImplementation(() => {
    type DataHandler = (data: Buffer) => void;
    const handlers: Record<string, DataHandler[]> = {};
    return {
      stdin: { end: vi.fn() },
      stdout: {
        on: vi.fn((event: string, handler: DataHandler) => {
          if (!handlers[`stdout-${event}`]) handlers[`stdout-${event}`] = [];
          handlers[`stdout-${event}`].push(handler);
          if (event === 'data') {
            // Simulate successful response
            setTimeout(() => handler(Buffer.from('{"result": "ok"}')), 10);
          }
        }),
      },
      stderr: {
        on: vi.fn((event: string, handler: DataHandler) => {
          if (!handlers[`stderr-${event}`]) handlers[`stderr-${event}`] = [];
          handlers[`stderr-${event}`].push(handler);
        }),
      },
      on: vi.fn((event: string, handler: (code?: number) => void) => {
        if (event === 'close') {
          setTimeout(() => handler(0), 20);
        }
      }),
      kill: vi.fn(),
    };
  }),
}));

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
  };
});

// Mock fetch for OpenAI validation
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('isClaudeCliAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return true when claude CLI is in PATH', () => {
    expect(isClaudeCliAvailable()).toBe(true);
  });

  it('should return false when claude CLI is not found', async () => {
    const { execSync } = await import('child_process');
    vi.mocked(execSync).mockImplementationOnce(() => {
      throw new Error('command not found');
    });

    expect(isClaudeCliAvailable()).toBe(false);
  });
});

describe('validateSlackToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reject tokens without xoxp- prefix', async () => {
    const result = await validateSlackToken('invalid-token');
    expect(result.success).toBe(false);
    expect(result.error).toContain('xoxp-');
  });

  it('should reject xoxb- tokens', async () => {
    const result = await validateSlackToken('xoxb-bot-token');
    expect(result.success).toBe(false);
    expect(result.error).toContain('xoxp-');
  });

  it('should accept valid xoxp- token and return user info', async () => {
    const result = await validateSlackToken('xoxp-valid-token');
    expect(result.success).toBe(true);
    expect(result.metadata?.userId).toBe('U123');
    expect(result.metadata?.userName).toBe('Test User');
  });

  it('should handle authentication failure', async () => {
    const { WebClient } = await import('@slack/web-api');
    vi.mocked(WebClient).mockImplementationOnce(() => ({
      auth: {
        test: vi.fn().mockResolvedValue({ ok: false }),
      },
    } as never));

    const result = await validateSlackToken('xoxp-bad-token');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Authentication failed');
  });

  it('should handle connection errors', async () => {
    const { WebClient } = await import('@slack/web-api');
    vi.mocked(WebClient).mockImplementationOnce(() => ({
      auth: {
        test: vi.fn().mockRejectedValue(new Error('Network error')),
      },
    } as never));

    const result = await validateSlackToken('xoxp-error-token');
    expect(result.success).toBe(false);
    expect(result.error).toContain('connection failed');
  });
});

describe('validateAnthropicApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reject keys without sk-ant- prefix', async () => {
    const result = await validateAnthropicApiKey('invalid-key');
    expect(result.success).toBe(false);
    expect(result.error).toContain('sk-ant-');
  });

  it('should accept valid API key', async () => {
    const result = await validateAnthropicApiKey('sk-ant-valid-key');
    expect(result.success).toBe(true);
  });

  it('should handle API errors', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    vi.mocked(Anthropic).mockImplementationOnce(() => ({
      messages: {
        create: vi.fn().mockRejectedValue(new Error('Invalid API key')),
      },
    } as never));

    const result = await validateAnthropicApiKey('sk-ant-bad-key');
    expect(result.success).toBe(false);
    expect(result.error).toContain('connection failed');
  });
});

describe('validateClaudeOAuthToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reject tokens without sk-ant-oat prefix', async () => {
    const result = await validateClaudeOAuthToken('sk-ant-not-oauth');
    expect(result.success).toBe(false);
    expect(result.error).toContain('sk-ant-oat');
  });

  it('should accept valid OAuth token', async () => {
    const result = await validateClaudeOAuthToken('sk-ant-oat-valid-token');
    expect(result.success).toBe(true);
  });

  it('should handle CLI spawn errors', async () => {
    const { spawn } = await import('child_process');
    vi.mocked(spawn).mockImplementationOnce(() => ({
      stdin: { end: vi.fn() },
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, handler: (err: Error) => void) => {
        if (event === 'error') {
          setTimeout(() => handler(new Error('spawn failed')), 10);
        }
      }),
      kill: vi.fn(),
    } as never));

    const result = await validateClaudeOAuthToken('sk-ant-oat-fail-spawn');
    expect(result.success).toBe(false);
    expect(result.error).toContain('spawn');
  });

  it('should handle non-zero exit codes', async () => {
    const { spawn } = await import('child_process');
    vi.mocked(spawn).mockImplementationOnce(() => {
      const stderrData = 'Authentication failed';
      return {
        stdin: { end: vi.fn() },
        stdout: { on: vi.fn() },
        stderr: {
          on: vi.fn((event: string, handler: (data: Buffer) => void) => {
            if (event === 'data') {
              setTimeout(() => handler(Buffer.from(stderrData)), 10);
            }
          }),
        },
        on: vi.fn((event: string, handler: (code?: number) => void) => {
          if (event === 'close') {
            setTimeout(() => handler(1), 20);
          }
        }),
        kill: vi.fn(),
      } as never;
    });

    const result = await validateClaudeOAuthToken('sk-ant-oat-auth-fail');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Authentication failed');
  });
});

describe('validateOpenAIKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it('should reject keys without sk- prefix', async () => {
    const result = await validateOpenAIKey('invalid-key');
    expect(result.success).toBe(false);
    expect(result.error).toContain('sk-');
  });

  it('should accept valid API key', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: [] }] }),
    });

    const result = await validateOpenAIKey('sk-valid-key');
    expect(result.success).toBe(true);
  });

  it('should handle 401 authentication errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: { message: 'Invalid API key' } }),
    });

    const result = await validateOpenAIKey('sk-bad-key');
    expect(result.success).toBe(false);
    expect(result.error).toContain('authentication failed');
  });

  it('should handle 429 rate limit errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: () => Promise.resolve({ error: { message: 'Rate limit exceeded' } }),
    });

    const result = await validateOpenAIKey('sk-rate-limited');
    expect(result.success).toBe(false);
    expect(result.error).toContain('rate limit');
  });

  it('should handle network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await validateOpenAIKey('sk-network-fail');
    expect(result.success).toBe(false);
    expect(result.error).toContain('connection failed');
  });

  it('should handle generic API errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: { message: 'Internal server error' } }),
    });

    const result = await validateOpenAIKey('sk-server-error');
    expect(result.success).toBe(false);
    expect(result.error).toContain('API error');
  });
});
