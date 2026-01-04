/**
 * Settings screen for editing configuration
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { Select, TextInput, StatusMessage, Spinner } from '@inkjs/ui';
import {
  loadConfigFile,
  writeConfigFile,
  createFullConfig,
  getConfigFilePath,
  getDisplayPath,
  type ConfigFile,
} from '../../../config/index.js';

interface SettingsScreenProps {
  onBack: () => void;
}

type SettingKey = 'model' | 'timezone' | 'logLevel' | 'enableEmbeddings' | 'openaiKey';

interface EditState {
  editing: SettingKey | null;
  saving: boolean;
  message: { type: 'success' | 'error'; text: string } | null;
}

const SETTING_OPTIONS: Array<{ label: string; value: SettingKey }> = [
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
    saving: false,
    message: null,
  });

  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (editState.editing || editState.saving) return;

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

  const saveConfig = useCallback(
    async (updates: Partial<{ model: string; timezone: string; logLevel: string; enableEmbeddings: boolean; openaiKey: string }>) => {
      if (!config) return;

      setEditState((s) => ({ ...s, saving: true }));

      try {
        const newConfig = createFullConfig({
          slackToken: config.slack?.user_token || '',
          anthropicKey: config.anthropic?.api_key || '',
          model: updates.model ?? config.anthropic?.model,
          timezone: updates.timezone ?? config.settings?.timezone,
          logLevel: updates.logLevel ?? config.logging?.level,
          enableEmbeddings: updates.enableEmbeddings ?? config.embeddings?.enabled,
          openaiKey: updates.openaiKey ?? config.embeddings?.api_key,
        });

        writeConfigFile(newConfig);
        setConfig(newConfig);
        setEditState({
          editing: null,
          saving: false,
          message: { type: 'success', text: 'Settings saved!' },
        });
      } catch (err) {
        setEditState({
          editing: null,
          saving: false,
          message: {
            type: 'error',
            text: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
          },
        });
      }
    },
    [config]
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

  const handleOpenAIKeySubmit = useCallback(
    (openaiKey: string) => {
      if (openaiKey && !openaiKey.startsWith('sk-')) {
        setEditState((s) => ({
          ...s,
          editing: null,
          message: { type: 'error', text: 'API key must start with sk-' },
        }));
        return;
      }
      saveConfig({ openaiKey: openaiKey || undefined });
    },
    [saveConfig]
  );

  const handleEditCancel = useCallback(() => {
    setEditState((s) => ({ ...s, editing: null }));
  }, []);

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

  if (editState.saving) {
    return (
      <Box flexDirection="column">
        <Spinner label="Saving settings..." />
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
        <Box marginTop={1}>
          <TextInput
            placeholder="sk-..."
            defaultValue={config.embeddings?.api_key || ''}
            onSubmit={handleOpenAIKeySubmit}
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
