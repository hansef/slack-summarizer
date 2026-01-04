/**
 * First-run setup screen for configuration
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput, PasswordInput, Select, ConfirmInput, Spinner, StatusMessage } from '@inkjs/ui';
import {
  writeConfigFile,
  createFullConfig,
  getConfigFilePath,
  getDisplayPath,
} from '../../../config/index.js';
import {
  isClaudeCliAvailable,
  validateSlackToken,
  validateAnthropicApiKey,
  validateClaudeOAuthToken,
  validateOpenAIKey,
} from '../utils/validators.js';

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
    setState((s) => ({ ...s, slackToken: token, error: undefined }));
    setStep('slack-testing');

    const result = await validateSlackToken(token);
    if (result.success) {
      setState((s) => ({
        ...s,
        slackUserId: result.metadata?.userId,
        slackUserName: result.metadata?.userName,
      }));
      setStep('auth-method');
    } else {
      setState((s) => ({ ...s, error: result.error }));
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
    setState((s) => ({ ...s, anthropicKey: key, error: undefined }));
    setStep('anthropic-testing');

    const result = await validateAnthropicApiKey(key);
    if (result.success) {
      setStep('openai-prompt');
    } else {
      setState((s) => ({ ...s, error: result.error }));
      setStep('anthropic-key');
    }
  }, []);

  const handleOAuthTokenSubmit = useCallback(async (token: string) => {
    setState((s) => ({ ...s, oauthToken: token, error: undefined }));
    setStep('oauth-testing');

    const result = await validateClaudeOAuthToken(token);
    if (result.success) {
      setStep('openai-prompt');
    } else {
      setState((s) => ({ ...s, error: result.error }));
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
    setState((s) => ({ ...s, openaiKey: key, error: undefined }));
    setStep('openai-testing');

    const result = await validateOpenAIKey(key);
    if (result.success) {
      setState((s) => ({ ...s, enableEmbeddings: true }));
      setStep('optional-prompt');
    } else {
      setState((s) => ({ ...s, error: result.error }));
      setStep('openai-key');
    }
  }, []);

  const handleOptionalPrompt = useCallback((wantOptional: boolean) => {
    if (wantOptional) {
      setStep('model-select');
    } else {
      // Skip optional settings, save with defaults
      void saveConfig(state.slackToken, state.anthropicKey, state.oauthToken, undefined, undefined, state.openaiKey, state.enableEmbeddings);
    }
  }, [state.slackToken, state.anthropicKey, state.oauthToken, state.openaiKey, state.enableEmbeddings]);

  const handleModelSelect = useCallback((model: string) => {
    setState((s) => ({ ...s, model }));
    setStep('timezone');
  }, []);

  const handleTimezoneSubmit = useCallback(
    (timezone: string) => {
      setState((s) => ({ ...s, timezone }));
      void saveConfig(state.slackToken, state.anthropicKey, state.oauthToken, state.model, timezone, state.openaiKey, state.enableEmbeddings);
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
              onSubmit={(token) => void handleSlackTokenSubmit(token)}
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
              onSubmit={(key) => void handleAnthropicKeySubmit(key)}
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
              onSubmit={(token) => void handleOAuthTokenSubmit(token)}
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
              onSubmit={(key) => void handleOpenAIKeySubmit(key)}
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
