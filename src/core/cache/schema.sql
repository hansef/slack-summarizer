-- Messages table for caching Slack messages
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,                    -- Composite: channel_id:ts
  channel_id TEXT NOT NULL,
  user_id TEXT,
  timestamp TEXT NOT NULL,                -- Slack ts format
  thread_ts TEXT,
  text TEXT,
  message_type TEXT DEFAULT 'message',    -- 'message', 'thread_reply'
  raw_json TEXT,
  fetched_at INTEGER NOT NULL,            -- Unix timestamp
  day_bucket TEXT NOT NULL                -- 'YYYY-MM-DD' for immutable caching
);

CREATE INDEX IF NOT EXISTS idx_messages_channel_day ON messages(channel_id, day_bucket);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_ts);

-- Mentions table for caching @mentions
CREATE TABLE IF NOT EXISTS mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,               -- References message ts
  mentioned_user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  day_bucket TEXT NOT NULL,
  raw_json TEXT,
  fetched_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mentions_user_day ON mentions(mentioned_user_id, day_bucket);
CREATE INDEX IF NOT EXISTS idx_mentions_channel ON mentions(channel_id);

-- Reactions table for caching user reactions
CREATE TABLE IF NOT EXISTS reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  reaction_name TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  day_bucket TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  UNIQUE(message_id, user_id, reaction_name)
);

CREATE INDEX IF NOT EXISTS idx_reactions_user_day ON reactions(user_id, day_bucket);
CREATE INDEX IF NOT EXISTS idx_reactions_channel ON reactions(channel_id);

-- Channels table for caching channel metadata
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT,
  type TEXT NOT NULL,                     -- 'public_channel', 'private_channel', 'im', 'mpim'
  member_count INTEGER,
  raw_json TEXT,
  updated_at INTEGER NOT NULL
);

-- Cache metadata for tracking fetch status
CREATE TABLE IF NOT EXISTS cache_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Fetch status for tracking which day buckets have been fetched
CREATE TABLE IF NOT EXISTS fetch_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  day_bucket TEXT NOT NULL,
  data_type TEXT NOT NULL,                -- 'messages', 'mentions', 'reactions'
  fetched_at INTEGER NOT NULL,
  UNIQUE(user_id, channel_id, day_bucket, data_type)
);

CREATE INDEX IF NOT EXISTS idx_fetch_status_user_day ON fetch_status(user_id, day_bucket);

-- Conversation embeddings cache for semantic similarity
CREATE TABLE IF NOT EXISTS conversation_embeddings (
  conversation_id TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,              -- Float32Array serialized as Buffer
  text_hash TEXT NOT NULL,              -- SHA-256 of concatenated message text
  embedding_model TEXT NOT NULL,        -- e.g., 'text-embedding-3-small'
  dimensions INTEGER NOT NULL,          -- e.g., 1536
  created_at INTEGER NOT NULL           -- Unix timestamp
);

CREATE INDEX IF NOT EXISTS idx_embeddings_hash ON conversation_embeddings(text_hash);
