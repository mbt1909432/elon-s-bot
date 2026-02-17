/**
 * Spawn Subagent Tool
 * Allows the main agent to create background subagents for long-running tasks
 */

import type { ToolDefinition } from '@/lib/types';

// Tool schema for LLM
export const SPAWN_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'spawn_subagent',
    description:
      'Create a subagent to execute a task in the background. Use this for tasks that may take a long time or can run independently. The subagent will work on the task and report back when complete.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'A clear description of the task for the subagent to execute',
        },
        label: {
          type: 'string',
          description: 'A short label for the task (optional, for identification)',
        },
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high'],
          description: 'Task priority (default: normal)',
        },
      },
      required: ['task'],
    },
  },
};

// Subagent status type
export type SubagentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

// Subagent record from database
export interface SubagentRecord {
  id: string;
  userId: string;
  conversationId?: string;
  task: string;
  label?: string;
  status: SubagentStatus;
  result?: string;
  error?: string;
  progress: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

// Context for spawn execution
export interface SpawnContext {
  userId: string;
  conversationId?: string;
  supabase: {
    from: (table: string) => {
      insert: (data: unknown) => {
        select: () => {
          single: () => Promise<{ data: SubagentRecord | null; error: unknown }>;
        };
      };
    };
  };
  triggerSubagentExecution: (subagentId: string) => Promise<void>;
}

/**
 * Execute the spawn tool - create a subagent record
 */
export async function executeSpawn(
  args: { task: string; label?: string; priority?: string },
  context: SpawnContext
): Promise<{ success: boolean; message: string; subagentId?: string }> {
  const { task, label, priority = 'normal' } = args;

  try {
    // Create subagent record in database
    const { data, error } = await context.supabase
      .from('subagents')
      .insert({
        user_id: context.userId,
        conversation_id: context.conversationId,
        task,
        label: label || task.slice(0, 50),
        status: 'pending',
        progress: 0,
        metadata: {
          priority,
          createdAt: new Date().toISOString(),
        },
      })
      .select()
      .single();

    if (error || !data) {
      console.error('[SpawnTool] Failed to create subagent:', error);
      return {
        success: false,
        message: `Failed to create subagent: ${error || 'Unknown error'}`,
      };
    }

    const subagentId = data.id;

    // Trigger async execution
    try {
      await context.triggerSubagentExecution(subagentId);
    } catch (triggerError) {
      console.error('[SpawnTool] Failed to trigger execution:', triggerError);
      // Don't fail - the subagent can still be picked up by a scheduler
    }

    const shortId = subagentId.slice(0, 8);
    return {
      success: true,
      message: `Subagent started (ID: ${shortId}). It will work on: "${task.slice(0, 100)}${task.length > 100 ? '...' : ''}". I'll notify you when it's done.`,
      subagentId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[SpawnTool] Error:', errorMessage);
    return {
      success: false,
      message: `Error creating subagent: ${errorMessage}`,
    };
  }
}

/**
 * Check if a tool name is the spawn tool
 */
export function isSpawnToolName(name: string): boolean {
  return name === 'spawn_subagent';
}
