import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { segmentByTimeGaps, countTimeGapSplits } from '@/core/segmentation/time-based.js';
import { SlackMessage } from '@/core/models/slack.js';
import { resetEnvCache } from '@/utils/env.js';

describe('Time-based Segmentation', () => {
  beforeEach(() => {
    resetEnvCache();
    process.env.SLACK_USER_TOKEN = 'xoxp-test-token';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    process.env.SLACK_SUMMARIZER_TIMEZONE = 'America/Los_Angeles';
  });

  afterEach(() => {
    resetEnvCache();
  });

  describe('segmentByTimeGaps', () => {
    it('should return empty array for no messages', () => {
      const result = segmentByTimeGaps([], 'C123', 'general', 'U123');
      expect(result).toHaveLength(0);
    });

    it('should create single conversation for messages within gap threshold', () => {
      const messages: SlackMessage[] = [
        { ts: '1704067200.000000', user: 'U123', text: 'Hello', channel: 'C123', type: 'message' },
        { ts: '1704067260.000000', user: 'U456', text: 'Hi', channel: 'C123', type: 'message' }, // 1 min later
        { ts: '1704067320.000000', user: 'U123', text: 'How are you?', channel: 'C123', type: 'message' }, // 2 min later
      ];

      const result = segmentByTimeGaps(messages, 'C123', 'general', 'U123');

      expect(result).toHaveLength(1);
      expect(result[0].messages).toHaveLength(3);
      expect(result[0].channelId).toBe('C123');
      expect(result[0].channelName).toBe('general');
    });

    it('should split conversations at time gaps', () => {
      const messages: SlackMessage[] = [
        { ts: '1704067200.000000', user: 'U123', text: 'Hello', channel: 'C123', type: 'message' },
        { ts: '1704067260.000000', user: 'U456', text: 'Hi', channel: 'C123', type: 'message' }, // 1 min later
        { ts: '1704072600.000000', user: 'U123', text: 'Back again', channel: 'C123', type: 'message' }, // 90 min later (gap! > 60 min default)
        { ts: '1704072660.000000', user: 'U456', text: 'Welcome back', channel: 'C123', type: 'message' }, // 1 min later
      ];

      const result = segmentByTimeGaps(messages, 'C123', 'general', 'U123');

      expect(result).toHaveLength(2);
      expect(result[0].messages).toHaveLength(2);
      expect(result[1].messages).toHaveLength(2);
    });

    it('should sort messages by timestamp', () => {
      const messages: SlackMessage[] = [
        { ts: '1704067320.000000', user: 'U123', text: 'Third', channel: 'C123', type: 'message' },
        { ts: '1704067200.000000', user: 'U123', text: 'First', channel: 'C123', type: 'message' },
        { ts: '1704067260.000000', user: 'U123', text: 'Second', channel: 'C123', type: 'message' },
      ];

      const result = segmentByTimeGaps(messages, 'C123', 'general', 'U123');

      expect(result).toHaveLength(1);
      expect(result[0].messages[0].text).toBe('First');
      expect(result[0].messages[1].text).toBe('Second');
      expect(result[0].messages[2].text).toBe('Third');
    });

    it('should track participants correctly', () => {
      const messages: SlackMessage[] = [
        { ts: '1704067200.000000', user: 'U123', text: 'Hello', channel: 'C123', type: 'message' },
        { ts: '1704067260.000000', user: 'U456', text: 'Hi', channel: 'C123', type: 'message' },
        { ts: '1704067320.000000', user: 'U789', text: 'Hey', channel: 'C123', type: 'message' },
        { ts: '1704067380.000000', user: 'U123', text: 'Hello again', channel: 'C123', type: 'message' },
      ];

      const result = segmentByTimeGaps(messages, 'C123', 'general', 'U123');

      expect(result[0].participants).toContain('U123');
      expect(result[0].participants).toContain('U456');
      expect(result[0].participants).toContain('U789');
      expect(result[0].participants).toHaveLength(3);
    });

    it('should count user messages correctly', () => {
      const messages: SlackMessage[] = [
        { ts: '1704067200.000000', user: 'U123', text: 'Hello', channel: 'C123', type: 'message' },
        { ts: '1704067260.000000', user: 'U456', text: 'Hi', channel: 'C123', type: 'message' },
        { ts: '1704067320.000000', user: 'U123', text: 'How are you?', channel: 'C123', type: 'message' },
      ];

      const result = segmentByTimeGaps(messages, 'C123', 'general', 'U123');

      expect(result[0].userMessageCount).toBe(2);
      expect(result[0].messageCount).toBe(3);
    });

    it('should use custom gap threshold', () => {
      const messages: SlackMessage[] = [
        { ts: '1704067200.000000', user: 'U123', text: 'Hello', channel: 'C123', type: 'message' },
        { ts: '1704067800.000000', user: 'U456', text: 'Hi', channel: 'C123', type: 'message' }, // 10 min later
      ];

      // With 30 min threshold, should be one conversation
      const result30 = segmentByTimeGaps(messages, 'C123', 'general', 'U123', { gapThresholdMinutes: 30 });
      expect(result30).toHaveLength(1);

      // With 5 min threshold, should be two conversations
      const result5 = segmentByTimeGaps(messages, 'C123', 'general', 'U123', { gapThresholdMinutes: 5 });
      expect(result5).toHaveLength(2);
    });
  });

  describe('countTimeGapSplits', () => {
    it('should return 0 for empty or single message', () => {
      expect(countTimeGapSplits([])).toBe(0);
      expect(countTimeGapSplits([{ ts: '1704067200.000000', channel: 'C123', type: 'message', text: 'test' }])).toBe(0);
    });

    it('should count gaps correctly', () => {
      const messages: SlackMessage[] = [
        { ts: '1704067200.000000', user: 'U123', text: 'Hello', channel: 'C123', type: 'message' },
        { ts: '1704072600.000000', user: 'U456', text: 'Hi', channel: 'C123', type: 'message' }, // 90 min gap (> 60 min default)
        { ts: '1704072660.000000', user: 'U123', text: 'Hey', channel: 'C123', type: 'message' }, // 1 min
        { ts: '1704078000.000000', user: 'U123', text: 'Back', channel: 'C123', type: 'message' }, // 90 min gap (> 60 min default)
      ];

      expect(countTimeGapSplits(messages)).toBe(2);
    });
  });
});
