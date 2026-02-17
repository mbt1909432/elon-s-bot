/**
 * Subagents API
 * CRUD operations for managing background subagents
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/subagents - List subagents for the current user
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
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    let query = supabase
      .from('subagents')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: subagents, error } = await query;

    if (error) {
      console.error('[Subagents API] Error fetching subagents:', error);
      return NextResponse.json({ error: 'Failed to fetch subagents' }, { status: 500 });
    }

    return NextResponse.json({ subagents });
  } catch (error) {
    console.error('[Subagents API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/subagents - Create a new subagent
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
    const { task, label, conversationId, priority = 'normal' } = body;

    if (!task) {
      return NextResponse.json({ error: 'Task is required' }, { status: 400 });
    }

    const { data: subagent, error } = await supabase
      .from('subagents')
      .insert({
        user_id: user.id,
        conversation_id: conversationId,
        task,
        label: label || task.slice(0, 50),
        status: 'pending',
        progress: 0,
        metadata: { priority },
      })
      .select()
      .single();

    if (error) {
      console.error('[Subagents API] Error creating subagent:', error);
      return NextResponse.json({ error: 'Failed to create subagent' }, { status: 500 });
    }

    // Trigger async execution via Edge Function
    triggerSubagentExecution(subagent.id).catch(err => {
      console.error('[Subagents API] Failed to trigger execution:', err);
    });

    return NextResponse.json({ subagent }, { status: 201 });
  } catch (error) {
    console.error('[Subagents API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH /api/subagents - Update a subagent (for status updates)
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
    const { id, status, result, error: subagentError, progress } = body;

    if (!id) {
      return NextResponse.json({ error: 'Subagent ID is required' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {};

    if (status) updateData.status = status;
    if (result !== undefined) updateData.result = result;
    if (subagentError !== undefined) updateData.error = subagentError;
    if (progress !== undefined) updateData.progress = progress;

    if (status === 'running') {
      updateData.started_at = new Date().toISOString();
    } else if (status === 'completed' || status === 'failed') {
      updateData.completed_at = new Date().toISOString();
    }

    const { data: subagent, error } = await supabase
      .from('subagents')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) {
      console.error('[Subagents API] Error updating subagent:', error);
      return NextResponse.json({ error: 'Failed to update subagent' }, { status: 500 });
    }

    if (!subagent) {
      return NextResponse.json({ error: 'Subagent not found' }, { status: 404 });
    }

    return NextResponse.json({ subagent });
  } catch (error) {
    console.error('[Subagents API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/subagents - Cancel/delete a subagent
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
      return NextResponse.json({ error: 'Subagent ID is required' }, { status: 400 });
    }

    // Cancel (set status to cancelled) instead of deleting
    const { error } = await supabase
      .from('subagents')
      .update({ status: 'cancelled', completed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) {
      console.error('[Subagents API] Error cancelling subagent:', error);
      return NextResponse.json({ error: 'Failed to cancel subagent' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Subagents API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Trigger subagent execution via Edge Function
 */
async function triggerSubagentExecution(subagentId: string): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.warn('[Subagents API] Missing Supabase config, skipping trigger');
    return;
  }

  await fetch(`${supabaseUrl}/functions/v1/subagent-exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ subagentId }),
  });
}
