# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## General Coding Guidance

NEVER create "backwards compatible" or "legacy preservation" versions of changes unless the user explicitly asks you too. This is an internal tool where breaking changes are always acceptable.

ALWAYS ensure that tsc builds cleanly and that all eslint/tslint issues are resolved - even if you don't think your changes introduced them - before declaring a feature or bug complete or fixed.

## Build & Development Commands

```bash
pnpm install          # Install dependencies
pnpm dev:cli          # Run CLI in development (tsx)
pnpm dev:mcp          # Run MCP server in development
pnpm build            # Build for production (tsc -p tsconfig.build.json)
pnpm test             # Run tests (vitest run)
pnpm test:watch       # Run tests in watch mode
pnpm typecheck        # Type check without emitting
pnpm lint             # ESLint on src/
pnpm format           # Prettier on src/
```

**Run a single test file:** `pnpm test tests/unit/path/to/file.test.ts`

## Architecture Overview

Slack activity summarization tool with CLI and MCP interfaces. Uses search-first fetching to minimize API calls.

### Pipeline Flow

```
Slack API → DataFetcher → Segmentation → Context Enrichment → Consolidation → Summarization → JSON Output
```

**Entry point:** `SummaryAggregator.generateSummary()` in `src/core/summarization/aggregator.ts`

### Key Directories

| Directory | Purpose | Key Files |
|-----------|---------|-----------|
| `src/core/slack/` | Slack API client, data fetching | `client.ts` (WebClient + rate limiting), `fetcher.ts` (orchestration) |
| `src/core/segmentation/` | Message → Conversation grouping | `hybrid.ts` (entry), `time-based.ts`, `semantic.ts`, `context-enricher.ts` |
| `src/core/consolidation/` | Group related conversations | `consolidator.ts` (Union-Find), `reference-extractor.ts` |
| `src/core/embeddings/` | Semantic similarity (optional) | `client.ts` (OpenAI), `similarity.ts`, `cache.ts` |
| `src/core/summarization/` | Claude narrative generation | `aggregator.ts` (orchestrator), `client.ts`, `prompts.ts` |
| `src/core/cache/` | SQLite message caching | `db.ts`, `messages.ts`, `schema.sql` |
| `src/core/models/` | Data types and schemas | `slack.ts` (Zod), `conversation.ts`, `summary.ts` |

### Data Flow

#### 1. Data Fetching (`src/core/slack/fetcher.ts`)

**`DataFetcher.fetchUserActivity()`** orchestrates data collection:

1. **Search-first channel discovery**: Uses `from:@user` search to identify active channels (avoids scanning 300+ channels)
2. **Fetch channel history with 24h lookback**: Extends time range by 24 hours for conversation context
3. **Thread extraction**: Identifies threads from search results and channel history, fetches full thread replies
4. **Mentions and reactions**: Fetches @mentions and reactions given

**Caching strategy:**
- Day-bucketed caching in SQLite (key: `userId:channelId:dayBucket`)
- Today is never cached (always fetched fresh)
- Historical days cached indefinitely

**Output:** `UserActivityData` containing `messagesSent`, `mentionsReceived`, `threadsParticipated`, `reactionsGiven`, `channels`, `allChannelMessages`

#### 2. Segmentation (`src/core/segmentation/hybrid.ts`)

**`hybridSegmentation()`** transforms raw messages into `Conversation[]`:

1. **Thread separation**: Threads (where `thread_ts !== ts`) extracted as separate conversations with `isThread: true`
2. **Time-based splitting**: Messages with >60 min gap split into separate segments (`time-based.ts`)
3. **Semantic refinement**: For segments with ≥3 messages, Claude Haiku analyzes message pairs to detect topic boundaries (`semantic.ts`)
   - Processes 20 message pairs per batch
   - Returns boundary indices where topics shift
   - Confidence threshold: 0.6

#### 3. Context Enrichment (`src/core/segmentation/context-enricher.ts`)

**`enrichConversations()`** adds context for better summarization:

1. **@Mention lookback**: When user is @mentioned into a conversation (didn't send first message):
   - Fetches channel messages from start of day until the @mention
   - Adds up to 20 most recent messages as `[PRIOR CONTEXT]`
   - Helps Claude understand why user was brought in

2. **Short segment expansion**: For segments with ≤2 user messages:
   - Looks back from first message to add surrounding context
   - Target: 5 messages minimum
   - Max gap: 60 minutes when expanding
   - Marked as `[CONTEXT]` messages

#### 4. Consolidation (`src/core/consolidation/consolidator.ts`)

**`consolidateConversations()`** groups related conversations using Union-Find:

**Pre-processing:**
1. **Bot conversation merging**: Bot-only conversations (GitHub, CircleCI) merged into adjacent human conversations within 30 min
2. **Trivial conversation merging**: 1-2 message conversations (<100 chars total) merged into adjacent substantive ones within 30 min

**Reference extraction** (`reference-extractor.ts`):
- GitHub issues: `#123`, `owner/repo#456`
- GitHub URLs: `github.com/.../issues/123` → normalized to `#123`
- Jira tickets: `PROJ-123`
- Error patterns: `NetworkError`, `500 error`
- Service names: `xxx-auth`, `xxx-api`
- Slack message links: normalized to `slack:channel:ts`
- User mentions (excluded from similarity calculation)

**Grouping strategies** (Union-Find with path compression):
1. **Adjacent merge**: Gap ≤15 min → unconditional merge
2. **Proximity merge**: Same author + gap ≤90 min (180 for DMs) + similarity ≥0.20 (0.10 for DMs)
3. **Same-author merge**: User participated in both + gap ≤360 min + similarity ≥0.20
4. **Reference/embedding merge**: Similarity ≥0.4 + gap ≤240 min

**Similarity calculation:**
- Reference-only: Jaccard similarity on extracted references
- Hybrid (with embeddings): `0.6 × ref_jaccard + 0.4 × embedding_cosine`

**Output:** `ConversationGroup[]` with merged messages, shared references, participants

#### 5. Summarization (`src/core/summarization/`)

**`SummaryAggregator.buildChannelSummaries()`** orchestrates per-channel summarization:

1. **Generate Slack permalinks** for each conversation group
2. **Enrich Slack message links**: Fetches content for shared Slack URLs that weren't auto-unfurled
3. **Batch summarization**: Groups of 5 sent to Claude (≤2 groups summarized individually for quality)

**Prompt structure** (`prompts.ts`):
- Narrative: 2-4 sentence story arc from user's perspective (without "I" pronouns)
- Key events: 2-5 significant moments with context
- References: Issue numbers, project names, technical terms
- Participants: @mentions (target user excluded)
- Outcome: Resolution, decision, or current status
- Next actions: Explicit commitments and flagged items

**Output:** `SummaryOutput` JSON with channel summaries, consolidation stats

### Key Singletons

| Function | Location | Purpose |
|----------|----------|---------|
| `getSlackClient()` | `src/core/slack/client.ts` | Slack WebClient with rate limiting |
| `getSummarizationClient()` | `src/core/summarization/client.ts` | Anthropic client wrapper |
| `getDatabase()` | `src/core/cache/db.ts` | SQLite connection |
| `getEmbeddingClient()` | `src/core/embeddings/client.ts` | OpenAI embeddings (optional) |
| `getRateLimiter()` | `src/core/slack/rate-limiter.ts` | Queue-based rate limiter |

### Environment Variables

**Required:** `SLACK_USER_TOKEN`, `ANTHROPIC_API_KEY`

**Embeddings (optional):**
- `OPENAI_API_KEY` - Required if embeddings enabled
- `SLACK_SUMMARIZER_ENABLE_EMBEDDINGS` - Enable semantic similarity (default: false)
- `SLACK_SUMMARIZER_EMBEDDING_REF_WEIGHT` - Reference weight 0-1 (default: 0.6)
- `SLACK_SUMMARIZER_EMBEDDING_EMB_WEIGHT` - Embedding weight 0-1 (default: 0.4)

**Other:**
- `SLACK_SUMMARIZER_DB_PATH` - SQLite cache location (default: `./cache/slack.db`)
- `SLACK_SUMMARIZER_LOG_LEVEL` - Log level (default: `info`)
- `SLACK_SUMMARIZER_TIMEZONE` - Timezone for dates (default: `America/Los_Angeles`)
- `SLACK_SUMMARIZER_RATE_LIMIT` - Slack API requests/second (default: 10)
- `SLACK_SUMMARIZER_CLAUDE_MODEL` - Claude model for summarization (default: `claude-haiku-4-5-20251001`)

## Code Patterns

- Zod schemas validate all Slack API types (`src/core/models/slack.ts`)
- Luxon for timezone-aware dates; `parseTimespan()` handles "today", "yesterday", date ranges
- Rate limiter wraps all Slack API calls via `rateLimiter.execute()`
- ESM imports with `.js` extensions required for TypeScript
- Tests in `tests/unit/` mirror `src/` structure

### Context Message Handling

Context messages are marked with special subtypes:
- `mention_context` - Messages from @mention lookback (shown as `[PRIOR CONTEXT]`)
- `context_message` - Messages from short segment expansion (shown as `[CONTEXT]`)

The prompt system uses these markers to help Claude distinguish:
- Context messages explain the situation the user responded to
- They are NOT the user's activity
- Narrative should SET UP the story with context, then FOCUS on user's actions

### Embedding System

When `SLACK_SUMMARIZER_ENABLE_EMBEDDINGS=true` and `OPENAI_API_KEY` is set:

1. `prepareConversationEmbeddings()` generates vectors for all conversations
2. Uses OpenAI `text-embedding-3-small` model
3. Embeddings cached in SQLite (`conversation_embeddings` table) by SHA-256 text hash
4. `calculateHybridSimilarity()` combines reference and embedding similarity
5. Negative cosine similarity normalized to 0 (only positive similarity counts)
6. Falls back to reference-only if API fails or key missing

### MCP Server

Tools split into high-level and primitives:
- High-level: `slack_get_user_summary` - full pipeline
- Primitives: `slack_search_messages`, `slack_get_channel_history`, `slack_get_thread`, etc.
