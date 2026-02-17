// Acontext Skills Integration
// Uses official SKILL_TOOLS from @acontext/acontext for skill access
// Skills are managed entirely through Acontext - no local storage needed

import { SKILL_TOOLS } from '@acontext/acontext';
import type { SkillContext } from '@acontext/acontext';
import { getAcontextClient } from './client';
import type { ToolDefinition } from '@/lib/types';

// ============================================
// Types
// ============================================

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  file_index?: Array<{
    path: string;
    mime: string;
  }>;
}

export interface SkillCatalogItem {
  name: string;
  description: string;
}

export interface SkillFile {
  path: string;
  content: string;
  mime: string;
  url?: string;
}

// ============================================
// Skill Tool Names
// ============================================

const SKILL_TOOL_NAMES = ['get_skill', 'get_skill_file'] as const;
type SkillToolName = (typeof SKILL_TOOL_NAMES)[number];

export function isSkillToolName(name: string): name is SkillToolName {
  return SKILL_TOOL_NAMES.includes(name as SkillToolName);
}

// ============================================
// Skill Tool Schemas
// ============================================

/**
 * Get skill tool schemas for LLM
 * Uses official SKILL_TOOLS bundle from @acontext/acontext
 */
export function getSkillToolSchemas(): ToolDefinition[] {
  try {
    const schemas = SKILL_TOOLS.toOpenAIToolSchema() as unknown as ToolDefinition[];
    console.log('[SkillTools] Loaded skill tool schemas:', schemas.length);
    return schemas;
  } catch (error) {
    console.warn('[SkillTools] Failed to get SKILL_TOOLS schemas:', error);
    return [];
  }
}

// ============================================
// Skill Context for System Prompt
// ============================================

// Store created contexts for reuse
const skillContextCache = new Map<string, SkillContext>();

/**
 * Create skill context with preloaded skills
 * Call this at the start of a chat session
 */
export async function createSkillContext(
  skillIds: string[]
): Promise<{ skillsContext: string; mountedSkillIds: string[] }> {
  console.log('[SkillTools] Creating skill context with skills:', skillIds);

  if (skillIds.length === 0) {
    return {
      skillsContext: '',
      mountedSkillIds: [],
    };
  }

  try {
    const client = getAcontextClient().getRawClient();

    // formatContext returns Promise<SkillContext>
    const ctx = await SKILL_TOOLS.formatContext(client, skillIds);
    const skillsContext = ctx.getContextPrompt();

    // Cache the context for later tool execution
    const cacheKey = skillIds.sort().join(',');
    skillContextCache.set(cacheKey, ctx);

    console.log('[SkillTools] Skill context created, length:', skillsContext.length);

    return {
      skillsContext,
      mountedSkillIds: skillIds,
    };
  } catch (error) {
    console.error('[SkillTools] Failed to create skill context:', error);
    return {
      skillsContext: '',
      mountedSkillIds: [],
    };
  }
}

/**
 * Get cached skill context for tool execution
 */
export function getSkillContext(skillIds: string[]): SkillContext | null {
  const cacheKey = skillIds.sort().join(',');
  return skillContextCache.get(cacheKey) || null;
}

/**
 * Get skill information
 */
export async function getSkillInfo(skillId: string): Promise<SkillInfo | null> {
  console.log('[SkillTools] Getting skill info:', skillId);

  try {
    const client = getAcontextClient().getRawClient();
    const skill = await client.skills.get(skillId);

    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      file_index: skill.file_index,
    };
  } catch (error) {
    console.error('[SkillTools] Failed to get skill info:', error);
    return null;
  }
}

/**
 * List available skills from catalog
 * Note: catalog items only have name and description (no ID)
 */
export async function listSkillCatalog(): Promise<SkillCatalogItem[]> {
  console.log('[SkillTools] Listing skill catalog');

  try {
    const client = getAcontextClient().getRawClient();
    const catalog = await client.skills.listCatalog();

    return (catalog?.items || []).map((item) => ({
      name: item.name,
      description: item.description,
    }));
  } catch (error) {
    console.error('[SkillTools] Failed to list skill catalog:', error);
    return [];
  }
}

/**
 * Read a file from a skill
 */
export async function getSkillFile(
  skillId: string,
  filePath: string
): Promise<SkillFile | null> {
  console.log('[SkillTools] Getting skill file:', { skillId, filePath });

  try {
    const client = getAcontextClient().getRawClient();
    const result = await client.skills.getFile({
      skillId,
      filePath,
    });

    // Check if we got content or URL
    if (result?.content?.raw) {
      return {
        path: result.path,
        content: result.content.raw,
        mime: result.mime,
      };
    }

    // Binary file - return URL
    if (result?.url) {
      return {
        path: result.path,
        content: '',
        mime: result.mime,
        url: result.url,
      };
    }

    return null;
  } catch (error) {
    console.error('[SkillTools] Failed to get skill file:', error);
    return null;
  }
}

// ============================================
// Tool Execution
// ============================================

/**
 * Execute a skill tool
 * This is called by the tool router when LLM requests skill access
 */
export async function executeSkillTool(
  toolName: string,
  args: Record<string, unknown>,
  skillIds: string[]
): Promise<unknown> {
  console.log('[SkillTools] Executing skill tool:', { toolName, args, skillIds });

  if (skillIds.length === 0) {
    return { error: 'No skills are mounted for this session' };
  }

  try {
    // Try to get cached context first
    let ctx = getSkillContext(skillIds);

    // If not cached, create new context
    if (!ctx) {
      const client = getAcontextClient().getRawClient();
      ctx = await SKILL_TOOLS.formatContext(client, skillIds);
    }

    const result = await SKILL_TOOLS.executeTool(ctx, toolName, args);
    console.log('[SkillTools] Tool execution success:', toolName);

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[SkillTools] Tool execution failed:', errorMessage);
    return { error: errorMessage };
  }
}

// ============================================
// Skills for Sandbox Execution
// ============================================

/**
 * Get skill IDs for sandbox mounting
 * Use this when creating SANDBOX_TOOLS context
 */
export function getSkillsForSandbox(
  skillIds: string[]
): { mount_skills: string[] } {
  if (skillIds.length === 0) {
    return { mount_skills: [] };
  }

  return { mount_skills: skillIds };
}

// ============================================
// Default Skills Configuration
// ============================================

/**
 * Get default skill IDs to mount for all sessions
 * These are "always-loaded" skills that the LLM can access
 */
export function getDefaultSkillIds(): string[] {
  // Get from environment variable or return empty
  const defaultSkills = process.env.ACONTEXT_DEFAULT_SKILLS;
  if (defaultSkills) {
    return defaultSkills
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Check if skills are configured
 */
export function isSkillsConfigured(): boolean {
  return getDefaultSkillIds().length > 0;
}
