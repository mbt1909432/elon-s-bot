/**
 * Cron Jobs API
 * CRUD operations for managing scheduled tasks
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { parseSchedule, type ScheduleType } from '@/lib/tools/cron';

// GET /api/cron - List cron jobs for the current user
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const enabled = searchParams.get('enabled');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    let query = supabase
      .from('cron_jobs')
      .select('*')
      .eq('user_id', user.id)
      .order('next_run_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (enabled !== null) {
      query = query.eq('enabled', enabled === 'true');
    }

    const { data: jobs, error } = await query;

    if (error) {
      console.error('[Cron API] Error fetching jobs:', error);
      return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 });
    }

    return NextResponse.json({ jobs });
  } catch (error) {
    console.error('[Cron API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/cron - Create a new cron job
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, description, schedule, message, channelId, conversationId, maxRuns } = body;

    if (!name || !schedule || !message) {
      return NextResponse.json(
        { error: 'name, schedule, and message are required' },
        { status: 400 }
      );
    }

    // Parse the schedule
    const parsed = parseSchedule(schedule);

    const { data: job, error } = await supabase
      .from('cron_jobs')
      .insert({
        user_id: user.id,
        name,
        description,
        enabled: true,
        schedule_type: parsed.type,
        schedule_expr: parsed.expr,
        message,
        channel_id: channelId,
        conversation_id: conversationId,
        next_run_at: parsed.nextRun.toISOString(),
        max_runs: maxRuns,
        metadata: {
          originalSchedule: schedule,
        },
      })
      .select()
      .single();

    if (error) {
      console.error('[Cron API] Error creating job:', error);
      return NextResponse.json({ error: 'Failed to create job' }, { status: 500 });
    }

    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    console.error('[Cron API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH /api/cron - Update a cron job
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { id, enabled, name, description, schedule, message } = body;

    if (!id) {
      return NextResponse.json({ error: 'Job ID is required' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {};

    if (enabled !== undefined) updateData.enabled = enabled;
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (message !== undefined) updateData.message = message;

    if (schedule !== undefined) {
      const parsed = parseSchedule(schedule);
      updateData.schedule_type = parsed.type;
      updateData.schedule_expr = parsed.expr;
      updateData.next_run_at = parsed.nextRun.toISOString();
      updateData.metadata = { originalSchedule: schedule };
    }

    const { data: job, error } = await supabase
      .from('cron_jobs')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) {
      console.error('[Cron API] Error updating job:', error);
      return NextResponse.json({ error: 'Failed to update job' }, { status: 500 });
    }

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json({ job });
  } catch (error) {
    console.error('[Cron API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/cron - Delete a cron job
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Job ID is required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('cron_jobs')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) {
      console.error('[Cron API] Error deleting job:', error);
      return NextResponse.json({ error: 'Failed to delete job' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Cron API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
