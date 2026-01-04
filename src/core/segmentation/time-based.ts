import { SlackMessage } from '../models/slack.js';
import { Conversation } from '../models/conversation.js';
import { fromSlackTimestamp, formatISO, getMinutesBetween } from '../../utils/dates.js';
import { v4 as uuidv4 } from 'uuid';

export interface TimeSegmentationConfig {
  gapThresholdMinutes: number;
}

const DEFAULT_CONFIG: TimeSegmentationConfig = {
  gapThresholdMinutes: 60, // Increased for async teams
};

export function segmentByTimeGaps(
  messages: SlackMessage[],
  channelId: string,
  channelName: string | undefined,
  userId: string,
  config: Partial<TimeSegmentationConfig> = {}
): Conversation[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (messages.length === 0) {
    return [];
  }

  // Sort messages by timestamp
  const sorted = [...messages].sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));

  const conversations: Conversation[] = [];
  let currentSegment: SlackMessage[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prevMsg = sorted[i - 1];
    const currMsg = sorted[i];

    const prevTime = fromSlackTimestamp(prevMsg.ts);
    const currTime = fromSlackTimestamp(currMsg.ts);
    const gapMinutes = getMinutesBetween(prevTime, currTime);

    if (gapMinutes >= cfg.gapThresholdMinutes) {
      // Gap detected, create a new conversation
      conversations.push(createConversation(currentSegment, channelId, channelName, userId));
      currentSegment = [currMsg];
    } else {
      currentSegment.push(currMsg);
    }
  }

  // Don't forget the last segment
  if (currentSegment.length > 0) {
    conversations.push(createConversation(currentSegment, channelId, channelName, userId));
  }

  return conversations;
}

function createConversation(
  messages: SlackMessage[],
  channelId: string,
  channelName: string | undefined,
  userId: string
): Conversation {
  const sorted = [...messages].sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
  const participants = [...new Set(messages.map((m) => m.user).filter(Boolean))] as string[];

  const startTime = fromSlackTimestamp(sorted[0].ts);
  const endTime = fromSlackTimestamp(sorted[sorted.length - 1].ts);

  return {
    id: uuidv4(),
    channelId,
    channelName,
    isThread: false,
    messages: sorted,
    startTime: formatISO(startTime),
    endTime: formatISO(endTime),
    participants,
    messageCount: messages.length,
    userMessageCount: messages.filter((m) => m.user === userId).length,
  };
}

export function countTimeGapSplits(
  messages: SlackMessage[],
  config: Partial<TimeSegmentationConfig> = {}
): number {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (messages.length <= 1) {
    return 0;
  }

  const sorted = [...messages].sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
  let splits = 0;

  for (let i = 1; i < sorted.length; i++) {
    const prevTime = fromSlackTimestamp(sorted[i - 1].ts);
    const currTime = fromSlackTimestamp(sorted[i].ts);
    const gapMinutes = getMinutesBetween(prevTime, currTime);

    if (gapMinutes >= cfg.gapThresholdMinutes) {
      splits++;
    }
  }

  return splits;
}
