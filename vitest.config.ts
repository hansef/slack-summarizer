import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tests': path.resolve(__dirname, './tests'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/index.ts',
        'src/**/index.tsx',
        // CLI commands are entry points that require integration testing
        'src/cli/commands/**',
        // TUI screens with complex Ink components that are better tested via integration
        'src/cli/tui/screens/SetupScreen.tsx',
        'src/cli/tui/screens/DateSelectionScreen.tsx',
        'src/cli/tui/screens/SummaryScreen.tsx',
        'src/cli/tui/screens/SettingsScreen.tsx',
        'src/cli/tui/App.tsx',
        'src/cli/tui/hooks/**',
        // MCP server entry point
        'src/mcp/server.ts',
        // Type definition files with no runtime code
        'src/core/llm/types.ts',
        'src/core/models/config.ts',
        'src/core/models/conversation.ts',
        'src/cli/tui/types.ts',
        'src/core/slack/types.ts',
      ],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 75,
        lines: 80,
      },
    },
  },
});
