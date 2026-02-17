// Acontext Artifacts API - Access files from disk

import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { getAcontextClient } from '@/lib/acontext/client';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const diskId = searchParams.get('disk_id');
    const path = searchParams.get('path');
    const action = searchParams.get('action') || 'read'; // read, list, url

    if (!diskId) {
      return NextResponse.json({ error: 'disk_id is required' }, { status: 400 });
    }

    // Verify user owns this disk through conversation
    const { data: conversation } = await supabase
      .from('conversations')
      .select('id')
      .eq('acontext_disk_id', diskId)
      .eq('user_id', user.id)
      .single();

    if (!conversation) {
      return NextResponse.json({ error: 'Disk not found or access denied' }, { status: 404 });
    }

    const acontextClient = getAcontextClient();

    switch (action) {
      case 'list': {
        const files = await acontextClient.listFiles(diskId, path || '/');
        return NextResponse.json({
          success: true,
          files,
        });
      }

      case 'url': {
        if (!path) {
          return NextResponse.json({ error: 'path is required for url action' }, { status: 400 });
        }
        const url = await acontextClient.getFileUrl(diskId, path);
        if (!url) {
          return NextResponse.json({ error: 'Failed to get file URL' }, { status: 500 });
        }
        return NextResponse.json({
          success: true,
          url,
        });
      }

      case 'read':
      default: {
        if (!path) {
          return NextResponse.json({ error: 'path is required for read action' }, { status: 400 });
        }
        const content = await acontextClient.readFile(diskId, path);
        if (content === null) {
          return NextResponse.json({ error: 'File not found' }, { status: 404 });
        }
        return NextResponse.json({
          success: true,
          path,
          content,
        });
      }
    }
  } catch (error) {
    console.error('Artifacts API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to access artifact' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { disk_id, path, content, mime_type } = body;

    if (!disk_id || !path || content === undefined) {
      return NextResponse.json(
        { error: 'disk_id, path, and content are required' },
        { status: 400 }
      );
    }

    // Verify user owns this disk through conversation
    const { data: conversation } = await supabase
      .from('conversations')
      .select('id')
      .eq('acontext_disk_id', disk_id)
      .eq('user_id', user.id)
      .single();

    if (!conversation) {
      return NextResponse.json({ error: 'Disk not found or access denied' }, { status: 404 });
    }

    const acontextClient = getAcontextClient();
    const success = await acontextClient.writeFile(disk_id, path, content, mime_type);

    return NextResponse.json({
      success,
      path,
      bytes_written: content.length,
    });
  } catch (error) {
    console.error('Artifacts write error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to write artifact' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const diskId = searchParams.get('disk_id');
    const path = searchParams.get('path');

    if (!diskId || !path) {
      return NextResponse.json({ error: 'disk_id and path are required' }, { status: 400 });
    }

    // Verify user owns this disk through conversation
    const { data: conversation } = await supabase
      .from('conversations')
      .select('id')
      .eq('acontext_disk_id', diskId)
      .eq('user_id', user.id)
      .single();

    if (!conversation) {
      return NextResponse.json({ error: 'Disk not found or access denied' }, { status: 404 });
    }

    const acontextClient = getAcontextClient();
    const success = await acontextClient.deleteFile(diskId, path);

    return NextResponse.json({
      success,
      path,
    });
  } catch (error) {
    console.error('Artifacts delete error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete artifact' },
      { status: 500 }
    );
  }
}
