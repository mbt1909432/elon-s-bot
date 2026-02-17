// Skills API - Browse and manage Acontext Skills
// Uses Acontext Skills API for skill management

import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import {
  listSkillCatalog,
  getSkillInfo,
  getSkillFile,
} from '@/lib/acontext/skill-tools';

// ============================================
// GET /api/skills - List skill catalog
// Query params:
//   - skillId: Get specific skill info
//   - filePath: Get file from skill (requires skillId)
// ============================================

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const skillId = searchParams.get('skillId');
  const filePath = searchParams.get('filePath');

  // Authenticate user
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get specific skill info
    if (skillId) {
      // Get file from skill
      if (filePath) {
        const file = await getSkillFile(skillId, filePath);
        if (!file) {
          return NextResponse.json({ error: 'File not found' }, { status: 404 });
        }
        return NextResponse.json({ file });
      }

      // Get skill metadata
      const skill = await getSkillInfo(skillId);
      if (!skill) {
        return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
      }
      return NextResponse.json({ skill });
    }

    // List catalog
    const skills = await listSkillCatalog();
    return NextResponse.json({ skills });
  } catch (error) {
    console.error('[SkillsAPI] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch skills' },
      { status: 500 }
    );
  }
}
