import { getDatabase, transaction } from './db.js';
import { logger } from '../../utils/logger.js';
import { SlackMessage, SlackChannel, SlackReactionItem, getChannelType } from '../models/slack.js';
import { getDayBucket, now, fromSlackTimestamp, type DateRange } from '../../utils/dates.js';

export interface CachedMessage {
  id: string;
  channel_id: string;
  user_id: string | null;
  timestamp: string;
  thread_ts: string | null;
  text: string | null;
  message_type: string;
  raw_json: string;
  fetched_at: number;
  day_bucket: string;
}

// Check if a day bucket has been fetched for a user/channel
export function isDayFetched(
  userId: string,
  channelId: string,
  dayBucket: string,
  dataType: 'messages' | 'mentions' | 'reactions'
): boolean {
  const db = getDatabase();

  // Never consider today as fully fetched (data may change)
  // Use the timezone-aware now() function to get correct day bucket
  const today = getDayBucket(now());
  if (dayBucket === today) {
    return false;
  }

  const row = db
    .prepare(
      `SELECT 1 FROM fetch_status
       WHERE user_id = ? AND channel_id = ? AND day_bucket = ? AND data_type = ?`
    )
    .get(userId, channelId, dayBucket, dataType);

  return !!row;
}

// Mark a day bucket as fetched
export function markDayFetched(
  userId: string,
  channelId: string,
  dayBucket: string,
  dataType: 'messages' | 'mentions' | 'reactions'
): void {
  const db = getDatabase();
  const now = Date.now();

  db.prepare(
    `INSERT OR REPLACE INTO fetch_status (user_id, channel_id, day_bucket, data_type, fetched_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(userId, channelId, dayBucket, dataType, now);
}

// Store messages in cache
export function cacheMessages(channelId: string, messages: SlackMessage[]): void {
  if (messages.length === 0) return;

  const db = getDatabase();
  const now = Date.now();

  const insert = db.prepare(`
    INSERT OR REPLACE INTO messages
    (id, channel_id, user_id, timestamp, thread_ts, text, message_type, raw_json, fetched_at, day_bucket)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  transaction(() => {
    for (const msg of messages) {
      const id = `${channelId}:${msg.ts}`;
      const dayBucket = getDayBucket(fromSlackTimestamp(msg.ts));
      const messageType = msg.thread_ts && msg.thread_ts !== msg.ts ? 'thread_reply' : 'message';

      insert.run(
        id,
        channelId,
        msg.user ?? null,
        msg.ts,
        msg.thread_ts ?? null,
        msg.text ?? null,
        messageType,
        JSON.stringify(msg),
        now,
        dayBucket
      );
    }
  });

  logger.debug('Cached messages', { channelId, count: messages.length });
}

// Get messages from cache for a channel and time range
export function getCachedMessages(channelId: string, timeRange: DateRange): SlackMessage[] {
  const db = getDatabase();

  const startTs = (timeRange.start.toMillis() / 1000).toString();
  const endTs = (timeRange.end.toMillis() / 1000).toString();

  const rows = db
    .prepare(
      `SELECT raw_json FROM messages
       WHERE channel_id = ? AND timestamp >= ? AND timestamp <= ?
       ORDER BY timestamp ASC`
    )
    .all(channelId, startTs, endTs) as { raw_json: string }[];

  return rows.map((row) => JSON.parse(row.raw_json) as SlackMessage);
}

// Get messages by user from cache
export function getCachedMessagesByUser(
  userId: string,
  channelId: string,
  timeRange: DateRange
): SlackMessage[] {
  const db = getDatabase();

  const startTs = (timeRange.start.toMillis() / 1000).toString();
  const endTs = (timeRange.end.toMillis() / 1000).toString();

  const rows = db
    .prepare(
      `SELECT raw_json FROM messages
       WHERE channel_id = ? AND user_id = ? AND timestamp >= ? AND timestamp <= ?
       ORDER BY timestamp ASC`
    )
    .all(channelId, userId, startTs, endTs) as { raw_json: string }[];

  return rows.map((row) => JSON.parse(row.raw_json) as SlackMessage);
}

// Store mentions in cache
export function cacheMentions(
  mentionedUserId: string,
  messages: SlackMessage[]
): void {
  if (messages.length === 0) return;

  const db = getDatabase();
  const now = Date.now();

  const insert = db.prepare(`
    INSERT OR IGNORE INTO mentions
    (message_id, mentioned_user_id, channel_id, timestamp, day_bucket, raw_json, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  transaction(() => {
    for (const msg of messages) {
      const dayBucket = getDayBucket(fromSlackTimestamp(msg.ts));

      insert.run(
        msg.ts,
        mentionedUserId,
        msg.channel,
        msg.ts,
        dayBucket,
        JSON.stringify(msg),
        now
      );
    }
  });

  logger.debug('Cached mentions', { mentionedUserId, count: messages.length });
}

// Get cached mentions for a user
export function getCachedMentions(userId: string, timeRange: DateRange): SlackMessage[] {
  const db = getDatabase();

  const startTs = (timeRange.start.toMillis() / 1000).toString();
  const endTs = (timeRange.end.toMillis() / 1000).toString();

  const rows = db
    .prepare(
      `SELECT raw_json FROM mentions
       WHERE mentioned_user_id = ? AND timestamp >= ? AND timestamp <= ?
       ORDER BY timestamp ASC`
    )
    .all(userId, startTs, endTs) as { raw_json: string }[];

  return rows.map((row) => JSON.parse(row.raw_json) as SlackMessage);
}

// Store reactions in cache
export function cacheReactions(
  userId: string,
  reactions: SlackReactionItem[]
): void {
  if (reactions.length === 0) return;

  const db = getDatabase();
  const now = Date.now();

  const insert = db.prepare(`
    INSERT OR REPLACE INTO reactions
    (message_id, user_id, channel_id, reaction_name, timestamp, day_bucket, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  transaction(() => {
    for (const reaction of reactions) {
      const dayBucket = getDayBucket(fromSlackTimestamp(reaction.timestamp));

      insert.run(
        reaction.messageId,
        userId,
        reaction.channel,
        reaction.reaction,
        reaction.timestamp,
        dayBucket,
        now
      );
    }
  });

  logger.debug('Cached reactions', { userId, count: reactions.length });
}

// Get cached reactions for a user
export function getCachedReactions(userId: string, timeRange: DateRange): SlackReactionItem[] {
  const db = getDatabase();

  const startTs = (timeRange.start.toMillis() / 1000).toString();
  const endTs = (timeRange.end.toMillis() / 1000).toString();

  const rows = db
    .prepare(
      `SELECT message_id, channel_id, reaction_name, timestamp FROM reactions
       WHERE user_id = ? AND timestamp >= ? AND timestamp <= ?
       ORDER BY timestamp ASC`
    )
    .all(userId, startTs, endTs) as Array<{
    message_id: string;
    channel_id: string;
    reaction_name: string;
    timestamp: string;
  }>;

  return rows.map((row) => ({
    messageId: row.message_id,
    channel: row.channel_id,
    reaction: row.reaction_name,
    timestamp: row.timestamp,
  }));
}

// Store channel info in cache
export function cacheChannel(channel: SlackChannel): void {
  const db = getDatabase();
  const now = Date.now();
  const channelType = getChannelType(channel);

  db.prepare(`
    INSERT OR REPLACE INTO channels (id, name, type, member_count, raw_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    channel.id,
    channel.name ?? null,
    channelType,
    channel.num_members ?? null,
    JSON.stringify(channel),
    now
  );
}

// Get cached channel
export function getCachedChannel(channelId: string): SlackChannel | null {
  const db = getDatabase();

  const row = db
    .prepare('SELECT raw_json FROM channels WHERE id = ?')
    .get(channelId) as { raw_json: string } | undefined;

  if (!row) return null;
  return JSON.parse(row.raw_json) as SlackChannel;
}

// Get all cached channels
export function getCachedChannels(): SlackChannel[] {
  const db = getDatabase();

  const rows = db.prepare('SELECT raw_json FROM channels').all() as { raw_json: string }[];
  return rows.map((row) => JSON.parse(row.raw_json) as SlackChannel);
}

// Clear all cache data
export function clearCache(): void {
  const db = getDatabase();

  transaction(() => {
    db.exec('DELETE FROM messages');
    db.exec('DELETE FROM mentions');
    db.exec('DELETE FROM reactions');
    db.exec('DELETE FROM channels');
    db.exec('DELETE FROM cache_metadata');
    db.exec('DELETE FROM fetch_status');
  });

  logger.info('Cache cleared');
}

// Get cache statistics
export function getCacheStats(): {
  messages: number;
  mentions: number;
  reactions: number;
  channels: number;
  oldestEntry: string | null;
  newestEntry: string | null;
} {
  const db = getDatabase();

  const messageCount = (db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number }).count;
  const mentionCount = (db.prepare('SELECT COUNT(*) as count FROM mentions').get() as { count: number }).count;
  const reactionCount = (db.prepare('SELECT COUNT(*) as count FROM reactions').get() as { count: number }).count;
  const channelCount = (db.prepare('SELECT COUNT(*) as count FROM channels').get() as { count: number }).count;

  const oldest = db.prepare('SELECT MIN(day_bucket) as bucket FROM messages').get() as { bucket: string | null };
  const newest = db.prepare('SELECT MAX(day_bucket) as bucket FROM messages').get() as { bucket: string | null };

  return {
    messages: messageCount,
    mentions: mentionCount,
    reactions: reactionCount,
    channels: channelCount,
    oldestEntry: oldest.bucket,
    newestEntry: newest.bucket,
  };
}
