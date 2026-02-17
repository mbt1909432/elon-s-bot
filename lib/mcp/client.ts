/**
 * MCP (Model Context Protocol) Client
 * Connects to MCP servers and wraps their tools for use by the agent
 */

import type { ToolDefinition } from '@/lib/types';
import type {
  MCPServerConfig,
  MCPToolDefinition,
  MCPToolResult,
  JSONRPCRequest,
  JSONRPCResponse,
  MCPServerInfo,
} from './types';

// Request ID counter
let requestId = 1;

/**
 * MCP HTTP Client
 * Connects to MCP servers via HTTP/SSE transport
 */
export class MCPHttpClient {
  private serverUrl: string;
  private serverName: string;
  private requestTimeout: number;
  private serverInfo: MCPServerInfo | null = null;
  private tools: MCPToolDefinition[] = [];

  constructor(config: { url: string; name: string; timeout?: number }) {
    this.serverUrl = config.url;
    this.serverName = config.name;
    this.requestTimeout = config.timeout || 30000;
  }

  /**
   * Send a JSON-RPC request to the MCP server
   */
  private async sendRequest<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: requestId++,
      method,
      params,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);

    try {
      const response = await fetch(this.serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = (await response.json()) as JSONRPCResponse<T>;

      if (result.error) {
        throw new Error(result.error.message);
      }

      return result.result as T;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Initialize connection to MCP server
   */
  async initialize(): Promise<MCPServerInfo> {
    const result = await this.sendRequest<{
      serverInfo: MCPServerInfo;
      capabilities?: MCPServerInfo['capabilities'];
    }>('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'elonsbot',
        version: '1.0.0',
      },
    });

    this.serverInfo = result.serverInfo;
    return this.serverInfo;
  }

  /**
   * Discover available tools from the server
   */
  async discoverTools(): Promise<MCPToolDefinition[]> {
    const result = await this.sendRequest<{ tools: MCPToolDefinition[] }>('tools/list');
    this.tools = result.tools || [];
    return this.tools;
  }

  /**
   * Call a tool on the MCP server
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    return this.sendRequest<MCPToolResult>('tools/call', {
      name: toolName,
      arguments: args,
    });
  }

  /**
   * Get server info
   */
  getServerInfo(): MCPServerInfo | null {
    return this.serverInfo;
  }

  /**
   * Get cached tools
   */
  getTools(): MCPToolDefinition[] {
    return this.tools;
  }

  /**
   * Get server name
   */
  getServerName(): string {
    return this.serverName;
  }
}

/**
 * Convert MCP tool definition to OpenAI/LLM tool schema
 */
export function mcpToolToOpenAISchema(
  serverName: string,
  tool: MCPToolDefinition
): ToolDefinition {
  return {
    type: 'function',
    function: {
      name: `mcp_${serverName}_${tool.name}`,
      description: tool.description || tool.name,
      parameters: tool.inputSchema as ToolDefinition['function']['parameters'],
    },
  };
}

/**
 * Parse MCP tool name to extract server and tool
 */
export function parseMCPToolName(fullName: string): { serverName: string; toolName: string } | null {
  const match = fullName.match(/^mcp_(.+)_(.+)$/);
  if (!match) return null;
  return {
    serverName: match[1],
    toolName: match[2],
  };
}

/**
 * Check if a tool name is an MCP tool
 */
export function isMCPToolName(name: string): boolean {
  return name.startsWith('mcp_') && name.split('_').length >= 3;
}

/**
 * MCP Client Manager
 * Manages connections to multiple MCP servers
 */
export class MCPClientManager {
  private clients: Map<string, MCPHttpClient> = new Map();
  private toolToServer: Map<string, { serverName: string; toolName: string }> = new Map();

  /**
   * Add and connect to an MCP server
   */
  async addServer(config: MCPServerConfig): Promise<{ success: boolean; error?: string }> {
    if (!config.url) {
      return { success: false, error: 'Server URL is required' };
    }

    try {
      const client = new MCPHttpClient({
        url: config.url,
        name: config.name,
      });

      // Initialize connection
      await client.initialize();

      // Discover tools
      const tools = await client.discoverTools();

      // Register tools
      for (const tool of tools) {
        const fullName = `mcp_${config.name}_${tool.name}`;
        this.toolToServer.set(fullName, {
          serverName: config.name,
          toolName: tool.name,
        });
      }

      this.clients.set(config.name, client);

      console.log(`[MCP] Connected to ${config.name}: ${tools.length} tools`);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[MCP] Failed to connect to ${config.name}:`, errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Remove an MCP server
   */
  removeServer(name: string): void {
    const client = this.clients.get(name);
    if (client) {
      // Remove all tools from this server
      for (const [fullName, mapping] of this.toolToServer) {
        if (mapping.serverName === name) {
          this.toolToServer.delete(fullName);
        }
      }
      this.clients.delete(name);
    }
  }

  /**
   * Execute an MCP tool
   */
  async executeTool(fullName: string, args: Record<string, unknown>): Promise<string> {
    const mapping = this.toolToServer.get(fullName);
    if (!mapping) {
      throw new Error(`Unknown MCP tool: ${fullName}`);
    }

    const client = this.clients.get(mapping.serverName);
    if (!client) {
      throw new Error(`MCP server not connected: ${mapping.serverName}`);
    }

    try {
      const result = await client.callTool(mapping.toolName, args);

      // Extract text content
      const textParts: string[] = [];
      for (const block of result.content) {
        if (block.type === 'text' && block.text) {
          textParts.push(block.text);
        } else if (block.data) {
          textParts.push(`[${block.type}: ${block.data.slice(0, 100)}...]`);
        }
      }

      return textParts.join('\n') || '(no output)';
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`MCP tool execution failed: ${errorMessage}`);
    }
  }

  /**
   * Get all tool schemas for LLM
   */
  getAllToolSchemas(): ToolDefinition[] {
    const schemas: ToolDefinition[] = [];

    for (const [serverName, client] of this.clients) {
      for (const tool of client.getTools()) {
        schemas.push(mcpToolToOpenAISchema(serverName, tool));
      }
    }

    return schemas;
  }

  /**
   * Get connected servers
   */
  getConnectedServers(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Check if a tool is available
   */
  hasTool(fullName: string): boolean {
    return this.toolToServer.has(fullName);
  }
}

// Singleton instance
let managerInstance: MCPClientManager | null = null;

/**
 * Get the MCP client manager singleton
 */
export function getMCPManager(): MCPClientManager {
  if (!managerInstance) {
    managerInstance = new MCPClientManager();
  }
  return managerInstance;
}

/**
 * Initialize MCP servers from environment variable
 */
export async function initializeMCPServersFromEnv(): Promise<void> {
  const serversJson = process.env.MCP_SERVERS;
  if (!serversJson) return;

  try {
    const servers = JSON.parse(serversJson) as Record<string, Partial<MCPServerConfig>>;
    const manager = getMCPManager();

    for (const [name, config] of Object.entries(servers)) {
      if (config.url) {
        await manager.addServer({
          name,
          transportType: 'http',
          url: config.url,
          enabled: true,
        });
      }
    }
  } catch (error) {
    console.error('[MCP] Failed to initialize servers from env:', error);
  }
}
