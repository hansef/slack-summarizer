import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyBoundaryDecisions, BoundaryDecision } from '../../../../src/core/segmentation/semantic.js';
import { SlackMessage } from '../../../../src/core/models/slack.js';
import { resetEnvCache } from '../../../../src/utils/env.js';

describe('Semantic Segmentation', () => {
  beforeEach(() => {
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

  // Note: analyzeConversationBoundaries requires actual API calls
  // Integration tests would mock the Anthropic client
});
