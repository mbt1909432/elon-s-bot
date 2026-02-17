/**
 * Memory Consolidation System
 *
 * Similar to nanobot's MEMORY.md + HISTORY.md system:
 * - user_memory: Long-term facts (updated by LLM)
 * - user_history: Conversation summaries (append-only)
 *
 * Triggered when session tokens exceed threshold
 */

import { createClient } from '@/lib/supabase/server';
import { getAcontextClient } from './acontext/client';
import { createLLMClient, getLLMModel } from './openai-client';
import type { ChatMessage } from './types/acontext';

// ============================================
// Configuration
// ============================================

const CONSOLIDATION_THRESHOLD = 80000; // Trigger when tokens > 80K
const TARGET_TOKENS = 60000; // Target after compression

// ============================================
// Types
// ============================================

interface ConsolidationResult {
  historyEntry: string;
  memoryUpdate: string;
}

interface MemoryContext {
  currentMemory: string;
  conversationSummary: string;
}

// ============================================
// Database Operations
// ============================================

/**
 * Get user's long-term memory content
 */
export async function getUserMemory(userId: string): Promise<string> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('user_memory')
    .select('content')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return '';
  }

  return data.content || '';
}

/**
 * Update user's long-term memory
 */
export async function updateUserMemory(userId: string, content: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('user_memory')
    .upsert({
      user_id: userId,
      content,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    console.error('[MemoryConsolidation] Failed to update user_memory:', error);
    throw error;
  }
}

/**
 * Append a history entry
 */
export async function appendHistory(
  userId: string,
  entry: string,
  conversationId?: string
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.from('user_history').insert({
    user_id: userId,
    conversation_id: conversationId || null,
    entry,
  });

  if (error) {
    console.error('[MemoryConsolidation] Failed to append history:', error);
    throw error;
  }
}

/**
 * Get recent history entries
 */
export async function getRecentHistory(
  userId: string,
  limit: number = 10
): Promise<string[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('user_history')
    .select('entry')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) {
    return [];
  }

  return data.map((item) => item.entry);
}

/**
 * Search history entries
 */
export async function searchHistory(
  userId: string,
  query: string,
  limit: number = 5
): Promise<string[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('user_history')
    .select('entry')
    .eq('user_id', userId)
    .textSearch('entry', query)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) {
    // Fallback to LIKE search if full-text search fails
    const { data: likeData, error: likeError } = await supabase
      .from('user_history')
      .select('entry')
      .eq('user_id', userId)
      .ilike('entry', `%${query}%`)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (likeError || !likeData) {
      return [];
    }

    return likeData.map((item) => item.entry);
  }

  return data.map((item) => item.entry);
}

// ============================================
// LLM Summarization
// ============================================

/**
 * Format messages for summarization
 */
function formatMessagesForSummary(messages: ChatMessage[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    const timestamp = new Date().toISOString().slice(0, 16);
    const tools = msg.tool_calls
      ? ` [tools: ${msg.tool_calls.map((tc) => tc.function.name).join(', ')}]`
      : '';
    const content =
      typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);

    // Truncate long messages
    const truncatedContent =
      content.length > 500 ? content.slice(0, 500) + '...' : content;

    lines.push(`[${timestamp}] ${msg.role.toUpperCase()}${tools}: ${truncatedContent}`);
  }

  return lines.join('\n');
}

/**
 * Call LLM to summarize conversation and update memory
 */
async function summarizeWithLLM(
  messages: ChatMessage[],
  currentMemory: string
): Promise<ConsolidationResult> {
  const client = createLLMClient();
  const model = getLLMModel();

  const conversationText = formatMessagesForSummary(messages);

  const prompt = `You are a memory consolidation agent. Process this conversation and return a JSON object with exactly two keys:

1. "historyEntry": A paragraph (2-5 sentences) summarizing the key events/decisions/topics. Start with a timestamp like [YYYY-MM-DD HH:MM]. Include enough detail to be useful when found by search later.

2. "memoryUpdate": The updated long-term memory content in Markdown format. Add any new facts: user location, preferences, personal info, habits, project context, technical decisions, tools/services used. If nothing new, return the existing content unchanged. Keep it concise and organized.

## Current Long-term Memory
${currentMemory || '(empty)'}

## Conversation to Process
${conversationText}

Respond with ONLY valid JSON, no markdown fences.`;

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are a memory consolidation agent. Respond only with valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    });

    const text = response.choices[0]?.message?.content?.trim() || '';

    // Remove markdown fences if present
    let jsonText = text;
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.split('\n').slice(1).join('\n');
      jsonText = jsonText.split('```')[0].trim();
    }

    const result = JSON.parse(jsonText) as ConsolidationResult;

    return {
      historyEntry: result.historyEntry || '',
      memoryUpdate: result.memoryUpdate || currentMemory,
    };
  } catch (error) {
    console.error('[MemoryConsolidation] LLM summarization failed:', error);
    return {
      historyEntry: '',
      memoryUpdate: currentMemory,
    };
  }
}

// ============================================
// Main Consolidation Function
// ============================================

/**
 * Check if consolidation is needed and perform it
 */
export async function consolidateMemory(
  userId: string,
  sessionId: string,
  conversationId?: string
): Promise<boolean> {
  console.log('[MemoryConsolidation] Checking if consolidation needed...', {
    userId,
    sessionId,
  });

  const acontextClient = getAcontextClient();

  // Check token count
  const tokens = await acontextClient.getTokenCounts(sessionId);

  if (tokens < CONSOLIDATION_THRESHOLD) {
    console.log('[MemoryConsolidation] No consolidation needed', { tokens });
    return false;
  }

  console.log('[MemoryConsolidation] Starting consolidation...', {
    tokens,
    threshold: CONSOLIDATION_THRESHOLD,
  });

  try {
    // Get messages to consolidate (excluding the most recent ones)
    const messages = await acontextClient.getMessages(sessionId);

    if (messages.length < 10) {
      console.log('[MemoryConsolidation] Not enough messages to consolidate');
      return false;
    }

    // Get current memory
    const currentMemory = await getUserMemory(userId);

    // Summarize with LLM
    const result = await summarizeWithLLM(messages, currentMemory);

    // Save to database
    if (result.historyEntry) {
      await appendHistory(userId, result.historyEntry, conversationId);
      console.log('[MemoryConsolidation] History entry saved');
    }

    if (result.memoryUpdate && result.memoryUpdate !== currentMemory) {
      await updateUserMemory(userId, result.memoryUpdate);
      console.log('[MemoryConsolidation] Memory updated');
    }

    // Compress Acontext messages
    await acontextClient.getMessages(sessionId, {
      editStrategies: [
        { type: 'token_limit', params: { limit_tokens: TARGET_TOKENS } },
        {
          type: 'remove_tool_result',
          params: { keep_recent_n_tool_results: 3 },
        },
      ],
    });

    console.log('[MemoryConsolidation] Consolidation complete');
    return true;
  } catch (error) {
    console.error('[MemoryConsolidation] Consolidation failed:', error);
    return false;
  }
}

/**
 * Get memory context for system prompt
 */
export async function getMemoryContext(userId: string): Promise<string> {
  const memory = await getUserMemory(userId);

  if (!memory) {
    return '';
  }

  return `# Long-term Memory

${memory}`;
}

/**
 * Get history context (recent entries) for system prompt
 */
export async function getHistoryContext(
  userId: string,
  limit: number = 5
): Promise<string> {
  const entries = await getRecentHistory(userId, limit);

  if (entries.length === 0) {
    return '';
  }

  return `# Recent History

${entries.reverse().join('\n\n')}`;
}
