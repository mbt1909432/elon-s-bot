// Artifacts Public URL API
// Resolves disk:: URLs to public URLs for displaying images and files

import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { getAcontextClient } from '@/lib/acontext/client';

// Mark as dynamic to prevent prerendering
export const dynamic = 'force-dynamic';

// ============================================
// GET - Get public URL for a disk artifact
// ============================================
export async function GET(request: NextRequest) {
  try {
    // Authenticate user
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('filePath');
    const diskId = searchParams.get('diskId');

    if (!filePath || !diskId) {
      return NextResponse.json(
        { error: 'filePath and diskId are required' },
        { status: 400 }
      );
    }

    // Verify user has access to this disk (through conversation ownership)
    const { data: conversation, error } = await supabase
      .from('conversations')
      .select('id')
      .eq('acontext_disk_id', diskId)
      .eq('user_id', user.id)
      .single();

    if (error || !conversation) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }

    // Get public URL from Acontext
    const acontextClient = getAcontextClient();
    const artifactInfo = await acontextClient.getArtifactInfo(diskId, filePath);

    if (!artifactInfo || !artifactInfo.public_url) {
      return NextResponse.json(
        { error: 'Failed to get public URL for file' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      url: artifactInfo.public_url,
      path: filePath,
      mimeType: artifactInfo.mime_type,
      size: artifactInfo.size,
    });
  } catch (error) {
    console.error('Artifacts public URL error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get public URL' },
      { status: 500 }
    );
  }
}
