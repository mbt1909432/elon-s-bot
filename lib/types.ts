// ElonsBot Type Definitions

// ============================================
// User & Profile Types
// ============================================
export interface UserProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  preferences: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ============================================
// Conversation Types
// ============================================
export interface Conversation {
  id: string;
  user_id: string;
  title: string | null;
  acontext_session_id: string | null;
  acontext_disk_id: string | null;
  model: string;
  system_prompt: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// ============================================
// Memory Types
// ============================================
export type MemoryType = 'preference' | 'fact' | 'instruction' | 'event' | 'context';

export interface Memory {
  id: string;
  user_id: string;
  conversation_id: string | null;
  memory_type: MemoryType;
  key: string;
  value: string;
  importance: number;
  source: string | null;
  metadata: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

// ============================================
// Event Types
// ============================================
export type EventStatus = 'pending' | 'completed' | 'cancelled';

export interface Event {
  id: string;
  user_id: string;
  conversation_id: string | null;
  event_type: string;
  title: string | null;
  description: string | null;
  event_time: string | null;
  duration_minutes: number | null;
  status: EventStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ============================================
// Agent Settings Types
// ============================================
export interface AgentSettings {
  id: string;
  user_id: string;
  default_model: string;
  system_prompt: string | null;
  temperature: number;
  max_tokens: number;
  tools_enabled: string[];
  auto_save_memory: boolean;
  memory_retention_days: number;
  created_at: string;
  updated_at: string;
}

// ============================================
// Tool Execution Types
// ============================================
export type ToolExecutionStatus = 'pending' | 'running' | 'success' | 'error';

export interface ToolExecution {
  id: string;
  conversation_id: string;
  message_id: string | null;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_output: Record<string, unknown> | null;
  status: ToolExecutionStatus;
  error_message: string | null;
  execution_time_ms: number | null;
  created_at: string;
}

// ============================================
// Acontext Types
// ============================================
export interface AcontextSession {
  id: string;
  diskId: string;
  createdAt: string;
  expiresAt: string;
}

export interface AcontextDiskFile {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  mimeType?: string;
  content?: string;
  createdAt?: string;
  modifiedAt?: string;
}

// ============================================
// Chat API Types
// ============================================
export interface ChatRequest {
  conversation_id?: string;
  message: string;
  model?: string;
  stream?: boolean;
}

export interface ChatResponse {
  conversation_id: string;
  message: Message;
  tool_executions?: ToolExecution[];
}

export interface StreamChatEvent {
  type: 'content' | 'tool_call' | 'tool_result' | 'error' | 'done' | 'conversation_id' | 'tool_calls_start';
  content?: string;
  tool_call?: ToolCall;
  tool_result?: {
    tool_call_id: string;
    output: unknown;
  };
  error?: string;
  conversation_id?: string;
  count?: number;
}

// ============================================
// Tool Types
// ============================================
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, {
        type: string;
        description?: string;
        enum?: string[];
      }>;
      required?: string[];
    };
  };
}

export interface ToolExecutionContext {
  conversationId: string;
  userId: string;
  acontextSessionId?: string;
  acontextDiskId?: string;
}

export interface ToolResult {
  success: boolean;
  output: unknown;
  error?: string;
}
