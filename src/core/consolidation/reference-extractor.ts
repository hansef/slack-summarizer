import { Conversation } from '../models/conversation.js';
import { SlackMessage } from '../models/slack.js';

/**
 * Represents a reference found in a message (GitHub issue, error pattern, etc.)
 */
export interface Reference {
  type:
    | 'github_issue'
    | 'github_pr'
    | 'github_url'
    | 'error_pattern'
    | 'jira_ticket'
    | 'url'
    | 'user_mention'
    | 'aws_log_group'
    | 'service_name'
    | 'slack_message';
  value: string; // Normalized value (e.g., "#2068", "AUTH-123", "U12345")
  raw: string; // Original match from text
  messageTs: string; // Timestamp of the message containing this reference
}

/**
 * References extracted from a conversation
 */
export interface ConversationReferences {
  conversationId: string;
  references: Reference[];
  /** Unique normalized reference values for quick comparison */
  uniqueRefs: Set<string>;
}

/**
 * Pattern definitions for reference extraction
 */
const PATTERNS = {
  // GitHub issues: #123 (standalone) or org/repo#123
  // Requires whitespace/start before # to avoid matching word#123
  github_issue: /(?:^|[\s([])(?:([\w-]+\/[\w-]+)#|#)(\d+)\b/g,

  // GitHub PR/issue URLs: github.com/owner/repo/issues/123 or /pull/123
  github_url: /github\.com\/[\w-]+\/[\w-]+\/(?:issues|pull)\/(\d+)/gi,

  // Jira-style tickets: PROJ-123, AUTH-456 (require at least 2 capital letters)
  jira_ticket: /\b([A-Z]{2,}[A-Z0-9]*-\d+)\b/g,

  // Error patterns: PascalCase errors like NetworkError, NullPointerException
  // HTTP status codes require "error" or "status" after them
  error_pattern: /\b([A-Z][a-z]+(?:[A-Z][a-z]*)*(?:Error|Exception))\b|\b([45]\d{2})\s+(?:error|status)\b/gi,

  // Slack user mentions: <@U12345|display_name> or <@U12345>
  user_mention: /<@(U[A-Z0-9]+)(?:\|[^>]+)?>/g,

  // AWS CloudWatch log groups: extract log group name from CloudWatch URLs
  // Matches: log-group/service-name or log-group$252F (URL encoded)
  aws_log_group: /cloudwatch[^#]*#[^/]*log-groups\/log-group(?:\/|%252F|\$252F)([a-zA-Z0-9_-]+)/gi,

  // Service names: patterns like xxx-auth, xxx-api, xxx-web, xxx-service
  // Must be preceded by word boundary or common separators
  service_name: /\b([a-zA-Z][a-zA-Z0-9]*(?:prd|stg|dev|prod|stage)?-(?:auth|api|web|service|worker|backend|frontend|core|app))\b/gi,

  // Slack message links: https://[workspace].slack.com/archives/[channel]/p[timestamp]
  // Captures channel ID and timestamp for normalization
  slack_message: /https?:\/\/[\w-]+\.slack\.com\/archives\/([A-Z0-9]+)\/p(\d+)(?:\?[^\s]*)?/gi,
};

/**
 * Parsed Slack message link
 */
export interface SlackMessageLink {
  channelId: string;
  messageTs: string;
  raw: string;
}

/**
 * Parse Slack message links from text
 * Returns array of {channelId, messageTs, raw} for each link found
 */
export function parseSlackMessageLinks(text: string): SlackMessageLink[] {
  const links: SlackMessageLink[] = [];
  const regex = /https?:\/\/[\w-]+\.slack\.com\/archives\/([A-Z0-9]+)\/p(\d+)(?:\?[^\s]*)?/gi;

  for (const match of text.matchAll(regex)) {
    const channelId = match[1];
    const timestamp = match[2];
    if (channelId && timestamp) {
      // Convert p1234567890123456 to 1234567890.123456
      const ts = timestamp.length > 10
        ? `${timestamp.slice(0, 10)}.${timestamp.slice(10)}`
        : timestamp;
      links.push({
        channelId,
        messageTs: ts,
        raw: match[0],
      });
    }
  }

  return links;
}

/**
 * Extract references from a single message
 */
export function extractReferencesFromMessage(message: SlackMessage): Reference[] {
  const text = message.text || '';
  const references: Reference[] = [];

  // Extract GitHub issues (#123 or repo#123)
  for (const match of text.matchAll(PATTERNS.github_issue)) {
    // Group 1 is optional repo prefix, group 2 is issue number
    const issueNum = match[2];
    if (issueNum) {
      references.push({
        type: 'github_issue',
        value: `#${issueNum}`,
        raw: match[0].trim(),
        messageTs: message.ts,
      });
    }
  }

  // Extract GitHub URLs
  for (const match of text.matchAll(PATTERNS.github_url)) {
    const issueNum = match[1];
    references.push({
      type: 'github_url',
      value: `#${issueNum}`, // Normalize to same format as issues
      raw: match[0],
      messageTs: message.ts,
    });
  }

  // Extract Jira tickets (PROJ-123)
  for (const match of text.matchAll(PATTERNS.jira_ticket)) {
    references.push({
      type: 'jira_ticket',
      value: match[1].toUpperCase(),
      raw: match[0],
      messageTs: message.ts,
    });
  }

  // Extract error patterns
  for (const match of text.matchAll(PATTERNS.error_pattern)) {
    const errorName = match[1] || match[2];
    if (errorName) {
      references.push({
        type: 'error_pattern',
        value: errorName.toLowerCase(),
        raw: match[0],
        messageTs: message.ts,
      });
    }
  }

  // Extract user mentions (<@U12345|name> or <@U12345>)
  for (const match of text.matchAll(PATTERNS.user_mention)) {
    const userId = match[1];
    if (userId) {
      references.push({
        type: 'user_mention',
        value: userId, // Already normalized (e.g., U12345)
        raw: match[0],
        messageTs: message.ts,
      });
    }
  }

  // Extract AWS CloudWatch log group names from URLs
  for (const match of text.matchAll(PATTERNS.aws_log_group)) {
    const logGroup = match[1];
    if (logGroup) {
      references.push({
        type: 'aws_log_group',
        value: logGroup.toLowerCase(), // Normalize to lowercase
        raw: match[0],
        messageTs: message.ts,
      });
    }
  }

  // Extract service names (xxx-auth, xxx-api, etc.)
  for (const match of text.matchAll(PATTERNS.service_name)) {
    const serviceName = match[1];
    if (serviceName) {
      references.push({
        type: 'service_name',
        value: serviceName.toLowerCase(), // Normalize to lowercase
        raw: match[0],
        messageTs: message.ts,
      });
    }
  }

  // Extract Slack message links
  for (const match of text.matchAll(PATTERNS.slack_message)) {
    const channelId = match[1];
    const timestamp = match[2];
    if (channelId && timestamp) {
      // Normalize to slack:channel:ts format (convert p1234567890123456 to 1234567890.123456)
      const ts = timestamp.length > 10
        ? `${timestamp.slice(0, 10)}.${timestamp.slice(10)}`
        : timestamp;
      references.push({
        type: 'slack_message',
        value: `slack:${channelId}:${ts}`,
        raw: match[0],
        messageTs: message.ts,
      });
    }
  }

  return references;
}

/**
 * Extract all references from a conversation
 */
export function extractReferencesFromConversation(conversation: Conversation): ConversationReferences {
  const allRefs: Reference[] = [];

  for (const message of conversation.messages) {
    const messageRefs = extractReferencesFromMessage(message);
    allRefs.push(...messageRefs);
  }

  // Build set of unique normalized values
  const uniqueRefs = new Set(allRefs.map((r) => r.value));

  return {
    conversationId: conversation.id,
    references: allRefs,
    uniqueRefs,
  };
}

/**
 * Extract references from multiple conversations
 */
export function extractReferencesFromAll(
  conversations: Conversation[]
): Map<string, ConversationReferences> {
  const result = new Map<string, ConversationReferences>();

  for (const conv of conversations) {
    result.set(conv.id, extractReferencesFromConversation(conv));
  }

  return result;
}

/**
 * Check if a message is from a bot (GitHub, CircleCI, etc.)
 */
export function isBotMessage(message: SlackMessage): boolean {
  // Bot messages typically have subtype or no user
  if (message.subtype === 'bot_message') {
    return true;
  }
  // GitHub/CircleCI bot patterns in text
  if (!message.user && message.text) {
    return true;
  }
  return false;
}

/**
 * Check if a conversation is primarily bot messages
 */
export function isBotConversation(conversation: Conversation): boolean {
  const botMessages = conversation.messages.filter(isBotMessage);
  return botMessages.length === conversation.messages.length;
}

/**
 * Get references suitable for similarity calculation
 * Excludes user mentions since they indicate who's being discussed, not topic relatedness
 * Two conversations about the same person are not necessarily about the same topic
 */
export function getRefsForSimilarity(refs: ConversationReferences): Set<string> {
  const result = new Set<string>();
  for (const ref of refs.references) {
    // Exclude user mentions from similarity - they're too common and don't indicate topic relatedness
    if (ref.type !== 'user_mention') {
      result.add(ref.value);
    }
  }
  return result;
}

/**
 * Calculate similarity between two conversations based on shared references
 * Returns a value between 0 and 1
 * Note: User mentions are excluded since mentioning the same person doesn't mean same topic
 */
export function calculateReferenceSimilarity(
  refs1: ConversationReferences,
  refs2: ConversationReferences
): number {
  // Use filtered refs that exclude user mentions
  const set1 = getRefsForSimilarity(refs1);
  const set2 = getRefsForSimilarity(refs2);

  if (set1.size === 0 && set2.size === 0) {
    return 0;
  }

  // Jaccard similarity: intersection / union
  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return intersection.size / union.size;
}
