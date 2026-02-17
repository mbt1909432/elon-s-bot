/**
 * Core types for LLM + Acontext integration
 * Copy this file to your project and adjust as needed.
 */

// ============ LLM Types ============

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentPart[];
  /** Tool calls for assistant messages (OpenAI format) */
  tool_calls?: ToolCall[];
  /** Tool call ID for tool response messages */
  tool_call_id?: string;
}

export interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface LLMConfig {
  endpoint: string;
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ToolInvocation {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: string;
  invokedAt: Date;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

// ============ Acontext Types ============

export interface AcontextConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface AcontextSession {
  id: string;
  configs?: Record<string, unknown>;
  created_at?: string;
}

export interface AcontextDisk {
  id: string;
  created_at?: string;
}

export interface AcontextArtifact {
  id?: string;
  path?: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  createdAt?: string;
}

export interface AcontextMessageList {
  items: AcontextMessageItem[];
  total?: number;
}

export interface AcontextMessageItem {
  id?: string;
  role?: string;
  content?: string | ContentPart[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  created_at?: string | Date;
}

export interface TokenCounts {
  total_tokens: number;
}

// ============ Tool Execution Context ============

export interface ToolExecutionContext {
  /** Acontext client for disk operations */
  acontextClient: AcontextClientLike;
  /** Disk ID for file operations */
  diskId?: string;
  /** Session ID for message operations */
  sessionId?: string;
  /** User ID for user-scoped operations */
  userId?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Minimal interface for Acontext client
 * Use this for type hints; actual client from @acontext/acontext
 */
export interface AcontextClientLike {
  sessions: {
    create: (params?: { configs?: Record<string, unknown> }) => Promise<AcontextSession>;
    delete: (sessionId: string) => Promise<void>;
    storeMessage: (sessionId: string, message: unknown, options?: { format?: string }) => Promise<void>;
    getMessages: (sessionId: string, options?: {
      format?: string;
      limit?: number;
      editStrategies?: EditStrategy[];
    }) => Promise<AcontextMessageList>;
    getTokenCounts: (sessionId: string) => Promise<TokenCounts>;
  };
  disks: {
    create: () => Promise<AcontextDisk>;
    list: () => Promise<{ items: AcontextDisk[] }>;
    artifacts: {
      upsert: (diskId: string, params: {
        file: [string, Buffer | ArrayBuffer, string];
        filePath?: string;
      }) => Promise<AcontextArtifact>;
      get: (diskId: string, params: {
        filePath?: string;
        filename: string;
        withContent?: boolean;
        withPublicUrl?: boolean;
      }) => Promise<{
        artifact?: AcontextArtifact;
        content?: { type?: string; text?: string; raw?: unknown };
        public_url?: string;
      }>;
      list: (diskId: string, params?: { path?: string }) => Promise<{
        artifacts?: AcontextArtifact[];
        directories?: string[];
      }>;
      delete: (diskId: string, params: {
        filePath?: string;
        filename: string;
      }) => Promise<void>;
    };
  };
  ping: () => Promise<boolean>;
}

// ============ Context Editing ============

export type EditStrategy =
  | {
      type: "token_limit";
      params: {
        limit_tokens: number;
      };
    }
  | {
      type: "remove_tool_result";
      params: {
        keep_recent_n_tool_results?: number;
        tool_result_placeholder?: string;
      };
    }
  | {
      type: "remove_tool_call_params";
      params: {
        keep_recent_n_tool_calls?: number;
      };
    };
