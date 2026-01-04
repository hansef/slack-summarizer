import { describe, it, expect } from 'vitest';
import {
  SlackMessageSchema,
  SlackChannelSchema,
  getChannelType,
  UserActivityDataSchema,
} from '../../../../src/core/models/slack.js';

describe('Slack Models', () => {
  describe('SlackMessageSchema', () => {
    it('should parse a valid message', () => {
      const msg = {
        ts: '1234567890.123456',
        user: 'U123456',
        text: 'Hello world',
        channel: 'C123456',
        type: 'message',
      };

      const parsed = SlackMessageSchema.parse(msg);

      expect(parsed.ts).toBe('1234567890.123456');
      expect(parsed.user).toBe('U123456');
      expect(parsed.text).toBe('Hello world');
      expect(parsed.channel).toBe('C123456');
    });

    it('should handle optional thread_ts', () => {
      const msg = {
        ts: '1234567890.123456',
        thread_ts: '1234567890.000000',
        user: 'U123456',
        text: 'Thread reply',
        channel: 'C123456',
        type: 'message',
      };

      const parsed = SlackMessageSchema.parse(msg);
      expect(parsed.thread_ts).toBe('1234567890.000000');
    });

    it('should handle missing optional fields', () => {
      const msg = {
        ts: '1234567890.123456',
        channel: 'C123456',
      };

      const parsed = SlackMessageSchema.parse(msg);
      expect(parsed.user).toBeUndefined();
      expect(parsed.text).toBe('');
      expect(parsed.type).toBe('message');
    });

    it('should handle reactions array', () => {
      const msg = {
        ts: '1234567890.123456',
        channel: 'C123456',
        reactions: [
          { name: 'thumbsup', count: 3, users: ['U1', 'U2', 'U3'] },
          { name: 'heart', count: 1, users: ['U4'] },
        ],
      };

      const parsed = SlackMessageSchema.parse(msg);
      expect(parsed.reactions).toHaveLength(2);
      expect(parsed.reactions?.[0].name).toBe('thumbsup');
    });
  });

  describe('SlackChannelSchema', () => {
    it('should parse a public channel', () => {
      const channel = {
        id: 'C123456',
        name: 'general',
        is_channel: true,
        is_private: false,
        is_member: true,
        num_members: 50,
      };

      const parsed = SlackChannelSchema.parse(channel);
      expect(parsed.id).toBe('C123456');
      expect(parsed.name).toBe('general');
      expect(parsed.is_channel).toBe(true);
    });

    it('should parse a DM channel', () => {
      const channel = {
        id: 'D123456',
        is_im: true,
      };

      const parsed = SlackChannelSchema.parse(channel);
      expect(parsed.id).toBe('D123456');
      expect(parsed.is_im).toBe(true);
      expect(parsed.name).toBeUndefined();
    });
  });

  describe('getChannelType', () => {
    it('should identify public channel', () => {
      const channel = { id: 'C123', is_channel: true };
      expect(getChannelType(channel)).toBe('public_channel');
    });

    it('should identify private channel', () => {
      const channel = { id: 'G123', is_private: true };
      expect(getChannelType(channel)).toBe('private_channel');
    });

    it('should identify group channel', () => {
      const channel = { id: 'G123', is_group: true };
      expect(getChannelType(channel)).toBe('private_channel');
    });

    it('should identify IM', () => {
      const channel = { id: 'D123', is_im: true };
      expect(getChannelType(channel)).toBe('im');
    });

    it('should identify MPIM', () => {
      const channel = { id: 'G123', is_mpim: true };
      expect(getChannelType(channel)).toBe('mpim');
    });
  });

  describe('UserActivityDataSchema', () => {
    it('should parse valid user activity data', () => {
      const data = {
        userId: 'U123456',
        timeRange: {
          start: '2024-01-01T00:00:00Z',
          end: '2024-01-01T23:59:59Z',
        },
        messagesSent: [
          { ts: '1234567890.123456', channel: 'C123', text: 'Hello' },
        ],
        mentionsReceived: [],
        threadsParticipated: [],
        reactionsGiven: [],
        channels: [],
      };

      const parsed = UserActivityDataSchema.parse(data);
      expect(parsed.userId).toBe('U123456');
      expect(parsed.messagesSent).toHaveLength(1);
    });
  });
});
