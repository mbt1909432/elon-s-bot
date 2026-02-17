// Acontext-aligned Type Definitions
// These types align with the official @acontext/acontext SDK

// ============================================
// Chat Message Types (OpenAI-compatible)
// ============================================

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | ContentPart[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

// ============================================
// Edit Strategies for Message Compression
// ============================================

export type EditStrategy =
  | { type: 'token_limit'; params: { limit_tokens: number } }
  | { type: 'remove_tool_result'; params: { keep_recent_n_tool_results?: number } }
  | { type: 'remove_tool_call_params'; params: { keep_recent_n_tool_calls?: number } };

// ============================================
// Tool Execution Context
// ============================================

export interface ToolExecutionContext {
  acontextClient: import('@/lib/acontext/client').AcontextClient;
  diskId?: string;
  sessionId?: string;
  userId?: string;
  conversationId?: string;
  skillIds?: string[]; // Mounted skill IDs for SKILL_TOOLS
  supabase: {
    from: (table: string) => {
      insert: (data: unknown) => {
        select: () => {
          single: () => Promise<{ data: unknown; error: unknown }>;
        };
      };
    };
  };
}

// ============================================
// Session and Disk Types
// ============================================

export interface SessionWithDisk {
  sessionId: string;
  diskId: string;
}

export interface TokenCounts {
  total_tokens: number;
  prompt_tokens?: number;
  completion_tokens?: number;
}

// ============================================
// Messages API Options
// ============================================

export interface GetMessagesOptions {
  editStrategies?: EditStrategy[];
}

// ============================================
// Tool Result Types
// ============================================

export interface ToolResult {
  success: boolean;
  output: unknown;
  error?: string;
}

// ============================================
// Artifact Types
// ============================================

export interface ArtifactInfo {
  path: string;
  filename: string;
  public_url?: string;
  mime_type?: string;
  size?: number;
}
