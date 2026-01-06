import { createLogger } from '@/utils/logging/index.js';

const logger = createLogger({ component: 'SemanticAnalysis' });
import { SlackMessage } from '@/core/models/slack.js';
import { MessagePair } from '@/core/models/conversation.js';
import { getClaudeProvider, type ClaudeBackend } from '@/core/llm/index.js';

const BATCH_SIZE = 20; // Process 20 message pairs at once

export interface SemanticAnalysisConfig {
  apiKey?: string;
  oauthToken?: string;
  batchSize?: number;
}

export interface BoundaryDecision {
  index: number;
  isBoundary: boolean;
  confidence: number;
}

export async function analyzeConversationBoundaries(
  messages: SlackMessage[],
  config: SemanticAnalysisConfig = {}
): Promise<BoundaryDecision[]> {
  if (messages.length <= 1) {
    return [];
  }

  const batchSize = config.batchSize ?? BATCH_SIZE;

  // Get backend from provider
  const provider = getClaudeProvider({
    apiKey: config.apiKey,
    oauthToken: config.oauthToken,
  });
  const backend = provider.getBackend();

  // Create message pairs for analysis
  const pairs: MessagePair[] = [];
  const sorted = [...messages].sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));

  for (let i = 0; i < sorted.length - 1; i++) {
    pairs.push({
      first: {
        text: sorted[i].text || '[no text]',
        user: sorted[i].user,
        ts: sorted[i].ts,
      },
      second: {
        text: sorted[i + 1].text || '[no text]',
        user: sorted[i + 1].user,
        ts: sorted[i + 1].ts,
      },
      index: i,
    });
  }

  // Process in batches
  const allDecisions: BoundaryDecision[] = [];

  for (let i = 0; i < pairs.length; i += batchSize) {
    const batch = pairs.slice(i, i + batchSize);
    const decisions = await analyzeBatch(backend, batch);
    allDecisions.push(...decisions);
  }

  return allDecisions;
}

async function analyzeBatch(
  backend: ClaudeBackend,
  pairs: MessagePair[]
): Promise<BoundaryDecision[]> {
  const pairsText = pairs
    .map(
      (pair, idx) => `Pair ${idx + 1}:
Message A (from ${pair.first.user ?? 'unknown'}): "${truncate(pair.first.text, 200)}"
Message B (from ${pair.second.user ?? 'unknown'}): "${truncate(pair.second.text, 200)}"`
    )
    .join('\n\n');

  const prompt = `You are analyzing Slack messages to detect conversation boundaries. For each message pair below, determine if they belong to the SAME conversation topic (false = same topic, no boundary) or if Message B starts a NEW topic (true = topic shift, boundary detected).

Consider:
- Topic continuity and subject matter
- Whether Message B responds to or continues from Message A
- Logical flow of discussion
- Participant overlap is less important than topic continuity

${pairsText}

Respond with ONLY a JSON array of objects, one per pair, with "index" (1-based pair number) and "boundary" (true if new topic, false if same topic):
[{"index": 1, "boundary": false}, {"index": 2, "boundary": true}, ...]`;

  try {
    const response = await backend.createMessage({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (!content || content.type !== 'text') {
      throw new Error('Unexpected response type');
    }

    // Parse the JSON response
    const jsonMatch = content.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logger.warn(
        { response: content.text.substring(0, 200) },
        'Failed to extract JSON from semantic analysis response'
      );
      // Fall back to no boundaries
      return pairs.map((pair) => ({
        index: pair.index,
        isBoundary: false,
        confidence: 0.5,
      }));
    }

    const parsed = JSON.parse(jsonMatch[0]) as Array<{ index: number; boundary: boolean }>;

    return parsed.map((item, idx) => ({
      index: pairs[idx].index,
      isBoundary: item.boundary,
      confidence: 0.8, // Fixed confidence for now
    }));
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Semantic analysis failed'
    );

    // Fall back to no boundaries on error
    return pairs.map((pair) => ({
      index: pair.index,
      isBoundary: false,
      confidence: 0.5,
    }));
  }
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + '...';
}

export function applyBoundaryDecisions(
  _messages: SlackMessage[],
  decisions: BoundaryDecision[],
  confidenceThreshold = 0.6
): number[] {
  // Returns indices where boundaries should be placed
  const boundaries: number[] = [];

  for (const decision of decisions) {
    if (decision.isBoundary && decision.confidence >= confidenceThreshold) {
      boundaries.push(decision.index + 1); // Boundary is AFTER the first message
    }
  }

  return boundaries;
}
