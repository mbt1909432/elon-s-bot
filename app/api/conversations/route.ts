// Conversations API - CRUD operations
// Messages are stored in Acontext, not Supabase

import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { getAcontextClient } from '@/lib/acontext/client';
import { loadChatHistory } from '@/lib/chat-session';
import type { Conversation } from '@/lib/types';
import type { ChatMessage } from '@/lib/types/acontext';

// ============================================
// GET - List conversations or get single conversation
// ============================================
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('id');
    const includeMessages = searchParams.get('include_messages') === 'true';
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Get single conversation
    if (conversationId) {
      const { data: conversation, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .eq('user_id', user.id)
        .single();

      if (error || !conversation) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
      }

      // Load messages from Acontext if requested
      let messages: ChatMessage[] = [];
      if (includeMessages && conversation.acontext_session_id) {
        try {
          messages = await loadChatHistory(conversation.acontext_session_id);
        } catch (error) {
          console.error('Failed to load messages from Acontext:', error);
          // Return empty messages on error
        }
      }

      return NextResponse.json({
        success: true,
        conversation,
        messages,
      });
    }

    // List conversations
    const { data: conversations, error, count } = await supabase
      .from('conversations')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      conversations,
      total: count,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Conversations GET error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch conversations' },
      { status: 500 }
    );
  }
}

// ============================================
// POST - Create new conversation
// ============================================
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { title, model, system_prompt, metadata } = body;

    // Create Acontext session with disk (1:1:1 binding)
    const acontextClient = getAcontextClient();
    const { sessionId, diskId } = await acontextClient.createSessionWithDisk(user.email || user.id);

    console.log('[Conversations] Created session with disk:', { sessionId, diskId });

    const { data: conversation, error } = await supabase
      .from('conversations')
      .insert({
        user_id: user.id,
        title: title || 'New Conversation',
        model,
        system_prompt,
        metadata,
        acontext_session_id: sessionId,
        acontext_disk_id: diskId,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      conversation,
    });
  } catch (error) {
    console.error('Conversation POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create conversation' },
      { status: 500 }
    );
  }
}

// ============================================
// PATCH - Update conversation
// ============================================
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { id, title, model, system_prompt, metadata } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const updateData: Partial<Conversation> = {};
    if (title !== undefined) updateData.title = title;
    if (model !== undefined) updateData.model = model;
    if (system_prompt !== undefined) updateData.system_prompt = system_prompt;
    if (metadata !== undefined) updateData.metadata = metadata;

    const { data: conversation, error } = await supabase
      .from('conversations')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error || !conversation) {
      return NextResponse.json({ error: 'Failed to update conversation' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      conversation,
    });
  } catch (error) {
    console.error('Conversation PATCH error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update conversation' },
      { status: 500 }
    );
  }
}

// ============================================
// DELETE - Delete conversation
// ============================================
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('id');

    if (!conversationId) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    // Get conversation to retrieve session/disk IDs (optional cleanup)
    const { data: conversation } = await supabase
      .from('conversations')
      .select('acontext_session_id, acontext_disk_id')
      .eq('id', conversationId)
      .eq('user_id', user.id)
      .single();

    // Delete from Supabase
    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', conversationId)
      .eq('user_id', user.id);

    if (error) {
      throw error;
    }

    // Note: Acontext session/disk cleanup would happen here if the SDK supports it
    // For now, we just delete the Supabase record

    return NextResponse.json({
      success: true,
      message: 'Conversation deleted',
    });
  } catch (error) {
    console.error('Conversation DELETE error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete conversation' },
      { status: 500 }
    );
  }
}
