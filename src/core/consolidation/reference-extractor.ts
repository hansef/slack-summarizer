import { Conversation } from '@/core/models/conversation.js';
import { SlackMessage } from '@/core/models/slack.js';

/**
 * All supported reference types
 */
export type ReferenceType =
  // Code & Issues
  | 'github_issue'
  | 'github_pr'
  | 'github_url'
  | 'gitlab'
  | 'ticket' // Jira, Linear, Shortcut, etc. (PREFIX-123 format)
  // Documentation
  | 'confluence'
  | 'notion'
  | 'gdoc'
  | 'gsheet'
  | 'gslide'
  // Design
  | 'figma'
  // Project Management
  | 'asana'
  | 'clickup'
  // Monitoring & Ops
  | 'sentry'
  | 'datadog'
  | 'pagerduty'
  | 'aws_log_group'
  // Support
  | 'zendesk'
  | 'salesforce'
  // Other
  | 'error_pattern'
  | 'url'
  | 'user_mention'
  | 'service_name'
  | 'slack_message';

/**
 * Represents a reference found in a message (GitHub issue, error pattern, etc.)
 */
export interface Reference {
  type: ReferenceType;
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
 * Pattern extractor definition
 */
interface PatternExtractor {
  type: ReferenceType;
  pattern: RegExp;
  /** Extract normalized value from regex match. Return null to skip this match. */
  normalize: (match: RegExpExecArray) => string | null;
}

/**
 * Slack message link pattern (shared between extractor and parseSlackMessageLinks)
 * Matches: https://[workspace].slack.com/archives/[channel]/p[timestamp]
 */
const SLACK_MESSAGE_LINK_PATTERN = /https?:\/\/[\w-]+\.slack\.com\/archives\/([A-Z0-9]+)\/p(\d+)(?:\?[^\s]*)?/gi;

/**
 * Convert Slack message timestamp from URL format to API format
 * e.g., "1234567890123456" -> "1234567890.123456"
 */
function normalizeSlackTimestamp(timestamp: string): string {
  return timestamp.length > 10
    ? `${timestamp.slice(0, 10)}.${timestamp.slice(10)}`
    : timestamp;
}

/**
 * Pattern registry for reference extraction
 * Each extractor defines its type, regex pattern, and normalization function
 */
const EXTRACTORS: PatternExtractor[] = [
  // GitHub issues: #123 (standalone) or org/repo#123
  // Requires whitespace/start before # to avoid matching word#123
  {
    type: 'github_issue',
    pattern: /(?:^|[\s([])(?:[\w-]+\/[\w-]+#|#)(\d+)\b/g,
    normalize: (m) => `#${m[1]}`,
  },

  // GitHub PR/issue URLs: github.com/owner/repo/issues/123 or /pull/123
  {
    type: 'github_url',
    pattern: /github\.com\/[\w-]+\/[\w-]+\/(?:issues|pull)\/(\d+)/gi,
    normalize: (m) => `#${m[1]}`, // Normalize to same format as issues
  },

  // GitLab URLs: gitlab.com/owner/repo/-/issues/123 or /-/merge_requests/123
  // Supports nested groups: gitlab.com/org/group/subgroup/project/-/issues/123
  {
    type: 'gitlab',
    pattern: /gitlab\.com\/[\w-]+(?:\/[\w-]+)+\/-\/(?:issues|merge_requests)\/(\d+)/gi,
    normalize: (m) => `gitlab:${m[1]}`,
  },

  // Tickets: Jira, Linear, Shortcut, etc. (PREFIX-123 format)
  // Requires at least 2 capital letters
  {
    type: 'ticket',
    pattern: /\b([A-Z]{2,}[A-Z0-9]*-\d+)\b/g,
    normalize: (m) => m[1].toUpperCase(),
  },

  // Figma: figma.com/file/{id}, figma.com/design/{id}, figma.com/board/{id}
  {
    type: 'figma',
    pattern: /figma\.com\/(?:file|design|board)\/([a-zA-Z0-9]+)/gi,
    normalize: (m) => `figma:${m[1]}`,
  },

  // Notion: notion.so/{workspace}/{page-id} or notion.site/...
  // Page IDs are 32-char hex strings or UUID format (8-4-4-4-12 with dashes)
  {
    type: 'notion',
    pattern: /notion\.(?:so|site)\/(?:[\w-]+\/)*([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/gi,
    normalize: (m) => `notion:${m[1].replace(/-/g, '')}`,
  },

  // Confluence: atlassian.net/wiki/spaces/{space}/pages/{pageId}
  {
    type: 'confluence',
    pattern: /atlassian\.net\/wiki\/spaces\/[\w-]+\/pages\/(\d+)/gi,
    normalize: (m) => `confluence:${m[1]}`,
  },

  // Google Docs: docs.google.com/document/d/{id}
  {
    type: 'gdoc',
    pattern: /docs\.google\.com\/document\/d\/([\w-]+)/gi,
    normalize: (m) => `gdoc:${m[1]}`,
  },

  // Google Sheets: docs.google.com/spreadsheets/d/{id}
  {
    type: 'gsheet',
    pattern: /docs\.google\.com\/spreadsheets\/d\/([\w-]+)/gi,
    normalize: (m) => `gsheet:${m[1]}`,
  },

  // Google Slides: docs.google.com/presentation/d/{id}
  {
    type: 'gslide',
    pattern: /docs\.google\.com\/presentation\/d\/([\w-]+)/gi,
    normalize: (m) => `gslide:${m[1]}`,
  },

  // Asana: app.asana.com/0/{project}/{taskId}
  {
    type: 'asana',
    pattern: /app\.asana\.com\/\d+\/\d+\/(\d+)/gi,
    normalize: (m) => `asana:${m[1]}`,
  },

  // ClickUp: app.clickup.com/t/{taskId}
  {
    type: 'clickup',
    pattern: /app\.clickup\.com\/t\/([a-z0-9]+)/gi,
    normalize: (m) => `clickup:${m[1]}`,
  },

  // Sentry: sentry.io/organizations/{org}/issues/{issueId}
  {
    type: 'sentry',
    pattern: /sentry\.io\/(?:organizations\/)?[\w-]+\/issues\/(\d+)/gi,
    normalize: (m) => `sentry:${m[1]}`,
  },

  // Datadog: app.datadoghq.com/dashboard/{id} or /monitors/{id} or /apm/...
  {
    type: 'datadog',
    pattern: /app\.datadoghq\.com\/(?:dashboard|monitors|apm|logs)\/([a-zA-Z0-9-]+)/gi,
    normalize: (m) => `datadog:${m[1]}`,
  },

  // PagerDuty: {subdomain}.pagerduty.com/incidents/{id}
  {
    type: 'pagerduty',
    pattern: /[\w-]+\.pagerduty\.com\/incidents\/([A-Z0-9]+)/gi,
    normalize: (m) => `pagerduty:${m[1]}`,
  },

  // Zendesk: {subdomain}.zendesk.com/agent/tickets/{id}
  {
    type: 'zendesk',
    pattern: /[\w-]+\.zendesk\.com\/agent\/tickets\/(\d+)/gi,
    normalize: (m) => `zendesk:${m[1]}`,
  },

  // Salesforce: supports multiple URL formats
  // - Classic: na123.salesforce.com/.../Case/{id}
  // - My Domain: company.my.salesforce.com/.../Case/{id}
  // - Lightning: company.lightning.force.com/.../Case/{id}
  {
    type: 'salesforce',
    pattern: /[\w-]+\.(?:(?:my\.)?salesforce|lightning\.force)\.com\/.*?(?:Case|cases)\/([a-zA-Z0-9]{15,18})/gi,
    normalize: (m) => `sfdc:${m[1]}`,
  },

  // Error patterns: PascalCase errors like NetworkError, NullPointerException
  // HTTP status codes require "error" or "status" after them
  {
    type: 'error_pattern',
    pattern: /\b([A-Z][a-z]+(?:[A-Z][a-z]*)*(?:Error|Exception))\b|\b([45]\d{2})\s+(?:error|status)\b/gi,
    normalize: (m) => {
      const errorName = m[1] || m[2];
      return errorName ? errorName.toLowerCase() : null;
    },
  },

  // Slack user mentions: <@U12345|display_name> or <@U12345>
  {
    type: 'user_mention',
    pattern: /<@(U[A-Z0-9]+)(?:\|[^>]+)?>/g,
    normalize: (m) => m[1],
  },

  // AWS CloudWatch log groups: extract log group name from CloudWatch URLs
  {
    type: 'aws_log_group',
    pattern: /cloudwatch[^#]*#[^/]*log-groups\/log-group(?:\/|%252F|\$252F)([a-zA-Z0-9_-]+)/gi,
    normalize: (m) => m[1].toLowerCase(),
  },

  // Service names: patterns like xxx-auth, xxx-api, xxx-web, xxx-service
  {
    type: 'service_name',
    pattern: /\b([a-zA-Z][a-zA-Z0-9]*(?:prd|stg|dev|prod|stage)?-(?:auth|api|web|service|worker|backend|frontend|core|app))\b/gi,
    normalize: (m) => m[1].toLowerCase(),
  },

  // Slack message links: https://[workspace].slack.com/archives/[channel]/p[timestamp]
  {
    type: 'slack_message',
    pattern: SLACK_MESSAGE_LINK_PATTERN,
    normalize: (m) => `slack:${m[1]}:${normalizeSlackTimestamp(m[2])}`,
  },
];

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
  // Create new regex instance to avoid shared state issues with global flag
  const regex = new RegExp(SLACK_MESSAGE_LINK_PATTERN.source, SLACK_MESSAGE_LINK_PATTERN.flags);

  for (const match of text.matchAll(regex)) {
    const channelId = match[1];
    const timestamp = match[2];
    if (channelId && timestamp) {
      links.push({
        channelId,
        messageTs: normalizeSlackTimestamp(timestamp),
        raw: match[0],
      });
    }
  }

  return links;
}

/**
 * Extract references from a single message using the pattern registry
 */
export function extractReferencesFromMessage(message: SlackMessage): Reference[] {
  const text = message.text || '';
  const references: Reference[] = [];

  for (const extractor of EXTRACTORS) {
    // Reset regex state for global patterns
    extractor.pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = extractor.pattern.exec(text)) !== null) {
      const value = extractor.normalize(match);
      if (value !== null) {
        references.push({
          type: extractor.type,
          value,
          raw: match[0].trim(),
          messageTs: message.ts,
        });
      }
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
