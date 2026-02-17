// Memory API - CRUD operations for user memories

import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import type { Memory, MemoryType } from '@/lib/types';

// GET - List memories or get single memory
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const memoryId = searchParams.get('id');
    const memoryType = searchParams.get('type') as MemoryType | null;
    const key = searchParams.get('key');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const activeOnly = searchParams.get('active_only') !== 'false';

    // Get single memory
    if (memoryId) {
      const { data: memory, error } = await supabase
        .from('memories')
        .select('*')
        .eq('id', memoryId)
        .eq('user_id', user.id)
        .single();

      if (error || !memory) {
        return NextResponse.json({ error: 'Memory not found' }, { status: 404 });
      }

      return NextResponse.json({
        success: true,
        memory,
      });
    }

    // Build query
    let query = supabase
      .from('memories')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id);

    if (activeOnly) {
      query = query.eq('is_active', true);
    }

    if (memoryType) {
      query = query.eq('memory_type', memoryType);
    }

    if (key) {
      query = query.eq('key', key);
    }

    const { data: memories, error, count } = await query
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      memories,
      total: count,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Memory GET error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch memories' },
      { status: 500 }
    );
  }
}

// POST - Create new memory
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      memory_type,
      key,
      value,
      importance,
      source,
      conversation_id,
      metadata,
      expires_at,
    } = body;

    if (!memory_type || !key || !value) {
      return NextResponse.json(
        { error: 'memory_type, key, and value are required' },
        { status: 400 }
      );
    }

    // Check if memory with same key exists
    const { data: existing } = await supabase
      .from('memories')
      .select('id')
      .eq('user_id', user.id)
      .eq('key', key)
      .eq('is_active', true)
      .single();

    if (existing) {
      // Update existing memory
      const { data: memory, error } = await supabase
        .from('memories')
        .update({
          value,
          memory_type,
          importance: importance || 5,
          source,
          metadata,
          expires_at,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) {
        throw error;
      }

      return NextResponse.json({
        success: true,
        memory,
        action: 'updated',
      });
    }

    // Create new memory
    const { data: memory, error } = await supabase
      .from('memories')
      .insert({
        user_id: user.id,
        memory_type,
        key,
        value,
        importance: importance || 5,
        source,
        conversation_id,
        metadata,
        expires_at,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      memory,
      action: 'created',
    });
  } catch (error) {
    console.error('Memory POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create memory' },
      { status: 500 }
    );
  }
}

// PATCH - Update memory
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { id, value, importance, is_active, metadata, expires_at } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const updateData: Partial<Memory> = {};
    if (value !== undefined) updateData.value = value;
    if (importance !== undefined) updateData.importance = importance;
    if (is_active !== undefined) updateData.is_active = is_active;
    if (metadata !== undefined) updateData.metadata = metadata;
    if (expires_at !== undefined) updateData.expires_at = expires_at;

    const { data: memory, error } = await supabase
      .from('memories')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error || !memory) {
      return NextResponse.json({ error: 'Failed to update memory' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      memory,
    });
  } catch (error) {
    console.error('Memory PATCH error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update memory' },
      { status: 500 }
    );
  }
}

// DELETE - Delete memory
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const memoryId = searchParams.get('id');
    const key = searchParams.get('key');
    const softDelete = searchParams.get('soft') !== 'false';

    if (!memoryId && !key) {
      return NextResponse.json({ error: 'id or key is required' }, { status: 400 });
    }

    if (softDelete) {
      // Soft delete - mark as inactive
      let query = supabase
        .from('memories')
        .update({ is_active: false })
        .eq('user_id', user.id);

      if (memoryId) {
        query = query.eq('id', memoryId);
      } else if (key) {
        query = query.eq('key', key);
      }

      const { error } = await query;

      if (error) {
        throw error;
      }
    } else {
      // Hard delete
      let query = supabase
        .from('memories')
        .delete()
        .eq('user_id', user.id);

      if (memoryId) {
        query = query.eq('id', memoryId);
      } else if (key) {
        query = query.eq('key', key);
      }

      const { error } = await query;

      if (error) {
        throw error;
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Memory deleted',
    });
  } catch (error) {
    console.error('Memory DELETE error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete memory' },
      { status: 500 }
    );
  }
}
