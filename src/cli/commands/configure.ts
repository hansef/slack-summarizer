import prompts from 'prompts';
import Anthropic from '@anthropic-ai/sdk';
import { WebClient } from '@slack/web-api';
import { output } from '../output.js';
import { logger } from '../../utils/logger.js';
import {
  configFileExists,
  getConfigFilePath,
  getDisplayPath,
  loadConfigFile,
  writeConfigFile,
  createFullConfig,
  type ConfigFile,
} from '../../config/index.js';

interface ConfigureOptions {
  reset?: boolean;
}

/**
 * Test a Slack token by making a test API call.
 */
async function testSlackToken(token: string): Promise<{ userId: string; userName: string }> {
  const client = new WebClient(token);
  const auth = await client.auth.test();

  if (!auth.ok || !auth.user_id) {
    throw new Error('Authentication failed');
  }

  // Get user info for display name
  const userInfo = await client.users.info({ user: auth.user_id });
  const userName =
    userInfo.user?.profile?.display_name ||
    userInfo.user?.profile?.real_name ||
    userInfo.user?.name ||
    'Unknown';

  return { userId: auth.user_id, userName };
}

/**
 * Test an Anthropic API key by making a minimal API call.
 */
async function testAnthropicKey(
  apiKey: string,
  model: string = 'claude-haiku-4-5-20251001'
): Promise<void> {
  const anthropic = new Anthropic({ apiKey });

  await anthropic.messages.create({
    model,
    max_tokens: 10,
    messages: [{ role: 'user', content: 'Say "ok"' }],
  });
}

/**
 * Mask a token/key for display (show first and last few chars).
 */
function maskSecret(secret: string): string {
  if (secret.length < 20) return '***';
  return `${secret.slice(0, 10)}...${secret.slice(-4)}`;
}

/**
 * Helper to prompt and handle cancellation.
 * Returns null if the user cancelled (Ctrl+C).
 */
async function promptWithCancel<T>(
  question: prompts.PromptObject
): Promise<{ value: T; cancelled: false } | { value: undefined; cancelled: true }> {
  const response = await prompts(question);
  const value = response[question.name as string] as T | undefined;
  if (value === undefined) {
    return { value: undefined, cancelled: true };
  }
  return { value, cancelled: false };
}

export async function configureCommand(options: ConfigureOptions): Promise<void> {
  output.header('Slack Summarizer Configuration');
  output.divider();

  const configPath = getConfigFilePath();
  const displayPath = getDisplayPath(configPath);
  let existingConfig: ConfigFile | null = null;

  // Check for existing config
  if (configFileExists() && !options.reset) {
    output.info(`Found existing configuration at: ${displayPath}`);
    output.raw('');

    try {
      existingConfig = loadConfigFile();
    } catch (error) {
      output.warn(
        `Could not load existing config: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    const actionResult = await promptWithCancel<string>({
      type: 'select',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { title: 'Edit existing configuration', value: 'edit' },
        { title: 'Start fresh (replace all)', value: 'replace' },
        { title: 'Cancel', value: 'cancel' },
      ],
    });

    if (actionResult.cancelled || actionResult.value === 'cancel') {
      output.info('Configuration cancelled');
      return;
    }

    if (actionResult.value === 'replace') {
      existingConfig = null;
    }
  }

  output.raw('');
  output.header('Required Settings');
  output.divider();

  // Slack Token
  const existingSlackToken = existingConfig?.slack?.user_token;
  const slackTokenPrompt = existingSlackToken
    ? `Slack user token [${maskSecret(existingSlackToken)}]`
    : 'Slack user token (xoxp-...)';

  const slackTokenResult = await promptWithCancel<string>({
    type: 'password',
    name: 'slackToken',
    message: slackTokenPrompt,
    validate: (value: string) => {
      // Allow empty to keep existing
      if (!value && existingSlackToken) return true;
      if (!value) return 'Token is required';
      if (!value.startsWith('xoxp-')) return 'Token must start with xoxp-';
      return true;
    },
  });

  if (slackTokenResult.cancelled) {
    output.raw('');
    output.info('Configuration cancelled');
    return;
  }

  const finalSlackToken: string | undefined =
    slackTokenResult.value || existingSlackToken || undefined;

  // Test Slack connection
  if (finalSlackToken) {
    output.progress('Testing Slack connection...');
    try {
      const { userId, userName } = await testSlackToken(finalSlackToken);
      output.success(`Slack connection successful (${userName})`);
      output.stat('User ID', userId);
    } catch (error) {
      logger.error('Slack connection test failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      output.error(
        'Slack connection failed',
        error instanceof Error ? error.message : 'Unknown error'
      );

      const proceedResult = await promptWithCancel<boolean>({
        type: 'confirm',
        name: 'proceed',
        message: 'Continue with invalid token?',
        initial: false,
      });

      if (proceedResult.cancelled || !proceedResult.value) {
        output.info('Configuration cancelled');
        return;
      }
    }
  }

  output.raw('');

  // Anthropic Key
  const existingAnthropicKey = existingConfig?.anthropic?.api_key;
  const anthropicKeyPrompt = existingAnthropicKey
    ? `Anthropic API key [${maskSecret(existingAnthropicKey)}]`
    : 'Anthropic API key (sk-ant-...)';

  const anthropicKeyResult = await promptWithCancel<string>({
    type: 'password',
    name: 'anthropicKey',
    message: anthropicKeyPrompt,
    validate: (value: string) => {
      // Allow empty to keep existing
      if (!value && existingAnthropicKey) return true;
      if (!value) return 'API key is required';
      if (!value.startsWith('sk-ant-')) return 'API key must start with sk-ant-';
      return true;
    },
  });

  if (anthropicKeyResult.cancelled) {
    output.raw('');
    output.info('Configuration cancelled');
    return;
  }

  const finalAnthropicKey: string | undefined =
    anthropicKeyResult.value || existingAnthropicKey || undefined;

  // Test Anthropic connection
  if (finalAnthropicKey) {
    output.progress('Testing Anthropic API connection...');
    try {
      await testAnthropicKey(finalAnthropicKey);
      output.success('Anthropic API connection successful');
    } catch (error) {
      logger.error('Anthropic API connection test failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      output.error(
        'Anthropic API connection failed',
        error instanceof Error ? error.message : 'Unknown error'
      );

      const proceedResult = await promptWithCancel<boolean>({
        type: 'confirm',
        name: 'proceed',
        message: 'Continue with invalid API key?',
        initial: false,
      });

      if (proceedResult.cancelled || !proceedResult.value) {
        output.info('Configuration cancelled');
        return;
      }
    }
  }

  output.raw('');
  output.divider();

  // Optional settings
  const optionalResult = await promptWithCancel<boolean>({
    type: 'confirm',
    name: 'configureOptional',
    message: 'Configure optional settings?',
    initial: false,
  });

  let model: string | undefined;
  let timezone: string | undefined;
  let logLevel: string | undefined;
  let dbPath: string | undefined;
  let enableEmbeddings: boolean | undefined;
  let openaiKey: string | undefined;

  if (!optionalResult.cancelled && optionalResult.value) {
    output.raw('');
    output.header('Optional Settings');
    output.divider();

    // Model selection
    const modelResult = await promptWithCancel<string>({
      type: 'select',
      name: 'selectedModel',
      message: 'Claude model for summarization',
      choices: [
        {
          title: 'Haiku (faster, cheaper)',
          value: 'claude-haiku-4-5-20251001',
          description: 'Good for most use cases',
        },
        {
          title: 'Sonnet (higher quality)',
          value: 'claude-sonnet-4-5-20250929',
          description: 'Better summaries, slower and more expensive',
        },
      ],
      initial: existingConfig?.anthropic?.model === 'claude-sonnet-4-5-20250929' ? 1 : 0,
    });

    if (modelResult.cancelled) {
      output.raw('');
      output.info('Configuration cancelled');
      return;
    }
    model = modelResult.value;

    // Timezone
    const timezoneResult = await promptWithCancel<string>({
      type: 'text',
      name: 'selectedTimezone',
      message: 'Timezone (IANA format)',
      initial: existingConfig?.settings?.timezone || 'America/Los_Angeles',
    });

    if (timezoneResult.cancelled) {
      output.raw('');
      output.info('Configuration cancelled');
      return;
    }
    timezone = timezoneResult.value;

    // Log level
    const logLevelResult = await promptWithCancel<string>({
      type: 'select',
      name: 'selectedLogLevel',
      message: 'Log level',
      choices: [
        { title: 'Debug', value: 'debug' },
        { title: 'Info (default)', value: 'info' },
        { title: 'Warn', value: 'warn' },
        { title: 'Error', value: 'error' },
      ],
      initial:
        ['debug', 'info', 'warn', 'error'].indexOf(existingConfig?.logging?.level || 'info') || 1,
    });

    if (logLevelResult.cancelled) {
      output.raw('');
      output.info('Configuration cancelled');
      return;
    }
    logLevel = logLevelResult.value;

    // Database path
    const dbPathResult = await promptWithCancel<string>({
      type: 'text',
      name: 'selectedDbPath',
      message: 'Database path for message caching',
      initial: existingConfig?.database?.path || './cache/slack.db',
    });

    if (dbPathResult.cancelled) {
      output.raw('');
      output.info('Configuration cancelled');
      return;
    }
    dbPath = dbPathResult.value;

    // Embeddings
    const embeddingsResult = await promptWithCancel<boolean>({
      type: 'confirm',
      name: 'wantEmbeddings',
      message: 'Enable semantic similarity (requires OpenAI API key)?',
      initial: existingConfig?.embeddings?.enabled || false,
    });

    if (embeddingsResult.cancelled) {
      output.raw('');
      output.info('Configuration cancelled');
      return;
    }
    enableEmbeddings = embeddingsResult.value;

    if (embeddingsResult.value) {
      const existingOpenaiKey = existingConfig?.embeddings?.api_key;
      const openaiKeyPrompt = existingOpenaiKey
        ? `OpenAI API key [${maskSecret(existingOpenaiKey)}]`
        : 'OpenAI API key (sk-...)';

      const openaiKeyResult = await promptWithCancel<string>({
        type: 'password',
        name: 'selectedOpenaiKey',
        message: openaiKeyPrompt,
        validate: (value: string) => {
          if (!value && existingOpenaiKey) return true;
          if (!value) return 'OpenAI API key is required for embeddings';
          return true;
        },
      });

      if (openaiKeyResult.cancelled) {
        output.raw('');
        output.info('Configuration cancelled');
        return;
      }
      openaiKey = openaiKeyResult.value || existingOpenaiKey;
    }
  }

  // Final validation
  if (!finalSlackToken || !finalAnthropicKey) {
    output.error('Missing required settings');
    output.info('Both Slack token and Anthropic API key are required');
    process.exit(1);
  }

  // Build and write config
  output.raw('');
  output.divider();
  output.progress('Saving configuration...');

  try {
    const config = createFullConfig({
      slackToken: finalSlackToken,
      anthropicKey: finalAnthropicKey,
      model,
      timezone,
      logLevel,
      dbPath,
      enableEmbeddings,
      openaiKey,
    });

    writeConfigFile(config);

    output.success('Configuration saved successfully');
    output.raw('');
    output.stat('Config file', displayPath);
    output.raw('');

    output.header('Next Steps');
    output.divider();
    output.info('1. Test your connection:');
    output.raw('   slack-summarizer test-connection');
    output.raw('');
    output.info('2. Generate a summary:');
    output.raw('   slack-summarizer summarize');
    output.raw('');
    output.info('3. View help:');
    output.raw('   slack-summarizer --help');
  } catch (error) {
    logger.error('Failed to save configuration', {
      path: displayPath,
      error: error instanceof Error ? error.message : String(error),
    });
    output.error(
      'Failed to save configuration',
      error instanceof Error ? error.message : 'Unknown error'
    );
    output.raw('');
    output.info('Troubleshooting:');
    output.info(`  1. Check permissions for: ${displayPath}`);
    output.info('  2. Ensure parent directory exists');
    output.info('  3. Try running with elevated permissions');
    process.exit(1);
  }
}
