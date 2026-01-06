import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SlackMessage } from '@/core/models/slack.js';
import { resetEnvCache } from '@/utils/env.js';

// Use vi.hoisted to create mock functions before vi.mock runs
const { mockCreateMessage, mockGetBackend, mockProvider } = vi.hoisted(() => {
  const mockCreateMessage = vi.fn();
  const mockGetBackend = vi.fn(() => ({ createMessage: mockCreateMessage }));
  const mockProvider = { getBackend: mockGetBackend, getBackendType: vi.fn(() => 'sdk') };
  return { mockCreateMessage, mockGetBackend, mockProvider };
});

// Mock the Claude provider
vi.mock('@/core/llm/index.js', () => ({
  getClaudeProvider: vi.fn(() => mockProvider),
  resetClaudeProvider: vi.fn(),
}));

// Import after mocking
import { applyBoundaryDecisions, analyzeConversationBoundaries, BoundaryDecision } from '@/core/segmentation/semantic.js';

describe('Semantic Segmentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEnvCache();
    process.env.SLACK_USER_TOKEN = 'xoxp-test-token';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    process.env.SLACK_SUMMARIZER_TIMEZONE = 'America/Los_Angeles';
  });

  afterEach(() => {
    resetEnvCache();
  });

  describe('applyBoundaryDecisions', () => {
    const messages: SlackMessage[] = [
      { ts: '1704067200.000000', user: 'U123', text: 'Hello', channel: 'C123', type: 'message' },
      { ts: '1704067260.000000', user: 'U456', text: 'Hi', channel: 'C123', type: 'message' },
      { ts: '1704067320.000000', user: 'U123', text: 'Topic change', channel: 'C123', type: 'message' },
      { ts: '1704067380.000000', user: 'U456', text: 'New topic', channel: 'C123', type: 'message' },
    ];

    it('should return empty array when no boundaries detected', () => {
      const decisions: BoundaryDecision[] = [
        { index: 0, isBoundary: false, confidence: 0.9 },
        { index: 1, isBoundary: false, confidence: 0.8 },
        { index: 2, isBoundary: false, confidence: 0.85 },
      ];

      const boundaries = applyBoundaryDecisions(messages, decisions);
      expect(boundaries).toHaveLength(0);
    });

    it('should return boundary indices for detected boundaries', () => {
      const decisions: BoundaryDecision[] = [
        { index: 0, isBoundary: false, confidence: 0.9 },
        { index: 1, isBoundary: true, confidence: 0.8 },
        { index: 2, isBoundary: false, confidence: 0.85 },
      ];

      const boundaries = applyBoundaryDecisions(messages, decisions);
      expect(boundaries).toEqual([2]); // Boundary after index 1 = at position 2
    });

    it('should filter boundaries below confidence threshold', () => {
      const decisions: BoundaryDecision[] = [
        { index: 0, isBoundary: true, confidence: 0.4 }, // Below threshold
        { index: 1, isBoundary: true, confidence: 0.8 }, // Above threshold
        { index: 2, isBoundary: true, confidence: 0.5 }, // Below threshold
      ];

      const boundaries = applyBoundaryDecisions(messages, decisions, 0.6);
      expect(boundaries).toEqual([2]);
    });

    it('should return multiple boundaries', () => {
      const decisions: BoundaryDecision[] = [
        { index: 0, isBoundary: true, confidence: 0.9 },
        { index: 1, isBoundary: false, confidence: 0.8 },
        { index: 2, isBoundary: true, confidence: 0.85 },
      ];

      const boundaries = applyBoundaryDecisions(messages, decisions);
      expect(boundaries).toEqual([1, 3]);
    });
  });

  describe('analyzeConversationBoundaries', () => {
    const messages: SlackMessage[] = [
      { ts: '1704067200.000000', user: 'U123', text: 'Hello everyone', channel: 'C123', type: 'message' },
      { ts: '1704067260.000000', user: 'U456', text: 'Hi there!', channel: 'C123', type: 'message' },
      { ts: '1704067320.000000', user: 'U123', text: 'Let us discuss the budget', channel: 'C123', type: 'message' },
      { ts: '1704067380.000000', user: 'U456', text: 'Sure, what about Q1?', channel: 'C123', type: 'message' },
    ];

    it('should return empty array for single message', async () => {
      const singleMessage = [messages[0]];
      const decisions = await analyzeConversationBoundaries(singleMessage);
      expect(decisions).toHaveLength(0);
    });

    it('should parse valid JSON response from Claude', async () => {
      mockCreateMessage.mockResolvedValue({
        content: [{
          type: 'text',
          text: '[{"index": 1, "boundary": false}, {"index": 2, "boundary": true}, {"index": 3, "boundary": false}]',
        }],
      });

      const decisions = await analyzeConversationBoundaries(messages);

      expect(decisions).toHaveLength(3);
      expect(decisions[0]).toEqual({ index: 0, isBoundary: false, confidence: 0.8 });
      expect(decisions[1]).toEqual({ index: 1, isBoundary: true, confidence: 0.8 });
      expect(decisions[2]).toEqual({ index: 2, isBoundary: false, confidence: 0.8 });
    });

    it('should handle JSON response with surrounding text', async () => {
      mockCreateMessage.mockResolvedValue({
        content: [{
          type: 'text',
          text: 'Based on my analysis, here are the boundaries:\n[{"index": 1, "boundary": true}]\nHope this helps!',
        }],
      });

      const decisions = await analyzeConversationBoundaries([messages[0], messages[1]]);

      expect(decisions).toHaveLength(1);
      expect(decisions[0].isBoundary).toBe(true);
    });

    it('should fall back to no boundaries when JSON is malformed', async () => {
      mockCreateMessage.mockResolvedValue({
        content: [{
          type: 'text',
          text: 'I cannot determine the boundaries properly.',
        }],
      });

      const decisions = await analyzeConversationBoundaries(messages);

      // Should return fallback decisions (all false with 0.5 confidence)
      expect(decisions).toHaveLength(3);
      expect(decisions.every((d) => d.isBoundary === false)).toBe(true);
      expect(decisions.every((d) => d.confidence === 0.5)).toBe(true);
    });

    it('should fall back to no boundaries on API error', async () => {
      mockCreateMessage.mockRejectedValue(new Error('API rate limit exceeded'));

      const decisions = await analyzeConversationBoundaries(messages);

      // Should return fallback decisions
      expect(decisions).toHaveLength(3);
      expect(decisions.every((d) => d.isBoundary === false)).toBe(true);
      expect(decisions.every((d) => d.confidence === 0.5)).toBe(true);
    });

    it('should handle unexpected response type gracefully', async () => {
      mockCreateMessage.mockResolvedValue({
        content: [{
          type: 'tool_use',
          id: 'tool-1',
          name: 'some_tool',
          input: {},
        }],
      });

      const decisions = await analyzeConversationBoundaries(messages);

      // Should return fallback decisions
      expect(decisions).toHaveLength(3);
      expect(decisions.every((d) => d.isBoundary === false)).toBe(true);
    });

    it('should process messages in batches', async () => {
      // Create more messages than BATCH_SIZE (20)
      const manyMessages: SlackMessage[] = Array.from({ length: 25 }, (_, i) => ({
        ts: `1704067200.${String(i).padStart(6, '0')}`,
        user: i % 2 === 0 ? 'U123' : 'U456',
        text: `Message ${i}`,
        channel: 'C123',
        type: 'message' as const,
      }));

      // First batch: 20 pairs, Second batch: 4 pairs
      const firstBatchResponse = Array.from({ length: 20 }, (_, i) => ({
        index: i + 1,
        boundary: i === 10, // Boundary at pair 10
      }));
      const secondBatchResponse = Array.from({ length: 4 }, (_, i) => ({
        index: i + 1,
        boundary: false,
      }));

      mockCreateMessage
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: JSON.stringify(firstBatchResponse) }],
        })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: JSON.stringify(secondBatchResponse) }],
        });

      const decisions = await analyzeConversationBoundaries(manyMessages);

      expect(mockCreateMessage).toHaveBeenCalledTimes(2);
      expect(decisions.length).toBe(24); // 25 messages = 24 pairs
      expect(decisions.filter((d) => d.isBoundary)).toHaveLength(1);
    });

    it('should include user info in prompts', async () => {
      mockCreateMessage.mockResolvedValue({
        content: [{
          type: 'text',
          text: '[{"index": 1, "boundary": false}]',
        }],
      });

      await analyzeConversationBoundaries([messages[0], messages[1]]);

      const call = mockCreateMessage.mock.calls[0][0];
      expect(call.messages[0].content).toContain('U123');
      expect(call.messages[0].content).toContain('U456');
    });
  });
});
