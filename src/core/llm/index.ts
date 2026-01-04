/**
 * LLM abstraction layer - provides unified interface for different Claude backends.
 *
 * Supports:
 * - Anthropic SDK (ANTHROPIC_API_KEY)
 * - Claude CLI with OAuth (CLAUDE_CODE_OAUTH_TOKEN)
 */

export type { ClaudeBackend, MessageCreateParams, MessageResponse, MessageParam } from './types.js';
export { ClaudeProvider, getClaudeProvider, resetClaudeProvider } from './provider.js';
export type { ClaudeProviderConfig } from './provider.js';
