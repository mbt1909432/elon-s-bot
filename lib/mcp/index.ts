/**
 * MCP Module - Model Context Protocol Integration
 *
 * This module provides integration with external MCP servers:
 * - Connect to MCP servers via HTTP/SSE
 * - Discover and wrap MCP tools
 * - Execute MCP tool calls
 *
 * Usage:
 * ```typescript
 * import { getMCPManager, initializeMCPServersFromEnv } from '@/lib/mcp';
 *
 * // Initialize servers from environment
 * await initializeMCPServersFromEnv();
 *
 * // Get tool schemas for LLM
 * const schemas = getMCPManager().getAllToolSchemas();
 *
 * // Execute a tool
 * const result = await getMCPManager().executeTool('mcp_weather_get_forecast', { city: 'Beijing' });
 * ```
 */

export * from './types';
export * from './client';

// Re-export commonly used items
export {
  MCPHttpClient,
  MCPClientManager,
  getMCPManager,
  initializeMCPServersFromEnv,
  mcpToolToOpenAISchema,
  parseMCPToolName,
  isMCPToolName,
} from './client';

export type {
  MCPServerConfig,
  MCPToolDefinition,
  MCPToolResult,
  JSONRPCRequest,
  JSONRPCResponse,
  MCPServerInfo,
  MCPServerCapabilities,
} from './types';
