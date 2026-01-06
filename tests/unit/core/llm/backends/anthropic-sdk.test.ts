/**
 * Tests for the Anthropic SDK backend.
 *
 * The AnthropicSdkBackend:
 * 1. Wraps the @anthropic-ai/sdk client
 * 2. Creates messages via the API
 * 3. Transforms responses to the unified format
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicSdkBackend } from '@/core/llm/backends/anthropic-sdk.js';

// Mock the Anthropic SDK
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: mockCreate,
    },
  })),
}));

describe('AnthropicSdkBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create backend with API key', () => {
      const backend = new AnthropicSdkBackend({ apiKey: 'sk-ant-test-key' });
      expect(backend).toBeDefined();
      expect(backend.backendType).toBe('sdk');
    });
  });

  describe('createMessage', () => {
    it('should call Anthropic API and return formatted response', async () => {
      mockCreate.mockResolvedValue({
        content: [
          { type: 'text', text: 'Hello, I am Claude!' },
        ],
      });

      const backend = new AnthropicSdkBackend({ apiKey: 'sk-ant-test-key' });
      const response = await backend.createMessage({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(response.content).toHaveLength(1);
      expect(response.content[0].type).toBe('text');
      expect(response.content[0].text).toBe('Hello, I am Claude!');

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{ role: 'user', content: 'Hello' }],
      });
    });

    it('should handle multiple text blocks in response', async () => {
      mockCreate.mockResolvedValue({
        content: [
          { type: 'text', text: 'First part' },
          { type: 'text', text: 'Second part' },
        ],
      });

      const backend = new AnthropicSdkBackend({ apiKey: 'sk-ant-test-key' });
      const response = await backend.createMessage({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: 'Multi-part response' }],
      });

      expect(response.content).toHaveLength(2);
      expect(response.content[0].text).toBe('First part');
      expect(response.content[1].text).toBe('Second part');
    });

    it('should throw on non-text content blocks', async () => {
      mockCreate.mockResolvedValue({
        content: [
          { type: 'tool_use', id: 'tool_123', name: 'test_tool', input: {} },
        ],
      });

      const backend = new AnthropicSdkBackend({ apiKey: 'sk-ant-test-key' });

      await expect(
        backend.createMessage({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1000,
          messages: [{ role: 'user', content: 'Hello' }],
        })
      ).rejects.toThrow('Unexpected content block type');
    });

    it('should propagate API errors', async () => {
      mockCreate.mockRejectedValue(new Error('Invalid API key'));

      const backend = new AnthropicSdkBackend({ apiKey: 'sk-ant-bad-key' });

      await expect(
        backend.createMessage({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1000,
          messages: [{ role: 'user', content: 'Hello' }],
        })
      ).rejects.toThrow('Invalid API key');
    });
  });
});
