/**
 * Core abstraction for LLM message creation.
 * Provides a unified interface for different Claude backends (SDK vs CLI).
 */

import { z } from 'zod';

// Message format (compatible with Anthropic SDK)
export const MessageParamSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

export type MessageParam = z.infer<typeof MessageParamSchema>;

// Request parameters for message creation
export interface MessageCreateParams {
  model: string;
  max_tokens: number;
  messages: MessageParam[];
}

// Response format (simplified, compatible with both backends)
export interface MessageResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
}

/**
 * Abstract interface all Claude backends must implement.
 * This allows swapping between SDK and CLI backends transparently.
 */
export interface ClaudeBackend {
  /**
   * Create a message completion using the Claude API.
   * @throws Error if the API call fails
   */
  createMessage(params: MessageCreateParams): Promise<MessageResponse>;

  /**
   * Get the backend type for logging/debugging
   */
  readonly backendType: 'sdk' | 'cli';
}
