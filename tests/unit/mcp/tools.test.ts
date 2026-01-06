import { describe, it, expect } from 'vitest';
import { getHighLevelTools } from '@/mcp/tools/high-level.js';
import { getPrimitiveTools } from '@/mcp/tools/primitives.js';
import { getResources } from '@/mcp/resources.js';

describe('MCP Tools', () => {
  describe('High-Level Tools', () => {
    it('should return slack_get_user_summary tool', () => {
      const tools = getHighLevelTools();

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('slack_get_user_summary');
      expect(tools[0].description).toContain('summary');
      expect(tools[0].inputSchema.required).toContain('timespan');
    });

    it('should have proper input schema', () => {
      const tools = getHighLevelTools();
      const tool = tools[0];

      expect(tool.inputSchema.properties).toHaveProperty('timespan');
      expect(tool.inputSchema.properties).toHaveProperty('user_id');
      expect(tool.inputSchema.properties).toHaveProperty('model');
    });
  });

  describe('Primitive Tools', () => {
    it('should return all primitive tools', () => {
      const tools = getPrimitiveTools();

      expect(tools.length).toBe(5);

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain('slack_search_messages');
      expect(toolNames).toContain('slack_get_channel_history');
      expect(toolNames).toContain('slack_get_thread');
      expect(toolNames).toContain('slack_get_reactions');
      expect(toolNames).toContain('slack_list_channels');
    });

    it('should have descriptions for all tools', () => {
      const tools = getPrimitiveTools();

      for (const tool of tools) {
        expect(tool.description).toBeDefined();
        expect(tool.description!.length).toBeGreaterThan(10);
      }
    });

    it('should have input schemas for all tools', () => {
      const tools = getPrimitiveTools();

      for (const tool of tools) {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.inputSchema.properties).toBeDefined();
      }
    });
  });

  describe('Resources', () => {
    it('should return workspace and channel resources', () => {
      const resources = getResources();

      expect(resources).toHaveLength(2);

      const uris = resources.map((r) => r.uri);
      expect(uris).toContain('slack://workspace/info');
      expect(uris).toContain('slack://channels/list');
    });

    it('should have proper MIME types', () => {
      const resources = getResources();

      for (const resource of resources) {
        expect(resource.mimeType).toBe('application/json');
      }
    });

    it('should have descriptions for all resources', () => {
      const resources = getResources();

      for (const resource of resources) {
        expect(resource.description).toBeDefined();
        expect(resource.description!.length).toBeGreaterThan(5);
      }
    });
  });
});
