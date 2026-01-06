import { Conversation } from '@/core/models/conversation.js';
import { ConversationGroup } from '@/core/consolidation/consolidator.js';
import { SlackMessage, SlackAttachment } from '@/core/models/slack.js';
import { isContextMessage, CONTEXT_SUBTYPES } from '@/core/segmentation/context-enricher.js';

export function buildConversationSummaryPrompt(
  conversation: Conversation,
  userDisplayNames: Map<string, string>
): string {
  const channelInfo = conversation.channelName
    ? `Channel: #${conversation.channelName}`
    : `Channel ID: ${conversation.channelId}`;

  const timeRange = `${conversation.startTime} to ${conversation.endTime}`;
  const isThread = conversation.isThread ? ' (Thread)' : '';

  const messagesText = conversation.messages
    .map((msg) => {
      const userName = msg.user ? userDisplayNames.get(msg.user) ?? msg.user : 'Unknown';
      const text = msg.text || '[no text]';
      return `[${userName}]: ${truncate(text, 500)}`;
    })
    .join('\n');

  return `You are summarizing a Slack conversation for a daily activity digest.

${channelInfo}${isThread}
Time Range: ${timeRange}
Message Count: ${conversation.messageCount}
Participants: ${conversation.participants.length}

Messages:
${messagesText}

Provide a JSON response with exactly this structure:
{
  "topic": "Brief topic description (5-15 words)",
  "keyPoints": ["Key point 1", "Key point 2"],
  "participantUsernames": ["@username1", "@username2"]
}

Rules:
- Be concise and focus on actionable information
- Extract 1-3 key points that capture decisions, action items, or important information
- Use @ mentions for participant usernames
- If the conversation is casual/social, note that in the topic
- If no clear topic, describe the general nature of the exchange`;
}

export function buildBatchSummaryPrompt(
  conversations: Conversation[],
  userDisplayNames: Map<string, string>
): string {
  const conversationTexts = conversations.map((conv, idx) => {
    const channelInfo = conv.channelName ? `#${conv.channelName}` : conv.channelId;
    const isThread = conv.isThread ? ' (Thread)' : '';

    const messagesText = conv.messages
      .slice(0, 10) // Limit to first 10 messages for batch
      .map((msg) => {
        const userName = msg.user ? userDisplayNames.get(msg.user) ?? msg.user : 'Unknown';
        return `[${userName}]: ${truncate(msg.text || '[no text]', 200)}`;
      })
      .join('\n');

    return `--- Conversation ${idx + 1} (${channelInfo}${isThread}, ${conv.messageCount} messages) ---
${messagesText}`;
  });

  return `You are summarizing multiple Slack conversations for a daily activity digest.

${conversationTexts.join('\n\n')}

For each conversation, provide a JSON response with this structure:
[
  {
    "index": 1,
    "topic": "Brief topic (5-15 words)",
    "keyPoints": ["Key point 1"],
    "participantUsernames": ["@user1"]
  },
  ...
]

Rules:
- Be concise, each topic should be 5-15 words
- Extract 1-2 key points per conversation
- Use @ mentions for usernames
- Return valid JSON array with one object per conversation`;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + '...';
}

export interface ParsedConversationSummary {
  topic: string;
  keyPoints: string[];
  participantUsernames: string[];
}

export function parseSingleSummaryResponse(response: string): ParsedConversationSummary | null {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      topic?: string;
      keyPoints?: string[];
      participantUsernames?: string[];
    };

    return {
      topic: parsed.topic ?? 'Unknown topic',
      keyPoints: parsed.keyPoints ?? [],
      participantUsernames: parsed.participantUsernames ?? [],
    };
  } catch {
    return null;
  }
}

export function parseBatchSummaryResponse(
  response: string
): ParsedConversationSummary[] | null {
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      index?: number;
      topic?: string;
      keyPoints?: string[];
      participantUsernames?: string[];
    }>;

    return parsed.map((item) => ({
      topic: item.topic ?? 'Unknown topic',
      keyPoints: item.keyPoints ?? [],
      participantUsernames: item.participantUsernames ?? [],
    }));
  } catch {
    return null;
  }
}

// ============================================================================
// Narrative Summarization Prompts (for consolidated conversation groups)
// ============================================================================

/**
 * Resolve Slack user mentions in message text to display names
 * Converts <@U12345|name> or <@U12345> to the actual display name
 */
function resolveUserMentionsInText(
  text: string,
  userDisplayNames: Map<string, string>
): string {
  // Match Slack user mentions: <@U12345|display_name> or <@U12345>
  return text.replace(/<@(U[A-Z0-9]+)(?:\|[^>]+)?>/g, (match, userId: string) => {
    const displayName = userDisplayNames.get(userId);
    return displayName ? `@${displayName}` : match;
  });
}

/**
 * Format attachments (shared messages, unfurls, etc.) for context
 * Returns formatted string or empty if no meaningful attachment content
 */
function formatAttachments(
  attachments: SlackAttachment[] | undefined,
  userDisplayNames: Map<string, string>
): string {
  if (!attachments || attachments.length === 0) {
    return '';
  }

  const parts: string[] = [];
  for (const att of attachments) {
    // Build context for where this came from
    const sourceInfo: string[] = [];
    if (att.author_name) {
      sourceInfo.push(`from ${att.author_name}`);
    } else if (att.author_id) {
      const displayName = userDisplayNames.get(att.author_id);
      if (displayName) {
        sourceInfo.push(`from ${displayName}`);
      }
    }
    if (att.channel_name) {
      sourceInfo.push(`in #${att.channel_name}`);
    }

    // Get the actual content - prefer text, fall back to fallback
    const content = att.text || att.fallback || att.title;
    if (!content) continue;

    // Resolve any user mentions in attachment text
    const resolvedContent = resolveUserMentionsInText(content, userDisplayNames);

    // Format as quoted content
    if (sourceInfo.length > 0) {
      parts.push(`[Shared message ${sourceInfo.join(' ')}]: "${truncate(resolvedContent, 300)}"`);
    } else if (att.from_url) {
      parts.push(`[Shared link]: "${truncate(resolvedContent, 300)}"`);
    } else {
      parts.push(`[Attachment]: "${truncate(resolvedContent, 300)}"`);
    }
  }

  return parts.join('\n');
}

/**
 * Format messages for the narrative prompt, handling bot messages and context appropriately
 */
function formatMessagesForNarrative(
  messages: SlackMessage[],
  userDisplayNames: Map<string, string>,
  maxMessages = 50
): string {
  const selected = messages.slice(0, maxMessages);

  return selected
    .map((msg) => {
      // Determine message type for labeling
      const isContext = isContextMessage(msg);
      const isMentionContext = msg.subtype === CONTEXT_SUBTYPES.MENTION_CONTEXT;
      const isBot = msg.subtype === 'bot_message' || (!msg.user && !isContext);

      const userName = isBot
        ? 'Bot'
        : msg.user
          ? userDisplayNames.get(msg.user) ?? msg.user
          : 'Unknown';

      // Add prefix for context messages to help Claude understand their role
      let contextPrefix = '';
      if (isMentionContext) {
        contextPrefix = '[PRIOR CONTEXT] ';
      } else if (isContext) {
        contextPrefix = '[CONTEXT] ';
      }

      // Resolve user mentions in message text to display names
      const text = resolveUserMentionsInText(msg.text || '', userDisplayNames);

      // Format any attachments (shared messages, unfurls)
      const attachmentText = formatAttachments(msg.attachments, userDisplayNames);

      // Build the full message representation
      const parts: string[] = [];
      if (text) {
        parts.push(`${contextPrefix}[${userName}]: ${truncate(text, 5000)}`);
      }
      if (attachmentText) {
        // If there's no text but there are attachments, show who posted the attachment
        if (!text) {
          parts.push(`${contextPrefix}[${userName}] shared:`);
        }
        parts.push(attachmentText);
      }

      // If neither text nor attachments, show placeholder
      if (parts.length === 0) {
        parts.push(`${contextPrefix}[${userName}]: [no text]`);
      }

      return parts.join('\n');
    })
    .join('\n');
}

/**
 * Check if a conversation group contains context messages
 */
function hasContextMessages(group: ConversationGroup): boolean {
  return group.allMessages.some(isContextMessage);
}

/**
 * Build context instructions for the prompt
 */
function buildContextInstructions(hasContext: boolean, userDisplayName: string): string {
  if (!hasContext) return '';

  return `
IMPORTANT - Context Messages:
- Messages marked [PRIOR CONTEXT] or [CONTEXT] provide background for WHY ${userDisplayName} was involved
- Use these to briefly SET UP the narrative (e.g., "After Chris investigated a duplicate bar number issue and identified the root cause...")
- The narrative should FOCUS on ${userDisplayName}'s responses and actions, not retell the entire context
- Context messages are NOT ${userDisplayName}'s activity - they explain the situation ${userDisplayName} responded to
`;
}

/**
 * Build a narrative summary prompt for a consolidated group of conversations
 */
export function buildNarrativeGroupPrompt(
  group: ConversationGroup,
  userDisplayName: string,
  userDisplayNames: Map<string, string>
): string {
  const channelInfo = group.conversations[0]?.channelName
    ? `#${group.conversations[0].channelName}`
    : group.conversations[0]?.channelId ?? 'unknown channel';

  const threadInfo = group.hasThreads ? ' (includes thread replies)' : '';
  const timeRange = `${group.startTime} to ${group.endTime}`;

  const messagesText = formatMessagesForNarrative(group.allMessages, userDisplayNames);

  const referencesHint =
    group.sharedReferences.length > 0
      ? `\nDetected references: ${group.sharedReferences.join(', ')}`
      : '';

  const contextInstructions = buildContextInstructions(hasContextMessages(group), userDisplayName);

  return `You are writing a daily activity summary for ${userDisplayName} using terse, action-oriented language (no "I" pronouns).

Channel: ${channelInfo}${threadInfo}
Time Range: ${timeRange}
Total Messages: ${group.totalMessageCount}
Participants: ${group.participants.length}${referencesHint}
${contextInstructions}
Messages:
${messagesText}

Provide a JSON response with exactly this structure:
{
  "narrative": "A 2-4 sentence narrative from ${userDisplayName}'s perspective (without 'I' pronouns) that tells the story of what happened, including context, key events, and outcomes or next steps.",
  "keyEvents": ["Event 1 with context", "Event 2 with context", "Event 3 with context"],
  "references": ["#issue-number", "project-name", "error-pattern"],
  "participants": ["@username1", "@username2"],
  "outcome": "Brief description of resolution, decision, or current status (or null if ongoing/unclear)",
  "nextActions": ["Action with timing context", "Another action"],
  "timesheetEntry": "Past-tense action phrase for timesheet (10-15 words max)"
}

Rules:
- Write from ${userDisplayName}'s perspective using terse, action-oriented language WITHOUT "I" pronouns (e.g., "Completed the deployment", "Discussed options with Chelsea", "Confirmed the fix works")
- The narrative should be 2-4 complete sentences that tell the full story arc
- Focus on actions ${userDisplayName} took, decisions made, and conversations had
- IMPORTANT: Include specific details from other participants' messages that explain WHAT was being discussed (e.g., "After Stephanie proposed splitting the text box into labeled fields for Andy's workflow, suggested scheduling a design review" not just "Discussed design changes")
- ALWAYS use participants' actual names in the narrative - NEVER use generic terms like "team member", "colleague", "someone", "a user", etc. (e.g., "Helped Khanh with the audit" not "Helped team member with the audit")
- Include project context, issue numbers, and technical details when present
- For key events, include 2-5 significant moments with enough context to understand them
- Bot messages (GitHub, CircleCI, etc.) are valuable context - incorporate them naturally (e.g., "Received notification that...", "Saw that the build failed...")
- IMPORTANT: When bot messages or attachments mention PRs, issues, features, or implementations, extract WHAT specifically was implemented/merged/fixed (e.g., "Reviewed Cody's PR adding OAuth2 support" not just "Reviewed Cody's implementation")
- References should include issue numbers, project names, and notable technical terms
- Use @mentions ONLY in the participants array, NOT in narrative or keyEvents text
- The outcome should capture any resolution, decision, or current status
- Focus on actionable information and decisions ${userDisplayName} was involved in
- nextActions: Extract action items where ${userDisplayName} needs to do something in the future
  - CRITICAL: Each action MUST be self-contained and understandable in isolation (e.g., "Improve README documentation for slack-summarizer MCP server" NOT just "Improve README documentation")
  - Include project name, feature name, or other identifying context so the action makes sense as a standalone todo item
  - If no clear project/feature context exists, include the channel name (e.g., "Follow up on deployment discussion in #infrastructure")
  - Include explicit commitments ("I'll...", "I will...", "will send...")
  - Include joint commitments involving ${userDisplayName} ("we need to...", "we should...", "we can investigate...")
  - Include items explicitly flagged for future action ("dropping this here so we can...", "need to look into this", "flagging for later")
  - Include timing when mentioned (e.g., "by end of week", "tomorrow", "after QA approval")
  - Return empty array [] if there are no clear future actions - do not infer actions from general discussion
  - timesheetEntry: A concise, professional timesheet entry (10-15 words max)
  - Start with a past-tense action verb (e.g., "Reviewed", "Debugged", "Implemented", "Discussed", "Resolved")
  - Focus on the concrete work accomplished, not emotions or social dynamics
  - Include key technical context (project names, issue numbers, feature names)
  - Examples: "Debugged OAuth token refresh issue in production API", "Reviewed and approved PR for user onboarding flow", "Coordinated deployment timeline with DevOps team"`;
}

/**
 * Build a narrative summary prompt for multiple consolidated groups
 */
export function buildNarrativeBatchPrompt(
  groups: ConversationGroup[],
  userDisplayName: string,
  userDisplayNames: Map<string, string>
): string {
  // Check if any group has context messages
  const anyHasContext = groups.some(hasContextMessages);

  const groupTexts = groups.map((group, idx) => {
    const channelInfo = group.conversations[0]?.channelName
      ? `#${group.conversations[0].channelName}`
      : group.conversations[0]?.channelId ?? 'unknown';

    const threadInfo = group.hasThreads ? ' (thread)' : '';
    const messagesText = formatMessagesForNarrative(group.allMessages, userDisplayNames, 30);

    const refsHint =
      group.sharedReferences.length > 0 ? ` | refs: ${group.sharedReferences.slice(0, 3).join(', ')}` : '';

    return `--- Topic ${idx + 1} (${channelInfo}${threadInfo}, ${group.totalMessageCount} messages${refsHint}) ---
${messagesText}`;
  });

  const contextInstructions = anyHasContext
    ? `
IMPORTANT - Context Messages:
- Messages marked [PRIOR CONTEXT] or [CONTEXT] provide background for WHY ${userDisplayName} was involved
- Use these to briefly SET UP the narrative (e.g., "After Chris investigated a duplicate bar number issue...")
- The narrative should FOCUS on ${userDisplayName}'s responses and actions, not retell the entire context
- Context messages are NOT ${userDisplayName}'s activity - they explain the situation ${userDisplayName} responded to
`
    : '';

  return `You are writing daily activity summaries for ${userDisplayName} using terse, action-oriented language (no "I" pronouns). Each topic may contain messages from multiple time segments that were grouped together because they relate to the same issue or project.
${contextInstructions}
${groupTexts.join('\n\n')}

For each topic, provide a JSON response with this structure:
[
  {
    "index": 1,
    "narrative": "2-4 sentence narrative from ${userDisplayName}'s perspective (without 'I' pronouns) telling the full story",
    "keyEvents": ["Event 1", "Event 2"],
    "references": ["#issue", "project"],
    "participants": ["@user1"],
    "outcome": "resolution or status (or null)",
    "nextActions": ["Action with timing context"],
    "timesheetEntry": "Past-tense action phrase for timesheet (10-15 words max)"
  },
  ...
]

Rules:
- Write from ${userDisplayName}'s perspective using terse, action-oriented language WITHOUT "I" pronouns (e.g., "Fixed the bug", "Decided to proceed", "Helped Sarah with...")
- Each narrative should be 2-4 complete sentences telling the story arc
- Focus on actions ${userDisplayName} took and conversations they had
- Include specific details from other participants that explain WHAT was discussed (e.g., "After Stephanie proposed splitting fields..." not just "Discussed design changes")
- ALWAYS use participants' actual names - NEVER use generic terms like "team member", "colleague", "someone" (e.g., "Helped Khanh" not "Helped team member")
- Include project context, issue numbers, and technical details
- Bot messages are valuable context - incorporate them naturally
- IMPORTANT: When bot messages or attachments mention PRs, issues, features, or implementations, extract WHAT specifically was implemented/merged/fixed (e.g., "Reviewed Cody's PR adding OAuth2 support" not just "Reviewed Cody's implementation")
- Key events should have enough context to understand them
- Use @mentions ONLY in the participants array
- nextActions: Extract future action items - each MUST be self-contained with project/feature context (e.g., "Improve README for slack-summarizer" not just "Improve README"); fall back to channel name if no project context; include explicit commitments, joint commitments ("we need to..."), items flagged for later (empty array if none)
- timesheetEntry: Concise timesheet entry (10-15 words max) - past-tense action verb, concrete work accomplished, no emotions, include technical context (e.g., "Debugged OAuth token refresh issue in production API")
- Return valid JSON array with one object per topic`;
}

export interface ParsedNarrativeSummary {
  narrative: string;
  keyEvents: string[];
  references: string[];
  participants: string[];
  outcome: string | null;
  nextActions: string[];
  timesheetEntry: string;
}

export function parseNarrativeSummaryResponse(response: string): ParsedNarrativeSummary | null {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      narrative?: string;
      keyEvents?: string[];
      references?: string[];
      participants?: string[];
      outcome?: string | null;
      nextActions?: string[];
      timesheetEntry?: string;
    };

    return {
      narrative: parsed.narrative ?? 'Discussion summary unavailable',
      keyEvents: parsed.keyEvents ?? [],
      references: parsed.references ?? [],
      participants: parsed.participants ?? [],
      outcome: parsed.outcome ?? null,
      nextActions: parsed.nextActions ?? [],
      timesheetEntry: parsed.timesheetEntry ?? 'Activity summary',
    };
  } catch {
    return null;
  }
}

export function parseNarrativeBatchResponse(response: string): ParsedNarrativeSummary[] | null {
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      index?: number;
      narrative?: string;
      keyEvents?: string[];
      references?: string[];
      participants?: string[];
      outcome?: string | null;
      nextActions?: string[];
      timesheetEntry?: string;
    }>;

    return parsed.map((item) => ({
      narrative: item.narrative ?? 'Discussion summary unavailable',
      keyEvents: item.keyEvents ?? [],
      references: item.references ?? [],
      participants: item.participants ?? [],
      outcome: item.outcome ?? null,
      nextActions: item.nextActions ?? [],
      timesheetEntry: item.timesheetEntry ?? 'Activity summary',
    }));
  } catch {
    return null;
  }
}
