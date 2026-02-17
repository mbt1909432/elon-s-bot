// Chat Session Management
// Handles conversation creation with 1:1:1 binding (Conversation : Session : Disk)

import { createClient } from '@/lib/supabase/server';
import { getAcontextClient } from './acontext/client';
import type { ChatMessage, EditStrategy } from './types/acontext';

// ============================================
// Types
// ============================================

export interface ConversationInfo {
  id: string;
  sessionId: string;
  diskId: string;
  title?: string | null;
  model?: string;
  systemPrompt?: string | null;
}

// ============================================
// Conversation Management (1:1:1 Binding)
// ============================================

/**
 * Get or create a conversation with proper 1:1:1 binding
 * One Conversation = One Acontext Session = One Acontext Disk
 */
export async function getOrCreateConversation(
  userId: string,
  userEmail: string,
  conversationId?: string
): Promise<ConversationInfo> {
  const supabase = await createClient();

  // Try to get existing conversation
  if (conversationId) {
    const { data, error } = await supabase
      .from('conversations')
      .select('id, acontext_session_id, acontext_disk_id, title, model, system_prompt')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .single();

    if (!error && data?.acontext_session_id && data?.acontext_disk_id) {
      console.log('[ChatSession] Found existing conversation:', {
        id: data.id,
        sessionId: data.acontext_session_id,
        diskId: data.acontext_disk_id,
      });

      return {
        id: data.id,
        sessionId: data.acontext_session_id,
        diskId: data.acontext_disk_id,
        title: data.title,
        model: data.model,
        systemPrompt: data.system_prompt,
      };
    }
  }

  // Create new conversation with 1:1:1 binding
  console.log('[ChatSession] Creating new conversation for user:', userEmail);

  const acontextClient = getAcontextClient();
  const { sessionId, diskId } = await acontextClient.createSessionWithDisk(userEmail);

  console.log('[ChatSession] Session and Disk created:', { sessionId, diskId });

  const { data, error } = await supabase
    .from('conversations')
    .insert({
      user_id: userId,
      title: 'New Conversation',
      acontext_session_id: sessionId,
      acontext_disk_id: diskId,
    })
    .select()
    .single();

  if (error || !data) {
    console.error('[ChatSession] Failed to create conversation:', error);
    throw new Error('Failed to create conversation');
  }

  console.log('[ChatSession] Conversation created:', data.id);

  return {
    id: data.id,
    sessionId,
    diskId,
    title: data.title,
    model: data.model,
    systemPrompt: data.system_prompt,
  };
}

// ============================================
// Message Storage (Acontext as Primary)
// ============================================

/**
 * Store a message to Acontext session
 * This is the primary message storage - NOT Supabase!
 */
export async function storeChatMessage(
  sessionId: string,
  message: ChatMessage
): Promise<void> {
  const client = getAcontextClient();
  await client.storeMessage(sessionId, message);
}

/**
 * Store user message
 */
export async function storeUserMessage(
  sessionId: string,
  content: string
): Promise<void> {
  await storeChatMessage(sessionId, {
    role: 'user',
    content,
  });
}

/**
 * Store assistant message (with optional tool_calls)
 */
export async function storeAssistantMessage(
  sessionId: string,
  content: string,
  toolCalls?: ChatMessage['tool_calls']
): Promise<void> {
  await storeChatMessage(sessionId, {
    role: 'assistant',
    content,
    tool_calls: toolCalls,
  });
}

/**
 * Store tool response message
 * CRITICAL: Must be called for each tool call to avoid errors in subsequent requests
 */
export async function storeToolMessage(
  sessionId: string,
  toolCallId: string,
  content: string
): Promise<void> {
  await storeChatMessage(sessionId, {
    role: 'tool',
    tool_call_id: toolCallId,
    content,
  });
}

// ============================================
// History Loading with Auto-Compression
// ============================================

const COMPRESSION_THRESHOLD = 80000; // 80K tokens
const COMPRESSION_TARGET = 70000; // 70K tokens after compression

/**
 * Load chat history from Acontext with automatic compression
 */
export async function loadChatHistory(sessionId: string): Promise<ChatMessage[]> {
  const client = getAcontextClient();

  // Get current token count
  const tokens = await client.getTokenCounts(sessionId);
  console.log('[ChatSession] Current token count:', tokens);

  // Apply compression if over threshold
  if (tokens > COMPRESSION_THRESHOLD) {
    console.log('[ChatSession] Applying compression...');

    const editStrategies: EditStrategy[] = [
      { type: 'token_limit', params: { limit_tokens: COMPRESSION_TARGET } },
      { type: 'remove_tool_result', params: { keep_recent_n_tool_results: 5 } },
    ];

    return client.getMessages(sessionId, { editStrategies });
  }

  return client.getMessages(sessionId);
}

/**
 * Get messages formatted for OpenAI API
 */
export function formatMessagesForOpenAI(messages: ChatMessage[]): Array<{
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  tool_calls?: ChatMessage['tool_calls'];
  tool_call_id?: string;
}> {
  return messages.map((m) => {
    // Handle content as string or ContentPart[]
    const content = typeof m.content === 'string' ? m.content : null;

    return {
      role: m.role,
      content,
      tool_calls: m.tool_calls,
      tool_call_id: m.tool_call_id,
    };
  });
}

// ============================================
// Conversation Metadata Updates
// ============================================

/**
 * Update conversation title (fire and forget)
 */
export function updateConversationTitle(
  conversationId: string,
  title: string
): void {
  const supabasePromise = createClient();

  void supabasePromise.then((supabase) => {
    void supabase
      .from('conversations')
      .update({ title })
      .eq('id', conversationId);
  });
}

/**
 * Get conversation by ID
 */
export async function getConversation(
  userId: string,
  conversationId: string
): Promise<ConversationInfo | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('conversations')
    .select('id, acontext_session_id, acontext_disk_id, title, model, system_prompt')
    .eq('id', conversationId)
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    sessionId: data.acontext_session_id || '',
    diskId: data.acontext_disk_id || '',
    title: data.title,
    model: data.model,
    systemPrompt: data.system_prompt,
  };
}

/**
 * Delete conversation
 */
export async function deleteConversation(
  userId: string,
  conversationId: string
): Promise<boolean> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('conversations')
    .delete()
    .eq('id', conversationId)
    .eq('user_id', userId);

  return !error;
}
