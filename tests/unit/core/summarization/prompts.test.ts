import { describe, it, expect } from 'vitest';
import {
  parseSingleSummaryResponse,
  parseBatchSummaryResponse,
} from '../../../../src/core/summarization/prompts.js';

describe('Summarization Prompts', () => {
  describe('parseSingleSummaryResponse', () => {
    it('should parse valid JSON response', () => {
      const response = `Here's the summary:
{
  "topic": "Deployment planning for Q1",
  "keyPoints": ["Deploy on Friday", "Need QA approval"],
  "participantUsernames": ["@alice", "@bob"]
}`;

      const result = parseSingleSummaryResponse(response);

      expect(result).not.toBeNull();
      expect(result?.topic).toBe('Deployment planning for Q1');
      expect(result?.keyPoints).toHaveLength(2);
      expect(result?.participantUsernames).toContain('@alice');
    });

    it('should handle response with extra text', () => {
      const response = `I've analyzed the conversation.

{"topic": "Bug fix discussion", "keyPoints": ["Fixed the issue"], "participantUsernames": ["@dev"]}

Hope this helps!`;

      const result = parseSingleSummaryResponse(response);

      expect(result).not.toBeNull();
      expect(result?.topic).toBe('Bug fix discussion');
    });

    it('should return null for invalid JSON', () => {
      const response = 'This is not valid JSON at all';

      const result = parseSingleSummaryResponse(response);

      expect(result).toBeNull();
    });

    it('should handle missing fields with defaults', () => {
      const response = '{"topic": "Test topic"}';

      const result = parseSingleSummaryResponse(response);

      expect(result).not.toBeNull();
      expect(result?.topic).toBe('Test topic');
      expect(result?.keyPoints).toEqual([]);
      expect(result?.participantUsernames).toEqual([]);
    });
  });

  describe('parseBatchSummaryResponse', () => {
    it('should parse valid batch response', () => {
      const response = `[
        {"index": 1, "topic": "Topic 1", "keyPoints": ["Point 1"], "participantUsernames": ["@user1"]},
        {"index": 2, "topic": "Topic 2", "keyPoints": ["Point 2"], "participantUsernames": ["@user2"]}
      ]`;

      const result = parseBatchSummaryResponse(response);

      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);
      expect(result?.[0].topic).toBe('Topic 1');
      expect(result?.[1].topic).toBe('Topic 2');
    });

    it('should handle response with surrounding text', () => {
      const response = `Here are the summaries:
[{"index": 1, "topic": "Test", "keyPoints": [], "participantUsernames": []}]
Done!`;

      const result = parseBatchSummaryResponse(response);

      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
    });

    it('should return null for invalid JSON', () => {
      const response = 'Not a JSON array';

      const result = parseBatchSummaryResponse(response);

      expect(result).toBeNull();
    });

    it('should handle missing fields with defaults', () => {
      const response = '[{"index": 1, "topic": "Only topic"}]';

      const result = parseBatchSummaryResponse(response);

      expect(result).not.toBeNull();
      expect(result?.[0].keyPoints).toEqual([]);
      expect(result?.[0].participantUsernames).toEqual([]);
    });
  });
});
