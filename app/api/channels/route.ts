/**
 * Channels API
 * CRUD operations for managing channel connections
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/channels - List channels for the current user
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

    const { data: channels, error } = await supabase
      .from('channels')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Channels API] Error fetching channels:', error);
      return NextResponse.json({ error: 'Failed to fetch channels' }, { status: 500 });
    }

    return NextResponse.json({ channels: channels || [] });
  } catch (error) {
    console.error('[Channels API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/channels - Create a new channel connection
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
    const { platform, config, platformChatId, conversationId } = body;

    if (!platform) {
      return NextResponse.json({ error: 'Platform is required' }, { status: 400 });
    }

    // Create channel record
    const { data: channel, error } = await supabase
      .from('channels')
      .upsert({
        user_id: user.id,
        platform,
        platform_user_id: user.id, // Will be updated when first message arrives
        platform_chat_id: platformChatId || user.id,
        config: config || {},
        conversation_id: conversationId,
        enabled: true,
      })
      .select()
      .single();

    if (error) {
      console.error('[Channels API] Error creating channel:', error);
      return NextResponse.json({ error: 'Failed to create channel' }, { status: 500 });
    }

    // Set webhook for Telegram
    if (platform === 'telegram' && config?.telegramBotToken) {
      const webhookUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/channels-telegram`;
      try {
        await fetch(
          `https://api.telegram.org/bot${config.telegramBotToken}/setWebhook`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: webhookUrl }),
          }
        );
      } catch (webhookError) {
        console.error('[Channels API] Failed to set Telegram webhook:', webhookError);
      }
    }

    return NextResponse.json({ channel }, { status: 201 });
  } catch (error) {
    console.error('[Channels API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/channels - Delete a channel
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
      return NextResponse.json({ error: 'Channel ID is required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('channels')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) {
      console.error('[Channels API] Error deleting channel:', error);
      return NextResponse.json({ error: 'Failed to delete channel' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Channels API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
