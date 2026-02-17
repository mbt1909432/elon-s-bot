/**
 * Cron Tool
 * Allows scheduling tasks to be executed at specific times
 */

import type { ToolDefinition } from '@/lib/types';

// Tool schema for LLM
export const CRON_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'schedule_task',
    description:
      'Schedule a task to be executed at a specific time or interval. Use this for reminders, recurring tasks, or delayed actions.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'A descriptive name for the scheduled task',
        },
        description: {
          type: 'string',
          description: 'Detailed description of what the task should do',
        },
        schedule: {
          type: 'string',
          description:
            'When to execute the task. Can be:\n' +
            '- Cron expression (e.g., "0 9 * * *" for daily at 9am)\n' +
            '- Natural language (e.g., "tomorrow at 9am", "every hour", "in 30 minutes")\n' +
            '- ISO date string (e.g., "2024-12-25T09:00:00Z")',
        },
        message: {
          type: 'string',
          description: 'The message or prompt to execute when the task runs',
        },
        channel: {
          type: 'string',
          description: 'Optional platform to send the result to (telegram, discord, feishu)',
        },
        recurring: {
          type: 'boolean',
          description: 'Whether this is a recurring task (default: false)',
        },
      },
      required: ['name', 'schedule', 'message'],
    },
  },
};

// Schedule type
export type ScheduleType = 'cron' | 'interval' | 'once';

// Cron job record from database
export interface CronJobRecord {
  id: string;
  userId: string;
  name: string;
  description?: string;
  enabled: boolean;
  scheduleType: ScheduleType;
  scheduleExpr: string;
  message: string;
  channelId?: string;
  conversationId?: string;
  lastRunAt?: Date;
  nextRunAt?: Date;
  lastStatus?: 'success' | 'failed' | 'skipped';
  lastResult?: string;
  runCount: number;
  maxRuns?: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// Context for cron execution
export interface CronContext {
  userId: string;
  conversationId?: string;
  channelId?: string;
  supabase: {
    from: (table: string) => {
      insert: (data: unknown) => {
        select: () => {
          single: () => Promise<{ data: CronJobRecord | null; error: unknown }>;
        };
      };
    };
  };
}

/**
 * Parse natural language schedule into cron expression
 */
export function parseSchedule(schedule: string): {
  type: ScheduleType;
  expr: string;
  nextRun: Date;
} {
  const now = new Date();
  const lower = schedule.toLowerCase().trim();

  // Try to parse as ISO date first
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(schedule)) {
    const date = new Date(schedule);
    if (!isNaN(date.getTime())) {
      return {
        type: 'once',
        expr: schedule,
        nextRun: date,
      };
    }
  }

  // Check for cron expression (5 parts)
  const cronParts = schedule.split(/\s+/);
  if (cronParts.length === 5 && /^[\d*/,-]+$/.test(cronParts[0])) {
    return {
      type: 'cron',
      expr: schedule,
      nextRun: calculateNextCronRun(schedule, now),
    };
  }

  // Natural language parsing
  if (lower.includes('every')) {
    // Interval patterns
    const minuteMatch = lower.match(/every\s+(\d+)?\s*minutes?/);
    if (minuteMatch) {
      const mins = minuteMatch[1] ? parseInt(minuteMatch[1]) : 1;
      return {
        type: 'interval',
        expr: `${mins}m`,
        nextRun: new Date(now.getTime() + mins * 60 * 1000),
      };
    }

    const hourMatch = lower.match(/every\s+(\d+)?\s*hours?/);
    if (hourMatch) {
      const hours = hourMatch[1] ? parseInt(hourMatch[1]) : 1;
      return {
        type: 'interval',
        expr: `${hours}h`,
        nextRun: new Date(now.getTime() + hours * 60 * 60 * 1000),
      };
    }

    const dayMatch = lower.match(/every\s+(\d+)?\s*days?/);
    if (dayMatch) {
      const days = dayMatch[1] ? parseInt(dayMatch[1]) : 1;
      return {
        type: 'interval',
        expr: `${days}d`,
        nextRun: new Date(now.getTime() + days * 24 * 60 * 60 * 1000),
      };
    }

    const weekMatch = lower.match(/every\s+(\d+)?\s*weeks?/);
    if (weekMatch) {
      const weeks = weekMatch[1] ? parseInt(weekMatch[1]) : 1;
      return {
        type: 'interval',
        expr: `${weeks}w`,
        nextRun: new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000),
      };
    }
  }

  // Relative time patterns
  const inMatch = lower.match(/in\s+(\d+)\s*(minutes?|hours?|days?|weeks?)/);
  if (inMatch) {
    const amount = parseInt(inMatch[1]);
    const unit = inMatch[2];

    let ms = 0;
    if (unit.startsWith('minute')) ms = amount * 60 * 1000;
    else if (unit.startsWith('hour')) ms = amount * 60 * 60 * 1000;
    else if (unit.startsWith('day')) ms = amount * 24 * 60 * 60 * 1000;
    else if (unit.startsWith('week')) ms = amount * 7 * 24 * 60 * 60 * 1000;

    return {
      type: 'once',
      expr: new Date(now.getTime() + ms).toISOString(),
      nextRun: new Date(now.getTime() + ms),
    };
  }

  // Tomorrow pattern
  if (lower.includes('tomorrow')) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Try to extract time
    const timeMatch = lower.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;

      if (timeMatch[3]?.toLowerCase() === 'pm' && hours < 12) hours += 12;
      if (timeMatch[3]?.toLowerCase() === 'am' && hours === 12) hours = 0;

      tomorrow.setHours(hours, minutes, 0, 0);
    } else {
      tomorrow.setHours(9, 0, 0, 0); // Default to 9am
    }

    return {
      type: 'once',
      expr: tomorrow.toISOString(),
      nextRun: tomorrow,
    };
  }

  // Default: treat as cron expression
  return {
    type: 'cron',
    expr: schedule,
    nextRun: calculateNextCronRun(schedule, now),
  };
}

/**
 * Calculate next run time from cron expression (simplified)
 */
function calculateNextCronRun(cronExpr: string, from: Date): Date {
  // This is a simplified implementation
  // For production, use a proper cron parser library

  const parts = cronExpr.split(/\s+/);
  if (parts.length !== 5) {
    // Default to 1 hour from now
    return new Date(from.getTime() + 60 * 60 * 1000);
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  const next = new Date(from);
  next.setSeconds(0);
  next.setMilliseconds(0);

  // Simple handling for common patterns
  if (minute === '*' && hour === '*') {
    // Every minute
    next.setMinutes(next.getMinutes() + 1);
  } else if (minute !== '*' && hour === '*') {
    // Every hour at specific minute
    next.setMinutes(parseInt(minute));
    if (next <= from) {
      next.setHours(next.getHours() + 1);
    }
  } else if (minute !== '*' && hour !== '*') {
    // Daily at specific time
    next.setMinutes(parseInt(minute));
    next.setHours(parseInt(hour));
    if (next <= from) {
      next.setDate(next.getDate() + 1);
    }
  } else {
    // Default to 1 hour from now
    next.setHours(next.getHours() + 1);
  }

  return next;
}

/**
 * Execute the schedule tool - create a cron job
 */
export async function executeSchedule(
  args: {
    name: string;
    description?: string;
    schedule: string;
    message: string;
    channel?: string;
    recurring?: boolean;
  },
  context: CronContext
): Promise<{ success: boolean; message: string; jobId?: string; nextRun?: Date }> {
  const { name, description, schedule, message, channel, recurring } = args;

  try {
    // Parse the schedule
    const parsed = parseSchedule(schedule);

    // Create cron job record
    const { data, error } = await context.supabase
      .from('cron_jobs')
      .insert({
        user_id: context.userId,
        name,
        description,
        enabled: true,
        schedule_type: parsed.type,
        schedule_expr: parsed.expr,
        message,
        channel_id: context.channelId,
        conversation_id: context.conversationId,
        next_run_at: parsed.nextRun.toISOString(),
        metadata: {
          originalSchedule: schedule,
          recurring: recurring ?? parsed.type !== 'once',
        },
      })
      .select()
      .single();

    if (error || !data) {
      console.error('[CronTool] Failed to create job:', error);
      return {
        success: false,
        message: `Failed to create scheduled task: ${error || 'Unknown error'}`,
      };
    }

    const shortId = data.id.slice(0, 8);
    const timeStr = formatNextRun(parsed.nextRun);

    return {
      success: true,
      message: `Task "${name}" scheduled! It will run ${timeStr}.`,
      jobId: data.id,
      nextRun: parsed.nextRun,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[CronTool] Error:', errorMessage);
    return {
      success: false,
      message: `Error creating scheduled task: ${errorMessage}`,
    };
  }
}

/**
 * Format next run time in human-readable format
 */
function formatNextRun(date: Date): string {
  const now = new Date();
  const diff = date.getTime() - now.getTime();

  if (diff < 0) return 'in the past';

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'very soon';
  if (minutes < 60) return `in ${minutes} minute${minutes > 1 ? 's' : ''}`;
  if (hours < 24) return `in ${hours} hour${hours > 1 ? 's' : ''}`;
  if (days < 7) return `in ${days} day${days > 1 ? 's' : ''}`;

  return `on ${date.toLocaleDateString()} at ${date.toLocaleTimeString()}`;
}

/**
 * Check if a tool name is the cron tool
 */
export function isCronToolName(name: string): boolean {
  return name === 'schedule_task';
}
