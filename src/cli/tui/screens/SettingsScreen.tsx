/**
 * Settings screen for editing configuration
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { Select, TextInput, StatusMessage, Spinner, PasswordInput } from '@inkjs/ui';
import {
  loadConfigFile,
  writeConfigFile,
  createFullConfig,
  getConfigFilePath,
  getDisplayPath,
  type ConfigFile,
} from '../../../config/index.js';
import {
  isClaudeCliAvailable,
  validateSlackToken,
  validateAnthropicApiKey,
  validateClaudeOAuthToken,
  validateOpenAIKey,
} from '../utils/validators.js';

interface SettingsScreenProps {
  onBack: () => void;
}

type SettingKey =
  | 'slackToken'
  | 'claudeAuthMethod'
  | 'claudeCredentials'
  | 'model'
  | 'timezone'
  | 'logLevel'
  | 'enableEmbeddings'
  | 'openaiKey';

type AuthMethod = 'api_key' | 'oauth';

interface EditState {
  editing: SettingKey | null;
  validating: boolean;
  saving: boolean;
  message: { type: 'success' | 'error'; text: string } | null;
}

const SETTING_OPTIONS: Array<{ label: string; value: SettingKey }> = [
  { label: 'Slack User Token', value: 'slackToken' },
  { label: 'Claude Auth Method', value: 'claudeAuthMethod' },
  { label: 'Claude Credentials', value: 'claudeCredentials' },
  { label: 'Claude Model', value: 'model' },
  { label: 'Timezone', value: 'timezone' },
  { label: 'Log Level', value: 'logLevel' },
  { label: 'Enable Embeddings', value: 'enableEmbeddings' },
  { label: 'OpenAI API Key', value: 'openaiKey' },
];

export function SettingsScreen({ onBack }: SettingsScreenProps): React.ReactElement {
  const [config, setConfig] = useState<ConfigFile | null>(() => {
    try {
      return loadConfigFile();
    } catch {
      return null;
    }
  });

  const [editState, setEditState] = useState<EditState>({
    editing: null,
    validating: false,
    saving: false,
    message: null,
  });

  const [selectedIndex, setSelectedIndex] = useState(0);

  // Track the desired auth method when switching (null = use current)
  const [selectedAuthMethod, setSelectedAuthMethod] = useState<AuthMethod | null>(null);

  // Check CLI availability for OAuth option
  const cliAvailable = isClaudeCliAvailable();

  // Determine current auth method from config
  const getCurrentAuthMethod = useCallback((): AuthMethod => {
    if (config?.anthropic?.oauth_token) return 'oauth';
    return 'api_key';
  }, [config]);

  useInput((input, key) => {
    if (editState.editing || editState.validating || editState.saving) return;

    if (key.escape || input === 'q') {
      onBack();
    } else if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(SETTING_OPTIONS.length - 1, i + 1));
    } else if (key.return) {
      const setting = SETTING_OPTIONS[selectedIndex];
      if (setting) {
        setEditState({ ...editState, editing: setting.value, message: null });
      }
    }
  });

  interface ConfigUpdates {
    slackToken?: string;
    authMethod?: AuthMethod;
    claudeCredentials?: string;
    model?: string;
    timezone?: string;
    logLevel?: string;
    enableEmbeddings?: boolean;
    openaiKey?: string;
  }

  const saveConfig = useCallback(
    async (updates: ConfigUpdates) => {
      if (!config) return;

      setEditState((s) => ({ ...s, saving: true }));

      try {
        // Determine the auth method and credentials
        const authMethod = updates.authMethod ?? getCurrentAuthMethod();
        let anthropicKey: string | undefined;
        let oauthToken: string | undefined;

        if (updates.claudeCredentials) {
          // New credentials provided - use them based on auth method
          if (authMethod === 'api_key') {
            anthropicKey = updates.claudeCredentials;
            oauthToken = undefined; // Clear old OAuth token
          } else {
            oauthToken = updates.claudeCredentials;
            anthropicKey = undefined; // Clear old API key
          }
        } else if (updates.authMethod && updates.authMethod !== getCurrentAuthMethod()) {
          // Auth method changed but no new credentials yet
          // This shouldn't normally happen - we require credentials when switching
          anthropicKey = config.anthropic?.api_key;
          oauthToken = config.anthropic?.oauth_token;
        } else {
          // Preserve existing credentials
          anthropicKey = config.anthropic?.api_key;
          oauthToken = config.anthropic?.oauth_token;
        }

        const newConfig = createFullConfig({
          slackToken: updates.slackToken ?? config.slack?.user_token ?? '',
          anthropicKey,
          oauthToken,
          model: updates.model ?? config.anthropic?.model,
          timezone: updates.timezone ?? config.settings?.timezone,
          logLevel: updates.logLevel ?? config.logging?.level,
          enableEmbeddings: updates.enableEmbeddings ?? config.embeddings?.enabled,
          openaiKey: updates.openaiKey ?? config.embeddings?.api_key,
        });

        writeConfigFile(newConfig);
        setConfig(newConfig);
        setSelectedAuthMethod(null); // Reset auth method selection
        setEditState({
          editing: null,
          validating: false,
          saving: false,
          message: { type: 'success', text: 'Settings saved!' },
        });
      } catch (err) {
        setEditState({
          editing: null,
          validating: false,
          saving: false,
          message: {
            type: 'error',
            text: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
          },
        });
      }
    },
    [config, getCurrentAuthMethod]
  );

  const handleModelChange = useCallback(
    (model: string) => {
      saveConfig({ model });
    },
    [saveConfig]
  );

  const handleTimezoneSubmit = useCallback(
    (timezone: string) => {
      saveConfig({ timezone });
    },
    [saveConfig]
  );

  const handleLogLevelChange = useCallback(
    (logLevel: string) => {
      saveConfig({ logLevel });
    },
    [saveConfig]
  );

  const handleEmbeddingsChange = useCallback(
    (enabled: string) => {
      saveConfig({ enableEmbeddings: enabled === 'true' });
    },
    [saveConfig]
  );

  const handleEditCancel = useCallback(() => {
    setEditState((s) => ({ ...s, editing: null }));
    setSelectedAuthMethod(null);
  }, []);

  // Handler for Slack token
  const handleSlackTokenSubmit = useCallback(
    async (token: string) => {
      setEditState((s) => ({ ...s, validating: true }));

      const result = await validateSlackToken(token);
      if (result.success) {
        void saveConfig({ slackToken: token });
      } else {
        setEditState((s) => ({
          ...s,
          validating: false,
          message: { type: 'error', text: result.error ?? 'Validation failed' },
        }));
      }
    },
    [saveConfig]
  );

  // Handler for auth method change
  const handleAuthMethodChange = useCallback(
    (method: string) => {
      const authMethod = method as AuthMethod;
      setSelectedAuthMethod(authMethod);
      // Now prompt for credentials
      setEditState((s) => ({ ...s, editing: 'claudeCredentials', message: null }));
    },
    []
  );

  // Handler for Claude credentials
  const handleClaudeCredentialsSubmit = useCallback(
    async (credentials: string) => {
      const authMethod = selectedAuthMethod ?? getCurrentAuthMethod();
      setEditState((s) => ({ ...s, validating: true }));

      const result =
        authMethod === 'api_key'
          ? await validateAnthropicApiKey(credentials)
          : await validateClaudeOAuthToken(credentials);

      if (result.success) {
        void saveConfig({ authMethod, claudeCredentials: credentials });
      } else {
        setEditState((s) => ({
          ...s,
          validating: false,
          message: { type: 'error', text: result.error ?? 'Validation failed' },
        }));
      }
    },
    [saveConfig, selectedAuthMethod, getCurrentAuthMethod]
  );

  // Handler for OpenAI key with validation
  const handleOpenAIKeyWithValidation = useCallback(
    async (openaiKey: string) => {
      if (!openaiKey) {
        // Allow clearing the key
        void saveConfig({ openaiKey: undefined });
        return;
      }

      setEditState((s) => ({ ...s, validating: true }));

      const result = await validateOpenAIKey(openaiKey);
      if (result.success) {
        void saveConfig({ openaiKey });
      } else {
        setEditState((s) => ({
          ...s,
          validating: false,
          message: { type: 'error', text: result.error ?? 'Validation failed' },
        }));
      }
    },
    [saveConfig]
  );

  if (!config) {
    return (
      <Box flexDirection="column">
        <StatusMessage variant="error">
          No configuration found. Please run setup first.
        </StatusMessage>
        <Box marginTop={1}>
          <Text dimColor>Press Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  if (editState.validating) {
    return (
      <Box flexDirection="column">
        <Spinner label="Validating credentials..." />
      </Box>
    );
  }

  if (editState.saving) {
    return (
      <Box flexDirection="column">
        <Spinner label="Saving settings..." />
      </Box>
    );
  }

  // Slack token edit screen
  if (editState.editing === 'slackToken') {
    return (
      <Box flexDirection="column">
        <Text bold>Slack User Token</Text>
        <Box marginTop={1}>
          <Text dimColor>Get your token from: https://api.slack.com/apps</Text>
        </Box>
        <Text dimColor>Must start with xoxp-</Text>
        {editState.message && (
          <Box marginTop={1}>
            <StatusMessage variant={editState.message.type}>{editState.message.text}</StatusMessage>
          </Box>
        )}
        <Box marginTop={1}>
          <PasswordInput
            placeholder="xoxp-..."
            onSubmit={(token) => void handleSlackTokenSubmit(token)}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Esc to cancel</Text>
        </Box>
        <CancelHandler onCancel={handleEditCancel} />
      </Box>
    );
  }

  // Claude auth method selection screen
  if (editState.editing === 'claudeAuthMethod') {
    return (
      <Box flexDirection="column">
        <Text bold>Claude Authentication Method</Text>
        <Box marginTop={1}>
          <Text dimColor>Choose how to authenticate with Claude:</Text>
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
            onChange={handleAuthMethodChange}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Esc to cancel</Text>
        </Box>
        <CancelHandler onCancel={handleEditCancel} />
      </Box>
    );
  }

  // Claude credentials edit screen
  if (editState.editing === 'claudeCredentials') {
    const authMethod = selectedAuthMethod ?? getCurrentAuthMethod();
    const isOAuth = authMethod === 'oauth';

    return (
      <Box flexDirection="column">
        {!cliAvailable && isOAuth && (
          <Box marginBottom={1}>
            <StatusMessage variant="warning">
              Claude CLI not found. Install: npm i -g @anthropic-ai/claude-code
            </StatusMessage>
          </Box>
        )}
        <Text bold>{isOAuth ? 'Claude OAuth Token' : 'Anthropic API Key'}</Text>
        <Box marginTop={1}>
          <Text dimColor>
            {isOAuth
              ? 'Get your token by running: claude setup-token'
              : 'Get your key from: https://console.anthropic.com/'}
          </Text>
        </Box>
        <Text dimColor>
          {isOAuth ? 'Must start with sk-ant-oat' : 'Must start with sk-ant-'}
        </Text>
        {editState.message && (
          <Box marginTop={1}>
            <StatusMessage variant={editState.message.type}>{editState.message.text}</StatusMessage>
          </Box>
        )}
        <Box marginTop={1}>
          <PasswordInput
            placeholder={isOAuth ? 'sk-ant-oat01-...' : 'sk-ant-...'}
            onSubmit={(cred) => void handleClaudeCredentialsSubmit(cred)}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Esc to cancel</Text>
        </Box>
        <CancelHandler onCancel={handleEditCancel} />
      </Box>
    );
  }

  if (editState.editing === 'model') {
    return (
      <Box flexDirection="column">
        <Text bold>Select Claude Model</Text>
        <Box marginTop={1}>
          <Select
            options={[
              { label: 'Haiku (faster, cheaper)', value: 'claude-haiku-4-5-20251001' },
              { label: 'Sonnet (higher quality)', value: 'claude-sonnet-4-5-20250929' },
            ]}
            onChange={handleModelChange}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Esc to cancel</Text>
        </Box>
        <CancelHandler onCancel={handleEditCancel} />
      </Box>
    );
  }

  if (editState.editing === 'timezone') {
    return (
      <Box flexDirection="column">
        <Text bold>Enter Timezone (IANA format)</Text>
        <Box marginTop={1}>
          <TextInput
            placeholder="America/Los_Angeles"
            defaultValue={config.settings?.timezone || 'America/Los_Angeles'}
            onSubmit={handleTimezoneSubmit}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Esc to cancel</Text>
        </Box>
        <CancelHandler onCancel={handleEditCancel} />
      </Box>
    );
  }

  if (editState.editing === 'logLevel') {
    return (
      <Box flexDirection="column">
        <Text bold>Select Log Level</Text>
        <Box marginTop={1}>
          <Select
            options={[
              { label: 'Debug', value: 'debug' },
              { label: 'Info', value: 'info' },
              { label: 'Warn', value: 'warn' },
              { label: 'Error', value: 'error' },
            ]}
            onChange={handleLogLevelChange}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Esc to cancel</Text>
        </Box>
        <CancelHandler onCancel={handleEditCancel} />
      </Box>
    );
  }

  if (editState.editing === 'enableEmbeddings') {
    return (
      <Box flexDirection="column">
        <Text bold>Enable Embeddings</Text>
        <Box marginTop={1}>
          <Text dimColor>
            Embeddings improve conversation grouping using semantic similarity.
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Requires an OpenAI API key.</Text>
        </Box>
        <Box marginTop={1}>
          <Select
            options={[
              { label: 'Enabled', value: 'true' },
              { label: 'Disabled', value: 'false' },
            ]}
            onChange={handleEmbeddingsChange}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Esc to cancel</Text>
        </Box>
        <CancelHandler onCancel={handleEditCancel} />
      </Box>
    );
  }

  if (editState.editing === 'openaiKey') {
    return (
      <Box flexDirection="column">
        <Text bold>OpenAI API Key</Text>
        <Box marginTop={1}>
          <Text dimColor>Get your key from: https://platform.openai.com/api-keys</Text>
        </Box>
        <Text dimColor>Must start with sk- (leave empty to remove)</Text>
        {editState.message && (
          <Box marginTop={1}>
            <StatusMessage variant={editState.message.type}>{editState.message.text}</StatusMessage>
          </Box>
        )}
        <Box marginTop={1}>
          <PasswordInput
            placeholder="sk-..."
            onSubmit={(key) => void handleOpenAIKeyWithValidation(key)}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Esc to cancel</Text>
        </Box>
        <CancelHandler onCancel={handleEditCancel} />
      </Box>
    );
  }

  // Main settings list
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Settings</Text>
      </Box>
      <Box marginBottom={1}>
        <Text dimColor>Config: {getDisplayPath(getConfigFilePath())}</Text>
      </Box>

      {editState.message && (
        <Box marginBottom={1}>
          <StatusMessage variant={editState.message.type}>
            {editState.message.text}
          </StatusMessage>
        </Box>
      )}

      <Box flexDirection="column">
        {SETTING_OPTIONS.map((option, index) => {
          const isSelected = index === selectedIndex;
          let currentValue = '';

          switch (option.value) {
            case 'slackToken':
              currentValue = config.slack?.user_token ? '••••••••' : '(not set)';
              break;
            case 'claudeAuthMethod':
              currentValue = config.anthropic?.oauth_token
                ? 'OAuth Token'
                : config.anthropic?.api_key
                  ? 'API Key'
                  : '(not set)';
              break;
            case 'claudeCredentials':
              currentValue =
                config.anthropic?.api_key || config.anthropic?.oauth_token
                  ? '••••••••'
                  : '(not set)';
              break;
            case 'model':
              currentValue = config.anthropic?.model || 'claude-haiku-4-5-20251001';
              break;
            case 'timezone':
              currentValue = config.settings?.timezone || 'America/Los_Angeles';
              break;
            case 'logLevel':
              currentValue = config.logging?.level || 'info';
              break;
            case 'enableEmbeddings':
              currentValue = config.embeddings?.enabled ? 'enabled' : 'disabled';
              break;
            case 'openaiKey':
              currentValue = config.embeddings?.api_key ? '••••••••' : '(not set)';
              break;
          }

          return (
            <Box key={option.value}>
              <Text
                color={isSelected ? 'cyan' : undefined}
                bold={isSelected}
              >
                {isSelected ? '> ' : '  '}
                {option.label}: <Text dimColor>{currentValue}</Text>
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={2}>
        <Text dimColor>↑↓ select │ Enter edit │ Esc back</Text>
      </Box>
    </Box>
  );
}

// Helper component to handle escape key for canceling edits
function CancelHandler({ onCancel }: { onCancel: () => void }): null {
  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
    }
  });
  return null;
}
