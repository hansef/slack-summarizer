/**
 * First-run setup screen for configuration
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput, PasswordInput, Select, ConfirmInput, Spinner, StatusMessage } from '@inkjs/ui';
import { WebClient } from '@slack/web-api';
import Anthropic from '@anthropic-ai/sdk';
import { spawn, execSync } from 'child_process';
import {
  writeConfigFile,
  createFullConfig,
  getConfigFilePath,
  getDisplayPath,
} from '../../../config/index.js';

interface SetupScreenProps {
  onComplete: () => void;
  onSkip: () => void;
}

type Step =
  | 'welcome'
  | 'slack-token'
  | 'slack-testing'
  | 'auth-method'
  | 'anthropic-key'
  | 'anthropic-testing'
  | 'oauth-token'
  | 'oauth-testing'
  | 'openai-prompt'
  | 'openai-key'
  | 'openai-testing'
  | 'optional-prompt'
  | 'model-select'
  | 'timezone'
  | 'saving'
  | 'complete'
  | 'error';

interface SetupState {
  slackToken: string;
  slackUserId?: string;
  slackUserName?: string;
  authMethod?: 'api_key' | 'oauth';
  anthropicKey?: string;
  oauthToken?: string;
  openaiKey?: string;
  enableEmbeddings?: boolean;
  model?: string;
  timezone?: string;
  error?: string;
}

/**
 * Check if claude CLI is available in PATH.
 */
function isClaudeCliAvailable(): boolean {
  try {
    execSync('which claude', { encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Test a Claude OAuth token by making a minimal CLI call.
 */
async function testOAuthToken(oauthToken: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', 'Say "ok"', '--output-format', 'json'], {
      env: {
        ...process.env,
        CLAUDE_CODE_OAUTH_TOKEN: oauthToken,
        ANTHROPIC_API_KEY: '',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';

    // Close stdin immediately - claude CLI doesn't need input for -p flag
    child.stdin.end();

    // Set a timeout to avoid hanging forever
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('OAuth test timed out after 30 seconds'));
    }, 30000);

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr || `CLI exited with code ${code}`));
      } else {
        resolve();
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn claude CLI: ${err.message}`));
    });
  });
}

export function SetupScreen({ onComplete, onSkip }: SetupScreenProps): React.ReactElement {
  const [step, setStep] = useState<Step>('welcome');
  const [state, setState] = useState<SetupState>({
    slackToken: '',
  });
  const cliAvailable = isClaudeCliAvailable();

  useInput((_input, key) => {
    if (step === 'welcome' && key.return) {
      setStep('slack-token');
    }
  });

  const handleSlackTokenSubmit = useCallback(async (token: string) => {
    if (!token.startsWith('xoxp-')) {
      setState((s) => ({ ...s, error: 'Token must start with xoxp-' }));
      return;
    }

    setState((s) => ({ ...s, slackToken: token, error: undefined }));
    setStep('slack-testing');

    try {
      const client = new WebClient(token);
      const auth = await client.auth.test();

      if (!auth.ok || !auth.user_id) {
        throw new Error('Authentication failed');
      }

      const userInfo = await client.users.info({ user: auth.user_id });
      const userName =
        userInfo.user?.profile?.display_name ||
        userInfo.user?.profile?.real_name ||
        userInfo.user?.name ||
        'Unknown';

      setState((s) => ({
        ...s,
        slackUserId: auth.user_id,
        slackUserName: userName,
      }));
      setStep('auth-method');
    } catch (err) {
      setState((s) => ({
        ...s,
        error: `Slack connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      }));
      setStep('slack-token');
    }
  }, []);

  const handleAuthMethodSelect = useCallback((method: string) => {
    setState((s) => ({ ...s, authMethod: method as 'api_key' | 'oauth', error: undefined }));
    if (method === 'api_key') {
      setStep('anthropic-key');
    } else {
      setStep('oauth-token');
    }
  }, []);

  const handleAnthropicKeySubmit = useCallback(async (key: string) => {
    if (!key.startsWith('sk-ant-')) {
      setState((s) => ({ ...s, error: 'API key must start with sk-ant-' }));
      return;
    }

    setState((s) => ({ ...s, anthropicKey: key, error: undefined }));
    setStep('anthropic-testing');

    try {
      const anthropic = new Anthropic({ apiKey: key });
      await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Say "ok"' }],
      });

      setStep('openai-prompt');
    } catch (err) {
      setState((s) => ({
        ...s,
        error: `Anthropic connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      }));
      setStep('anthropic-key');
    }
  }, []);

  const handleOAuthTokenSubmit = useCallback(async (token: string) => {
    if (!token.startsWith('sk-ant-oat')) {
      setState((s) => ({ ...s, error: 'OAuth token must start with sk-ant-oat' }));
      return;
    }

    setState((s) => ({ ...s, oauthToken: token, error: undefined }));
    setStep('oauth-testing');

    try {
      await testOAuthToken(token);
      setStep('openai-prompt');
    } catch (err) {
      setState((s) => ({
        ...s,
        error: `OAuth connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      }));
      setStep('oauth-token');
    }
  }, []);

  const handleOpenAIPrompt = useCallback((wantEmbeddings: boolean) => {
    if (wantEmbeddings) {
      setStep('openai-key');
    } else {
      setState((s) => ({ ...s, enableEmbeddings: false }));
      setStep('optional-prompt');
    }
  }, []);

  const handleOpenAIKeySubmit = useCallback(async (key: string) => {
    if (!key.startsWith('sk-')) {
      setState((s) => ({ ...s, error: 'API key must start with sk-' }));
      return;
    }

    setState((s) => ({ ...s, openaiKey: key, error: undefined }));
    setStep('openai-testing');

    try {
      // Test OpenAI connection with a simple embeddings request
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: 'test',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json() as { error?: { message?: string } };
        throw new Error(errorData.error?.message || 'API request failed');
      }

      setState((s) => ({ ...s, enableEmbeddings: true }));
      setStep('optional-prompt');
    } catch (err) {
      setState((s) => ({
        ...s,
        error: `OpenAI connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      }));
      setStep('openai-key');
    }
  }, []);

  const handleOptionalPrompt = useCallback((wantOptional: boolean) => {
    if (wantOptional) {
      setStep('model-select');
    } else {
      // Skip optional settings, save with defaults
      saveConfig(state.slackToken, state.anthropicKey, state.oauthToken, undefined, undefined, state.openaiKey, state.enableEmbeddings);
    }
  }, [state.slackToken, state.anthropicKey, state.oauthToken, state.openaiKey, state.enableEmbeddings]);

  const handleModelSelect = useCallback((model: string) => {
    setState((s) => ({ ...s, model }));
    setStep('timezone');
  }, []);

  const handleTimezoneSubmit = useCallback(
    (timezone: string) => {
      setState((s) => ({ ...s, timezone }));
      saveConfig(state.slackToken, state.anthropicKey, state.oauthToken, state.model, timezone, state.openaiKey, state.enableEmbeddings);
    },
    [state.slackToken, state.anthropicKey, state.oauthToken, state.model, state.openaiKey, state.enableEmbeddings]
  );

  const saveConfig = useCallback(
    async (slackToken: string, anthropicKey?: string, oauthToken?: string, model?: string, timezone?: string, openaiKey?: string, enableEmbeddings?: boolean) => {
      setStep('saving');

      try {
        const config = createFullConfig({
          slackToken,
          anthropicKey,
          oauthToken,
          model,
          timezone,
          openaiKey,
          enableEmbeddings,
        });
        writeConfigFile(config);
        setStep('complete');
      } catch (err) {
        setState((s) => ({
          ...s,
          error: `Failed to save config: ${err instanceof Error ? err.message : 'Unknown error'}`,
        }));
        setStep('error');
      }
    },
    []
  );

  // Render based on current step
  switch (step) {
    case 'welcome':
      return (
        <Box flexDirection="column">
          <Text bold color="cyan">
            Welcome to Slack Summarizer!
          </Text>
          <Box marginTop={1}>
            <Text>
              This tool summarizes your Slack activity using AI. Before we begin, we need to set up
              your API credentials.
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              Configuration will be saved to: {getDisplayPath(getConfigFilePath())}
            </Text>
          </Box>
          <Box marginTop={2}>
            <Text>Press </Text>
            <Text color="cyan">Enter</Text>
            <Text> to continue, or </Text>
            <Text color="cyan">q</Text>
            <Text> to quit</Text>
          </Box>
        </Box>
      );

    case 'slack-token':
      return (
        <Box flexDirection="column">
          <Text bold>Step 1: Slack User Token</Text>
          <Box marginTop={1}>
            <Text dimColor>Get your token from: https://api.slack.com/apps</Text>
          </Box>
          <Text dimColor>Must start with xoxp-</Text>
          {state.error && (
            <Box marginTop={1}>
              <StatusMessage variant="error">{state.error}</StatusMessage>
            </Box>
          )}
          <Box marginTop={1}>
            <PasswordInput
              placeholder="xoxp-..."
              onSubmit={handleSlackTokenSubmit}
            />
          </Box>
        </Box>
      );

    case 'slack-testing':
      return (
        <Box flexDirection="column">
          <Spinner label="Testing Slack connection..." />
        </Box>
      );

    case 'auth-method':
      return (
        <Box flexDirection="column">
          {state.slackUserName && (
            <Box marginBottom={1}>
              <StatusMessage variant="success">
                Connected to Slack as {state.slackUserName}
              </StatusMessage>
            </Box>
          )}
          <Text bold>Step 2: Claude Authentication</Text>
          <Box marginTop={1}>
            <Text>Choose how to authenticate with Claude:</Text>
          </Box>
          <Box marginTop={1}>
            <Select
              options={[
                {
                  label: 'Anthropic API Key (pay-per-use)',
                  value: 'api_key',
                },
                {
                  label: cliAvailable
                    ? 'Claude OAuth Token (Pro/Max subscription)'
                    : 'Claude OAuth Token (requires claude CLI)',
                  value: 'oauth',
                },
              ]}
              onChange={handleAuthMethodSelect}
            />
          </Box>
        </Box>
      );

    case 'anthropic-key':
      return (
        <Box flexDirection="column">
          <Text bold>Anthropic API Key</Text>
          <Box marginTop={1}>
            <Text dimColor>Get your key from: https://console.anthropic.com/</Text>
          </Box>
          <Text dimColor>Must start with sk-ant-</Text>
          {state.error && (
            <Box marginTop={1}>
              <StatusMessage variant="error">{state.error}</StatusMessage>
            </Box>
          )}
          <Box marginTop={1}>
            <PasswordInput
              placeholder="sk-ant-..."
              onSubmit={handleAnthropicKeySubmit}
            />
          </Box>
        </Box>
      );

    case 'anthropic-testing':
      return (
        <Box flexDirection="column">
          <Spinner label="Testing Anthropic API..." />
        </Box>
      );

    case 'oauth-token':
      return (
        <Box flexDirection="column">
          {!cliAvailable && (
            <Box marginBottom={1}>
              <StatusMessage variant="warning">
                Claude CLI not found. Install: npm i -g @anthropic-ai/claude-code
              </StatusMessage>
            </Box>
          )}
          <Text bold>Claude OAuth Token</Text>
          <Box marginTop={1}>
            <Text dimColor>Get your token by running: claude setup-token</Text>
          </Box>
          <Text dimColor>Must start with sk-ant-oat</Text>
          {state.error && (
            <Box marginTop={1}>
              <StatusMessage variant="error">{state.error}</StatusMessage>
            </Box>
          )}
          <Box marginTop={1}>
            <PasswordInput
              placeholder="sk-ant-oat01-..."
              onSubmit={handleOAuthTokenSubmit}
            />
          </Box>
        </Box>
      );

    case 'oauth-testing':
      return (
        <Box flexDirection="column">
          <Spinner label="Testing Claude OAuth..." />
        </Box>
      );

    case 'openai-prompt':
      return (
        <Box flexDirection="column">
          <StatusMessage variant="success">
            {state.authMethod === 'oauth' ? 'Claude OAuth verified!' : 'Anthropic API verified!'}
          </StatusMessage>
          <Box marginTop={1}>
            <Text bold>Step 3: OpenAI Embeddings (Recommended)</Text>
          </Box>
          <Box marginTop={1}>
            <Text>
              Embeddings improve conversation grouping by understanding semantic similarity.
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              This requires an OpenAI API key. Skip if you don&apos;t have one.
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text>Enable embeddings?</Text>
          </Box>
          <Box marginTop={1}>
            <ConfirmInput
              onConfirm={() => handleOpenAIPrompt(true)}
              onCancel={() => handleOpenAIPrompt(false)}
            />
          </Box>
        </Box>
      );

    case 'openai-key':
      return (
        <Box flexDirection="column">
          <Text bold>OpenAI API Key</Text>
          <Box marginTop={1}>
            <Text dimColor>Get your key from: https://platform.openai.com/api-keys</Text>
          </Box>
          <Text dimColor>Must start with sk-</Text>
          {state.error && (
            <Box marginTop={1}>
              <StatusMessage variant="error">{state.error}</StatusMessage>
            </Box>
          )}
          <Box marginTop={1}>
            <PasswordInput
              placeholder="sk-..."
              onSubmit={handleOpenAIKeySubmit}
            />
          </Box>
        </Box>
      );

    case 'openai-testing':
      return (
        <Box flexDirection="column">
          <Spinner label="Testing OpenAI API..." />
        </Box>
      );

    case 'optional-prompt':
      return (
        <Box flexDirection="column">
          <StatusMessage variant="success">API connections verified!</StatusMessage>
          <Box marginTop={1}>
            <Text>Configure optional settings?</Text>
          </Box>
          <Box marginTop={1}>
            <ConfirmInput
              onConfirm={() => handleOptionalPrompt(true)}
              onCancel={() => handleOptionalPrompt(false)}
            />
          </Box>
        </Box>
      );

    case 'model-select':
      return (
        <Box flexDirection="column">
          <Text bold>Claude Model</Text>
          <Text dimColor>Select the model for summarization</Text>
          <Box marginTop={1}>
            <Select
              options={[
                { label: 'Haiku (faster, cheaper)', value: 'claude-haiku-4-5-20251001' },
                { label: 'Sonnet (higher quality)', value: 'claude-sonnet-4-5-20250929' },
              ]}
              onChange={handleModelSelect}
            />
          </Box>
        </Box>
      );

    case 'timezone':
      return (
        <Box flexDirection="column">
          <Text bold>Timezone</Text>
          <Text dimColor>IANA timezone for date display</Text>
          <Box marginTop={1}>
            <TextInput
              placeholder="America/Los_Angeles"
              defaultValue="America/Los_Angeles"
              onSubmit={handleTimezoneSubmit}
            />
          </Box>
        </Box>
      );

    case 'saving':
      return (
        <Box flexDirection="column">
          <Spinner label="Saving configuration..." />
        </Box>
      );

    case 'complete':
      return (
        <Box flexDirection="column">
          <StatusMessage variant="success">Configuration saved successfully!</StatusMessage>
          <Box marginTop={1}>
            <Text>Your configuration is stored at: {getDisplayPath(getConfigFilePath())}</Text>
          </Box>
          <Box marginTop={2}>
            <Text>Press </Text>
            <Text color="cyan">Enter</Text>
            <Text> to continue to the app</Text>
          </Box>
          <CompleteHandler onComplete={onComplete} />
        </Box>
      );

    case 'error':
      return (
        <Box flexDirection="column">
          <StatusMessage variant="error">{state.error || 'An error occurred'}</StatusMessage>
          <Box marginTop={2}>
            <Text>Press </Text>
            <Text color="cyan">r</Text>
            <Text> to retry or </Text>
            <Text color="cyan">q</Text>
            <Text> to quit</Text>
          </Box>
          <ErrorHandler onRetry={() => setStep('slack-token')} onQuit={onSkip} />
        </Box>
      );

    default:
      return <Text>Unknown step</Text>;
  }
}

// Helper component to handle completion
function CompleteHandler({ onComplete }: { onComplete: () => void }): null {
  useInput((_input, key) => {
    if (key.return) {
      onComplete();
    }
  });
  return null;
}

// Helper component to handle errors
function ErrorHandler({
  onRetry,
  onQuit,
}: {
  onRetry: () => void;
  onQuit: () => void;
}): null {
  useInput((input) => {
    if (input === 'r') {
      onRetry();
    } else if (input === 'q') {
      onQuit();
    }
  });
  return null;
}
