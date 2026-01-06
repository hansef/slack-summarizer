#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { createLogger } from '@/utils/logging/index.js';

const logger = createLogger({ component: 'McpServer' });
import { getHighLevelTools, handleHighLevelTool } from './tools/high-level.js';
import { getPrimitiveTools, handlePrimitiveTool } from './tools/primitives.js';
import { getResources, handleResourceRead } from './resources.js';
import { registerCleanupHandlers } from '@/core/cache/db.js';

// Register cleanup handlers for graceful database shutdown
registerCleanupHandlers();

// Create server instance
const server = new Server(
  {
    name: 'slack-summarizer',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, () => {
  const highLevelTools = getHighLevelTools();
  const primitiveTools = getPrimitiveTools();

  return {
    tools: [...highLevelTools, ...primitiveTools],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params;

  logger.info({ tool: name, args }, 'MCP tool call');

  try {
    // Try high-level tools first
    const highLevelResult = await handleHighLevelTool(name, args ?? {});
    if (highLevelResult !== null) {
      return highLevelResult;
    }

    // Try primitive tools
    const primitiveResult = await handlePrimitiveTool(name, args ?? {});
    if (primitiveResult !== null) {
      return primitiveResult;
    }

    // Unknown tool
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ error: `Unknown tool: ${name}` }),
        },
      ],
      isError: true,
    };
  } catch (error) {
    logger.error(
      { tool: name, error: error instanceof Error ? error.message : String(error) },
      'MCP tool error'
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
        },
      ],
      isError: true,
    };
  }
});

// List available resources
server.setRequestHandler(ListResourcesRequestSchema, () => {
  return {
    resources: getResources(),
  };
});

// Read resource content
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  logger.info({ uri }, 'MCP resource read');

  try {
    const content = await handleResourceRead(uri);
    return {
      contents: [content],
    };
  } catch (error) {
    logger.error(
      { uri, error: error instanceof Error ? error.message : String(error) },
      'MCP resource error'
    );

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
        },
      ],
    };
  }
});

// Start the server
async function main(): Promise<void> {
  logger.info('Starting MCP server...');

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('MCP server connected via stdio');
}

main().catch((error) => {
  logger.error(
    { error: error instanceof Error ? error.message : String(error) },
    'MCP server failed to start'
  );
  process.exit(1);
});
