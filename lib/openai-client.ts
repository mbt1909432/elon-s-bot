// OpenAI Client and Tool Routing
// Uses official @acontext/acontext SDK tool bundles

import OpenAI from 'openai';
import { DISK_TOOLS } from '@acontext/acontext';
import { getLLMConfig, DEFAULT_SYSTEM_PROMPT } from '@/lib/acontext/config';
import { getAcontextClient } from './acontext/client';
import { executeWebSearch, WEB_SEARCH_TOOL, isSearchAvailable } from './tools/web-search';
import { SPAWN_TOOL, isSpawnToolName, executeSpawn, type SpawnContext } from './tools/spawn';
import { CRON_TOOL, isCronToolName, executeSchedule, type CronContext } from './tools/cron';
import { executeSandboxTool, SANDBOX_TOOL_NAME, getSandboxToolSchema, isSandboxToolName } from './acontext/sandbox-tool';
import {
  getSkillToolSchemas,
  executeSkillTool,
  isSkillToolName,
  getDefaultSkillIds,
} from './acontext/skill-tools';
import type { ChatMessage, ToolExecutionContext } from './types/acontext';
import type { ToolDefinition } from './types';

// ============================================
// LLM Client Creation
// ============================================

export function createLLMClient(): OpenAI {
  const config = getLLMConfig();
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.endpoint,
  });
}

export function getLLMModel(): string {
  return getLLMConfig().model;
}

export function getDefaultSystemPrompt(): string {
  return DEFAULT_SYSTEM_PROMPT;
}

// ============================================
// Disk Tool Names (from official SDK)
// ============================================

const DISK_TOOL_NAMES = [
  'write_file_disk',
  'read_file_disk',
  'replace_string_disk',
  'list_disk',
  'download_file_disk',
  'grep_disk',
  'glob_disk',
] as const;

type DiskToolName = (typeof DISK_TOOL_NAMES)[number];

function isDiskToolName(name: string): name is DiskToolName {
  return DISK_TOOL_NAMES.includes(name as DiskToolName);
}

// ============================================
// Tool Schemas
// ============================================

/**
 * Get all tool schemas for LLM
 * Uses official DISK_TOOLS and SKILL_TOOLS bundles from @acontext/acontext
 */
export function getAllToolSchemas(): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  // Get official disk tool schemas
  try {
    const diskSchemas = DISK_TOOLS.toOpenAIToolSchema() as unknown as ToolDefinition[];
    tools.push(...diskSchemas);
  } catch (error) {
    console.warn('[OpenAIClient] Failed to get DISK_TOOLS schemas:', error);
  }

  // Add sandbox tool for Python execution
  tools.push(getSandboxToolSchema());

  // Add web search if configured
  if (isSearchAvailable()) {
    tools.push(WEB_SEARCH_TOOL);
  }

  // Add spawn tool for background subagents
  tools.push(SPAWN_TOOL);

  // Add cron tool for scheduled tasks
  tools.push(CRON_TOOL);

  // Add skill tools if skills are configured
  const skillSchemas = getSkillToolSchemas();
  if (skillSchemas.length > 0) {
    tools.push(...skillSchemas);
  }

  return tools;
}

// ============================================
// Tool Execution
// ============================================

/**
 * Execute a disk tool using official SDK
 */
async function executeDiskTool(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<unknown> {
  const { acontextClient, diskId } = context;

  if (!diskId) {
    return { error: 'No disk available for this conversation' };
  }

  try {
    // Use official DISK_TOOLS.formatContext and executeTool
    const ctx = DISK_TOOLS.formatContext(
      acontextClient.getRawClient(),
      diskId
    );

    console.debug(`[DiskTools] Executing: ${toolName}`, { args, diskId });
    const result = await DISK_TOOLS.executeTool(ctx, toolName, args);
    console.debug(`[DiskTools] Success: ${toolName}`);

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[DiskTools] Error executing ${toolName}:`, errorMessage);

    // Provide user-friendly error for common issues
    if (toolName === 'download_file_disk' && errorMessage.includes('not found')) {
      return `File not found. Use list_disk to see available files.`;
    }

    return { error: errorMessage };
  }
}

/**
 * Execute a tool call
 */
export async function executeTool(
  toolCall: { id: string; function: { name: string; arguments: string } },
  context: ToolExecutionContext
): Promise<{ success: boolean; output: unknown; error?: string }> {
  const toolName = toolCall.function.name;
  let args: Record<string, unknown>;

  try {
    args = JSON.parse(toolCall.function.arguments || '{}');
  } catch {
    return { success: false, output: null, error: 'Invalid tool arguments' };
  }

  console.log('[OpenAIClient] Executing tool:', { toolName, args });

  try {
    let result: unknown;

    // Disk tools - use official SDK
    if (isDiskToolName(toolName)) {
      result = await executeDiskTool(toolName, args, context);
    }
    // Sandbox tool (Python execution)
    else if (isSandboxToolName(toolName)) {
      result = await executeSandboxTool(args, {
        acontextClient: context.acontextClient,
        diskId: context.diskId!,
        skillIds: context.skillIds,
      });
    }
    // Skill tools - read from mounted skills
    else if (isSkillToolName(toolName)) {
      const skillIds = context.skillIds || getDefaultSkillIds();
      result = await executeSkillTool(toolName, args, skillIds);
    }
    // Web search
    else if (toolName === 'web_search') {
      result = await executeWebSearch(args);
    }
    // Spawn subagent
    else if (isSpawnToolName(toolName)) {
      // Create spawn context from tool execution context
      const spawnContext: SpawnContext = {
        userId: context.userId || '',
        conversationId: context.conversationId,
        supabase: context.supabase,
        triggerSubagentExecution: async (subagentId: string) => {
          // Trigger the Edge Function
          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
          const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
          if (supabaseUrl && serviceKey) {
            await fetch(`${supabaseUrl}/functions/v1/subagent-exec`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({ subagentId }),
            }).catch(err => console.error('Failed to trigger subagent:', err));
          }
        },
      };
      const spawnResult = await executeSpawn(args as { task: string; label?: string; priority?: string }, spawnContext);
      result = spawnResult.message;
    }
    // Schedule task (cron)
    else if (isCronToolName(toolName)) {
      // Create cron context from tool execution context
      const cronContext: CronContext = {
        userId: context.userId || '',
        conversationId: context.conversationId,
        supabase: context.supabase,
      };
      const cronResult = await executeSchedule(args as {
        name: string;
        description?: string;
        schedule: string;
        message: string;
        channel?: string;
        recurring?: boolean;
      }, cronContext);
      result = cronResult.message;
    }
    else {
      return { success: false, output: null, error: `Unknown tool: ${toolName}` };
    }

    // Check if result indicates an error
    if (result && typeof result === 'object' && 'error' in result) {
      return {
        success: false,
        output: result,
        error: (result as { error: string }).error,
      };
    }

    return { success: true, output: result };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[OpenAIClient] Tool execution failed:', errorMessage);
    return { success: false, output: null, error: errorMessage };
  }
}

// ============================================
// Message Formatting
// ============================================

/**
 * Convert ChatMessage array to OpenAI format
 */
export function toOpenAIMessages(
  messages: ChatMessage[],
  systemPrompt?: string
): OpenAI.ChatCompletionMessageParam[] {
  const result: OpenAI.ChatCompletionMessageParam[] = [];

  // Add system prompt
  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }

  // Add conversation messages
  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : null;

    switch (msg.role) {
      case 'user':
        // Support Vision API format (content as array)
        if (Array.isArray(msg.content)) {
          result.push({
            role: 'user',
            content: msg.content as OpenAI.Chat.Completions.ChatCompletionContentPart[],
          });
        } else {
          result.push({ role: 'user', content: content || '' });
        }
        break;

      case 'assistant':
        result.push({
          role: 'assistant',
          content,
          ...(msg.tool_calls && msg.tool_calls.length > 0 && {
            tool_calls: msg.tool_calls.map(tc => ({
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments,
              },
            })),
          }),
        });
        break;

      case 'tool':
        result.push({
          role: 'tool',
          tool_call_id: msg.tool_call_id || '',
          content: content || '',
        });
        break;

      case 'system':
        // Skip system messages from history (we add our own)
        break;
    }
  }

  return result;
}

// ============================================
// Tool Execution Logging
// ============================================

import { createClient } from '@/lib/supabase/server';

/**
 * Log tool execution to Supabase (fire and forget)
 */
export function logToolExecution(
  conversationId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolOutput: unknown,
  status: 'success' | 'error',
  executionTimeMs: number,
  errorMessage?: string
): void {
  void (async () => {
    try {
      const supabase = await createClient();
      await supabase.from('tool_executions').insert({
        conversation_id: conversationId,
        message_id: null, // No longer linked to messages table
        tool_name: toolName,
        tool_input: toolInput,
        tool_output: toolOutput as Record<string, unknown>,
        status,
        error_message: errorMessage,
        execution_time_ms: executionTimeMs,
      });
    } catch (error) {
      console.error('[OpenAIClient] Failed to log tool execution:', error);
    }
  })();
}
