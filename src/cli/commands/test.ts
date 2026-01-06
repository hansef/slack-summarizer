import Anthropic from '@anthropic-ai/sdk';
import { getSlackClient } from '@/core/slack/client.js';
import { getEnv } from '@/utils/env.js';
import { output } from '../output.js';
import { logger } from '@/utils/logger.js';

export async function testConnectionCommand(): Promise<void> {
  output.header('Connection Test');
  output.divider();

  let hasErrors = false;

  // Test Slack connection
  output.progress('Testing Slack connection...');
  try {
    const slackClient = getSlackClient();
    const userId = await slackClient.getCurrentUserId();
    const userName = await slackClient.getUserDisplayName(userId);

    output.success('Slack connection successful');
    output.stat('User ID', userId);
    output.stat('Display Name', userName);

    // Get workspace info from authentication
    try {
      const auth = await slackClient.authenticate();
      if (auth.team) {
        output.stat('Workspace', auth.team);
      }
    } catch {
      // Non-critical - already tested auth above
    }
  } catch (error) {
    hasErrors = true;
    logger.error('Slack connection failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    output.error(
      'Slack connection failed',
      error instanceof Error ? error.message : 'Unknown error'
    );
    output.info('');
    output.info('Troubleshooting:');
    output.info('  1. Check that SLACK_USER_TOKEN is set correctly');
    output.info('  2. Verify the token starts with "xoxp-"');
    output.info('  3. Ensure the token has not expired');
    output.info('  4. Verify required scopes are configured');
  }

  output.divider();

  // Test Claude connection
  output.progress('Testing Claude API connection...');
  try {
    const env = getEnv();
    const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

    // Make a minimal API call to verify the connection
    const response = await anthropic.messages.create({
      model: env.SLACK_SUMMARIZER_CLAUDE_MODEL,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Say "ok"' }],
    });

    output.success('Claude API connection successful');
    output.stat('Model', env.SLACK_SUMMARIZER_CLAUDE_MODEL);
    output.stat('Input Tokens', response.usage.input_tokens);
    output.stat('Output Tokens', response.usage.output_tokens);
  } catch (error) {
    hasErrors = true;
    logger.error('Claude API connection failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    output.error(
      'Claude API connection failed',
      error instanceof Error ? error.message : 'Unknown error'
    );
    output.info('');
    output.info('Troubleshooting:');
    output.info('  1. Check that ANTHROPIC_API_KEY is set correctly');
    output.info('  2. Verify the key starts with "sk-ant-"');
    output.info('  3. Ensure you have API access enabled');
    output.info('  4. Check your API usage limits');
  }

  output.divider();

  // Summary
  if (hasErrors) {
    output.error('Connection test completed with errors');
    process.exit(1);
  } else {
    output.success('All connections successful');
  }
}
