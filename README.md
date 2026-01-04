# Slack Summarizer

A comprehensive Slack activity summarization tool with both CLI and MCP (Model Context Protocol) server interfaces. Fetches your Slack activity over a specified time period, intelligently segments conversations, and uses Claude AI to generate coherent summaries.

## Features

- **Activity Summarization** - Summarizes messages sent, @mentions received, thread participation, and reactions given
- **Intelligent Segmentation** - Combines time-based and semantic analysis to group related messages into conversations
- **Smart Consolidation** - Groups related conversations by shared references (GitHub issues, Jira tickets, error patterns) for coherent narrative summaries
- **Semantic Embeddings** - Optional OpenAI embeddings to consolidate semantically related conversations even without shared explicit references
- **Narrative Summaries** - 2-4 sentence story arcs with key events, references, and outcomes instead of terse fragments
- **Bot Message Merging** - GitHub and CircleCI bot messages are merged into adjacent human discussions
- **Message Caching** - SQLite-based caching to minimize API calls on repeat queries
- **Flexible Time Ranges** - Supports `today`, `yesterday`, `last-week`, or ISO date ranges (`YYYY-MM-DD..YYYY-MM-DD`)
- **Dual Interface** - Use as a CLI tool or integrate with Claude via MCP server

## Requirements

- Node.js >= 20.0.0
- pnpm 9.0.0
- Slack User Token (`xoxp-...`) - see [Slack App Setup](#slack-app-setup)
- Anthropic API Key

## Slack App Setup

Each user needs to create their own Slack app to get a user token. This is required because the summarizer needs to access your personal Slack activity.

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Name it (e.g., "My Slack Summarizer") and select your workspace

### 2. Configure OAuth Scopes

Go to **OAuth & Permissions** in the sidebar, scroll to **User Token Scopes**, and add:

| Scope | Purpose |
|-------|---------|
| `channels:history` | Read messages in public channels |
| `channels:read` | List public channels you're in |
| `groups:history` | Read messages in private channels |
| `groups:read` | List private channels you're in |
| `im:history` | Read direct messages |
| `im:read` | List direct message conversations |
| `mpim:history` | Read group direct messages |
| `mpim:read` | List group DM conversations |
| `reactions:read` | See reactions you've given |
| `search:read` | Search messages (used to find your activity) |
| `team:read` | Get workspace info |
| `users:read` | Get user display names |

### 3. Install and Get Your Token

1. Go to **OAuth & Permissions**
2. Click **Install to Workspace** and authorize
3. Copy the **User OAuth Token** (starts with `xoxp-`)
4. Add it to your `.env` file as `SLACK_USER_TOKEN`

> **Note:** This is a *user* token, not a bot token. It accesses Slack as you, so it can only see channels and messages you have access to.

## Installation

```bash
# Clone the repository
git clone https://github.com/hansef/slack-summarizer.git
cd slack-summarizer

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env
# Edit .env with your tokens
```

## Configuration

Create a `.env` file with the following variables:

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `SLACK_USER_TOKEN` | Yes | Slack user token (xoxp-...) | - |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key | - |
| `OPENAI_API_KEY` | No | OpenAI API key (for embeddings) | - |
| `SLACK_SUMMARIZER_DB_PATH` | No | SQLite cache location | `./cache/slack.db` |
| `SLACK_SUMMARIZER_LOG_LEVEL` | No | Log level (debug, info, warn, error) | `info` |
| `SLACK_SUMMARIZER_CLAUDE_MODEL` | No | Claude model for summarization | `claude-haiku-4-5-20251001` |
| `SLACK_SUMMARIZER_TIMEZONE` | No | Timezone for date calculations | `America/Los_Angeles` |
| `SLACK_SUMMARIZER_RATE_LIMIT` | No | Slack API requests per second | `10` |
| `SLACK_SUMMARIZER_ENABLE_EMBEDDINGS` | No | Enable semantic embeddings for consolidation | `false` |
| `SLACK_SUMMARIZER_EMBEDDING_REF_WEIGHT` | No | Weight for reference similarity (0-1) | `0.6` |
| `SLACK_SUMMARIZER_EMBEDDING_EMB_WEIGHT` | No | Weight for embedding similarity (0-1) | `0.4` |

## CLI Usage

### Generate Summary

```bash
# Summarize today's activity
pnpm dev:cli summarize

# Summarize yesterday
pnpm dev:cli summarize --date yesterday

# Summarize a specific date
pnpm dev:cli summarize --date 2024-01-15

# Summarize a week
pnpm dev:cli summarize --date 2024-01-15 --span week

# Use a different model
pnpm dev:cli summarize --model sonnet

# Output to a specific file
pnpm dev:cli summarize --output ./my-summary.json
```

### CLI Commands

| Command | Description |
|---------|-------------|
| `summarize` | Generate activity summary |
| `cache --stats` | Show cache statistics |
| `cache --clear` | Clear cached data |
| `test-connection` | Verify Slack and Claude API connections |

### Summarize Options

| Option | Description | Default |
|--------|-------------|---------|
| `-d, --date <date>` | Target date (today, yesterday, YYYY-MM-DD) | `today` |
| `-s, --span <span>` | Time span (day, week) | `day` |
| `-o, --output <file>` | Output file path | `./slack-summary.json` |
| `-m, --model <model>` | Claude model (haiku, sonnet) | `haiku` |
| `-u, --user <userId>` | Slack user ID | Token owner |

## MCP Server

The MCP server exposes Slack functionality to Claude and other MCP clients.

### Running the Server

```bash
pnpm dev:mcp
```

### Claude Code Integration

To use as an MCP server in [Claude Code](https://claude.ai/code), add this to your settings file (`~/.claude/settings.json` or project `.claude/settings.json`):

```json
{
  "mcpServers": {
    "slack-summarizer": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "slack-summarizer-cache:/cache",
        "-e", "SLACK_USER_TOKEN=xoxp-your-token",
        "-e", "ANTHROPIC_API_KEY=sk-ant-your-key",
        "-e", "SLACK_SUMMARIZER_TIMEZONE=America/Los_Angeles",
        "ghcr.io/hansef/slack-summarizer:latest"
      ]
    }
  }
}
```

Pull the image first:

```bash
docker pull ghcr.io/hansef/slack-summarizer:latest
```

Then restart Claude Code to load the MCP server.

**Optional:** Add more `-e` flags for additional settings:

| Flag | Description |
|------|-------------|
| `-e OPENAI_API_KEY=...` | Enable semantic embeddings for better conversation grouping |
| `-e SLACK_SUMMARIZER_ENABLE_EMBEDDINGS=true` | Required with OpenAI key to enable embeddings |
| `-e SLACK_SUMMARIZER_CLAUDE_MODEL=claude-sonnet-4-5-20250929` | Use Sonnet instead of Haiku (default) |

### Available Tools

#### High-Level Tools

| Tool | Description |
|------|-------------|
| `slack_get_user_summary` | Generate comprehensive summary of a user's Slack activity |

#### Primitive Tools

| Tool | Description |
|------|-------------|
| `slack_search_messages` | Search messages with Slack modifiers (from:, in:, has:reaction) |
| `slack_get_channel_history` | Get message history for a channel |
| `slack_get_thread` | Get all messages in a thread |
| `slack_get_reactions` | Get reactions given by a user |
| `slack_list_channels` | List channels the user is a member of |

## Docker

### Build and Run

```bash
# Build image
pnpm docker:build

# Run MCP server
pnpm docker:mcp

# Run CLI commands
pnpm docker:cli summarize --date yesterday
```

### Docker Compose Services

- `slack-summarizer` - MCP server with stdio transport
- `cli-test` - CLI interface for running commands

## Development

```bash
# Run CLI in development
pnpm dev:cli

# Run MCP server in development
pnpm dev:mcp

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Type check
pnpm typecheck

# Lint
pnpm lint

# Format code
pnpm format
```

## Project Structure

```
src/
├── cli/                     # Command-line interface
│   ├── index.ts            # CLI entry point
│   ├── commands/           # Command implementations
│   └── output.ts           # Formatted console output
├── core/                    # Core business logic
│   ├── cache/              # SQLite message caching
│   ├── consolidation/      # Reference extraction and conversation grouping
│   ├── embeddings/         # OpenAI embeddings for semantic similarity
│   ├── models/             # Data models and schemas
│   ├── segmentation/       # Conversation segmentation (time + semantic)
│   ├── slack/              # Slack API client and fetching
│   └── summarization/      # Claude summarization with narrative prompts
├── mcp/                     # MCP server
│   ├── server.ts           # Server entry point
│   ├── resources.ts        # Resource definitions
│   └── tools/              # Tool implementations
└── utils/                   # Utilities (dates, env, logger)
```

## Architecture

### Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              SLACK SUMMARIZER PIPELINE                           │
└─────────────────────────────────────────────────────────────────────────────────┘

                                    ┌─────────────┐
                                    │  Slack API  │
                                    └──────┬──────┘
                                           │
                    ┌──────────────────────▼──────────────────────┐
                    │              DATA FETCHER                    │
                    │         (src/core/slack/fetcher.ts)          │
                    │                                              │
                    │  • Search-first: from:@user to find activity │
                    │  • Fetch history for active channels only    │
                    │  • 24-hour lookback for context              │
                    │  • Day-bucketed SQLite caching               │
                    └──────────────────────┬──────────────────────┘
                                           │
                                           ▼
                    ┌──────────────────────────────────────────────┐
                    │              SEGMENTATION                     │
                    │        (src/core/segmentation/)               │
                    │                                              │
                    │  ┌─────────────────────────────────────────┐ │
                    │  │ 1. Thread Separation                    │ │
                    │  │    Threads extracted as separate convos │ │
                    │  └──────────────────┬──────────────────────┘ │
                    │                     ▼                        │
                    │  ┌─────────────────────────────────────────┐ │
                    │  │ 2. Time-Based (time-based.ts)           │ │
                    │  │    Split on 60-min gaps                 │ │
                    │  └──────────────────┬──────────────────────┘ │
                    │                     ▼                        │
                    │  ┌─────────────────────────────────────────┐ │
                    │  │ 3. Semantic (semantic.ts)               │ │
                    │  │    Claude Haiku detects topic shifts    │ │
                    │  │    (segments with ≥3 messages)          │ │
                    │  └──────────────────┬──────────────────────┘ │
                    │                     ▼                        │
                    │  ┌─────────────────────────────────────────┐ │
                    │  │ 4. Context Enrichment                   │ │
                    │  │    • @mention lookback (prior context)  │ │
                    │  │    • Short segment expansion            │ │
                    │  └─────────────────────────────────────────┘ │
                    │                                              │
                    │  Output: List of Conversation objects        │
                    └──────────────────────┬──────────────────────┘
                                           │
                                           ▼
                    ┌──────────────────────────────────────────────┐
                    │              CONSOLIDATION                    │
                    │        (src/core/consolidation/)              │
                    │                                              │
                    │  ┌─────────────────────────────────────────┐ │
                    │  │ Pre-processing                          │ │
                    │  │ • Merge bot convos into adjacent (30m)  │ │
                    │  │ • Merge trivial (<100 chars) convos     │ │
                    │  └──────────────────┬──────────────────────┘ │
                    │                     ▼                        │
                    │  ┌─────────────────────────────────────────┐ │
                    │  │ Reference Extraction                    │ │
                    │  │ (reference-extractor.ts)                │ │
                    │  │                                         │ │
                    │  │ • GitHub: #123, owner/repo#456, URLs    │ │
                    │  │ • Jira tickets: PROJ-123                │ │
                    │  │ • Errors: NetworkError, 500 error       │ │
                    │  │ • Services: xxx-auth, xxx-api           │ │
                    │  │ • Slack message links                   │ │
                    │  └──────────────────┬──────────────────────┘ │
                    │                     ▼                        │
                    │  ┌─────────────────────────────────────────┐ │
                    │  │ Similarity Calculation                  │ │
                    │  │                                         │ │
                    │  │ ┌─────────────────────────────────────┐ │ │
                    │  │ │ Reference Similarity (Jaccard)      │ │ │
                    │  │ │ |A ∩ B| / |A ∪ B|                   │ │ │
                    │  │ └─────────────────────────────────────┘ │ │
                    │  │              +                          │ │
                    │  │ ┌─────────────────────────────────────┐ │ │
                    │  │ │ Embedding Similarity (optional)     │ │ │
                    │  │ │ OpenAI text-embedding-3-small       │ │ │
                    │  │ │ Cosine similarity, normalized 0-1   │ │ │
                    │  │ │ Cached by SHA-256 text hash         │ │ │
                    │  │ └─────────────────────────────────────┘ │ │
                    │  │              ↓                          │ │
                    │  │  Hybrid = 0.6×ref + 0.4×emb (default)   │ │
                    │  └──────────────────┬──────────────────────┘ │
                    │                     ▼                        │
                    │  ┌─────────────────────────────────────────┐ │
                    │  │ Union-Find Grouping (consolidator.ts)  │ │
                    │  │                                         │ │
                    │  │ Merge Strategies:                       │ │
                    │  │ • Adjacent: ≤15 min gap (unconditional) │ │
                    │  │ • Proximity: ≤90 min + sim ≥0.20        │ │
                    │  │ • Same-author: ≤360 min + sim ≥0.20     │ │
                    │  │ • Reference: ≤240 min + sim ≥0.40       │ │
                    │  └─────────────────────────────────────────┘ │
                    │                                              │
                    │  Output: ConversationGroup[]                 │
                    └──────────────────────┬──────────────────────┘
                                           │
                                           ▼
                    ┌──────────────────────────────────────────────┐
                    │              SUMMARIZATION                    │
                    │       (src/core/summarization/)               │
                    │                                              │
                    │  • Generate Slack permalinks                 │
                    │  • Enrich shared Slack message links         │
                    │  • Batch groups (5 at a time) to Claude      │
                    │  • 2-4 sentence narrative story arcs         │
                    │  • Key events, references, outcomes          │
                    │  • Next actions and commitments              │
                    └──────────────────────┬──────────────────────┘
                                           │
                                           ▼
                              ┌────────────────────┐
                              │   SummaryOutput    │
                              │   (JSON schema)    │
                              └────────────────────┘
```

### Phase 1: Data Fetching (Search-First Strategy)

The fetcher uses Slack's search API to minimize API calls:

1. **Search for user activity** - Uses `from:@user` to find all messages sent in the time range
2. **Identify active channels** - Extracts unique channel IDs from search results (typically 5-20 channels instead of 300+)
3. **Fetch channel context** - Retrieves full message history only for channels where the user was active
4. **24-hour lookback** - Fetches an extra 24 hours before the start date to capture conversation context
5. **Thread extraction** - Identifies threads from search results and channel history, fetches full thread replies
6. **Fetch mentions & reactions** - Retrieves @mentions and reactions using optimized APIs

This approach reduces API calls by ~95% compared to scanning all channels.

**Caching strategy:**
- Day-bucketed caching in SQLite (key: `userId:channelId:dayBucket`)
- Today is never cached (always fetched fresh)
- Historical days cached indefinitely

**Key files:**
- `src/core/slack/fetcher.ts` - Orchestrates data collection
- `src/core/slack/client.ts` - Slack WebClient wrapper with rate limiting
- `src/core/cache/` - Day-bucketed SQLite caching

### Phase 2: Segmentation

Messages are grouped into logical conversations through a hybrid approach:

**Thread Separation** (`src/core/segmentation/hybrid.ts`)
- Threads (where `thread_ts !== ts`) extracted as separate conversations
- Marked with `isThread: true` and contain full thread replies
- Never split by time or semantic analysis

**Time-Based Segmentation** (`src/core/segmentation/time-based.ts`)
- Groups consecutive messages with <60 minute gaps (tuned for async teams)
- Fast first pass that handles ~80% of segmentation correctly

**Semantic Boundary Detection** (`src/core/segmentation/semantic.ts`)
- Claude Haiku analyzes segments with ≥3 messages for topic changes
- Processes 20 message pairs per batch
- Returns boundary indices where topics shift
- Confidence threshold: 0.6

**Context Enrichment** (`src/core/segmentation/context-enricher.ts`)
- **@Mention lookback**: When user is @mentioned into a conversation (didn't send first message), fetches channel messages from start of day until the @mention (up to 20 messages, marked as `[PRIOR CONTEXT]`)
- **Short segment expansion**: For segments with ≤2 user messages, looks back to add surrounding context (target 5 messages, max 60-min gap, marked as `[CONTEXT]`)

**Output:** List of `Conversation` objects, each containing:
- Messages array (including context messages if enriched)
- Channel info and participants
- Thread metadata if applicable
- Time boundaries

### Phase 3: Consolidation

Related conversations are grouped together for coherent summaries:

**Pre-processing**
1. **Bot conversation merging**: Bot-only conversations (GitHub, CircleCI) merged into adjacent human conversations within 30 min
2. **Trivial conversation merging**: 1-2 message conversations (<100 chars total) merged into adjacent substantive ones within 30 min

**Reference Extraction** (`src/core/consolidation/reference-extractor.ts`)

Identifies shared references across conversations:
- GitHub issues: `#123`, `owner/repo#456`
- GitHub URLs: `github.com/.../issues/123` → normalized to `#123`
- Jira tickets: `PROJ-123`
- Error patterns: `NetworkError`, `500 error`
- Service names: `xxx-auth`, `xxx-api`
- Slack message links: normalized to `slack:channel:ts`
- User mentions (excluded from similarity calculation - same person ≠ same topic)

**Similarity Calculation**

Two similarity metrics are combined:

1. **Reference Similarity** (Jaccard index)
   - `|A ∩ B| / |A ∪ B|` where A and B are sets of extracted references
   - Works well for explicit shared references

2. **Embedding Similarity** (optional, requires `OPENAI_API_KEY`)
   - Generates embeddings using `text-embedding-3-small`
   - Cosine similarity normalized to 0-1 range (negative values → 0)
   - Catches semantic relationships without explicit references
   - Cached in SQLite by SHA-256 text hash

**Hybrid Formula:** `0.6 × reference_similarity + 0.4 × embedding_similarity`

**Union-Find Grouping** (`src/core/consolidation/consolidator.ts`)

Multiple merge strategies with path compression:

| Strategy | Time Gap | Similarity | Notes |
|----------|----------|------------|-------|
| Adjacent merge | ≤15 min | None required | Unconditional - clearly same discussion |
| Proximity merge | ≤90 min (180 DM) | ≥0.20 (0.10 DM) | Same author + min content overlap |
| Same-author merge | ≤360 min | ≥0.20 | User participated in both |
| Reference/embedding | ≤240 min | ≥0.40 | General similarity threshold |

### Phase 4: Summarization

Each consolidated group is summarized by Claude:

**Pre-processing** (`src/core/summarization/aggregator.ts`)
- Generate Slack permalinks for each conversation group
- Enrich Slack message links: Fetch content for shared Slack URLs that weren't auto-unfurled

**Narrative Prompts** (`src/core/summarization/prompts.ts`)
- 2-4 sentence story arcs from user's perspective (without "I" pronouns)
- Terse, action-oriented language (e.g., "Fixed the bug", "Discussed options with Chelsea")
- Key events with context (2-5 bullet points)
- References detected (issues, projects, errors)
- Outcome, decision, or current status
- Next actions: explicit commitments, joint commitments, flagged items

**Context Message Handling**
- Messages marked `[PRIOR CONTEXT]` explain the situation user responded to
- Messages marked `[CONTEXT]` provide surrounding context
- Prompts instruct Claude to SET UP the story with context, then FOCUS on user's actions

**Batch Processing** (`src/core/summarization/client.ts`)
- Groups processed in batches of 5 for efficiency
- ≤2 groups summarized individually for better quality
- User IDs resolved to display names (bulk fetch + per-user fallback)

**Output:** `SummaryOutput` JSON with channel summaries, topic narratives, and consolidation stats

## Output Format

The summary output (schema version 2.0.0) includes:

```json
{
  "metadata": {
    "generated_at": "2024-01-15T18:30:00Z",
    "schema_version": "2.0.0",
    "request": {
      "user_id": "U123456",
      "period_start": "2024-01-15T00:00:00-08:00",
      "period_end": "2024-01-15T23:59:59-08:00",
      "timezone": "America/Los_Angeles"
    }
  },
  "summary": {
    "total_channels": 8,
    "total_messages": 47,
    "mentions_received": 12,
    "threads_participated": 6,
    "reactions_given": 23
  },
  "channels": [
    {
      "channel_id": "C123",
      "channel_name": "engineering",
      "channel_type": "public_channel",
      "interactions": {
        "messages_sent": 15,
        "mentions_received": 4,
        "threads": 3
      },
      "topics": [
        {
          "narrative_summary": "Team investigated checkout failures related to issue #2068. After reviewing error logs and CI output, identified a race condition in the payment service that was causing intermittent 500 errors.",
          "start_time": "2024-01-15T10:30:00-08:00",
          "end_time": "2024-01-15T14:45:00-08:00",
          "message_count": 23,
          "user_messages": 8,
          "participants": ["@alice", "@bob", "@charlie"],
          "key_events": [
            "Alice reported 500 errors in checkout flow",
            "Bob identified race condition in payment-service",
            "Charlie deployed hotfix to staging"
          ],
          "references": ["#2068", "payment-service", "500 error"],
          "outcome": "Hotfix deployed to staging, pending QA verification",
          "next_actions": ["Run full test suite after QA approval"],
          "timesheet_entry": "Debugged checkout failures and deployed hotfix for #2068",
          "slack_link": "https://workspace.slack.com/archives/C123/p1234567890",
          "slack_links": [
            "https://workspace.slack.com/archives/C123/p1234567890",
            "https://workspace.slack.com/archives/C123/p1234600000"
          ],
          "segments_merged": 3
        }
      ],
      "consolidation_stats": {
        "original_segments": 7,
        "consolidated_topics": 2,
        "bot_messages_merged": 3,
        "trivial_messages_merged": 1,
        "adjacent_merged": 2,
        "proximity_merged": 1,
        "same_author_merged": 0
      }
    }
  ]
}
```

## License

ISC
