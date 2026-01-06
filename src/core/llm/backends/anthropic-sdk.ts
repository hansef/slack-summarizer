/**
 * Claude backend implementation using @anthropic-ai/sdk.
 * Uses traditional API keys (sk-ant-...).
 */

import Anthropic from '@anthropic-ai/sdk';
import { createLogger } from '@/utils/logging/index.js';

const logger = createLogger({ component: 'AnthropicSdkBackend' });
import type { ClaudeBackend, MessageCreateParams, MessageResponse } from '../types.js';

export interface AnthropicSdkConfig {
  apiKey: string;
}

export class AnthropicSdkBackend implements ClaudeBackend {
  private client: Anthropic;
  readonly backendType = 'sdk' as const;

  constructor(config: AnthropicSdkConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    logger.debug('Initialized Anthropic SDK backend');
  }

  async createMessage(params: MessageCreateParams): Promise<MessageResponse> {
    logger.debug(
      { model: params.model, max_tokens: params.max_tokens, messageCount: params.messages.length },
      'Creating message via Anthropic SDK'
    );

    const response = await this.client.messages.create({
      model: params.model,
      max_tokens: params.max_tokens,
      messages: params.messages,
    });

    // Transform to unified format
    return {
      content: response.content.map((block) => {
        if (block.type !== 'text') {
          throw new Error(`Unexpected content block type: ${block.type}`);
        }
        return {
          type: 'text' as const,
          text: block.text,
        };
      }),
    };
  }
}
