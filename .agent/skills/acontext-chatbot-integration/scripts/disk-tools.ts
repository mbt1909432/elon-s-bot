/**
 * Acontext Disk Tools - OpenAI-compatible function schemas and execution
 * Provides file system operations through Acontext's DISK_TOOLS
 *
 * Dependencies: @acontext/acontext
 * Copy to your project and adjust as needed.
 */

import OpenAI from "openai";
import { DISK_TOOLS } from "@acontext/acontext";
import type { AcontextClientLike, ToolExecutionContext } from "./types";

// ============ Tool Names ============

/**
 * All available disk tool names from Acontext SDK
 */
export const DISK_TOOL_NAMES = [
  "write_file_disk",
  "read_file_disk",
  "replace_string_disk",
  "list_disk",
  "download_file_disk",
  "grep_disk",
  "glob_disk",
] as const;

export type DiskToolName = (typeof DISK_TOOL_NAMES)[number];

/**
 * Check if a tool name is a disk tool
 */
export function isDiskToolName(name: string): name is DiskToolName {
  return DISK_TOOL_NAMES.includes(name as DiskToolName);
}

// ============ Tool Schemas ============

/**
 * Get OpenAI-compatible tool schemas for disk operations
 * Returns empty array if client is not available
 */
export function getDiskToolSchemas(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  try {
    // DISK_TOOLS is a pre-defined tool bundle from @acontext/acontext
    // It provides toOpenAIToolSchema() method for OpenAI compatibility
    return DISK_TOOLS.toOpenAIToolSchema() as unknown as OpenAI.Chat.Completions.ChatCompletionTool[];
  } catch (error) {
    console.warn("[DiskTools] Failed to get tool schemas:", error);
    return [];
  }
}

// ============ Tool Execution ============

/**
 * Format the tool context required by DISK_TOOLS.executeTool
 */
async function formatDiskToolContext(
  client: AcontextClientLike,
  diskId?: string
): Promise<ReturnType<typeof DISK_TOOLS.formatContext> | null> {
  // Get or create disk if not provided
  let targetDiskId = diskId;

  if (!targetDiskId) {
    const disks = await client.disks.list();
    if (disks?.items?.length) {
      targetDiskId = disks.items[0].id;
    } else {
      const newDisk = await client.disks.create();
      targetDiskId = newDisk.id;
    }
  }

  if (!targetDiskId) {
    console.warn("[DiskTools] No disk available");
    return null;
  }

  // Use DISK_TOOLS.formatContext from the SDK
  return DISK_TOOLS.formatContext(client as unknown as InstanceType<typeof import("@acontext/acontext").Acontext>, targetDiskId);
}

/**
 * Execute a disk tool by name
 *
 * @param context - Tool execution context with Acontext client and disk ID
 * @param name - Tool name (e.g., "write_file_disk", "read_file_disk")
 * @param args - Tool arguments from LLM
 * @returns Tool execution result
 */
export async function executeDiskTool(
  context: ToolExecutionContext,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  if (!isDiskToolName(name)) {
    throw new Error(`Unknown disk tool: ${name}`);
  }

  const { acontextClient, diskId } = context;

  const ctx = await formatDiskToolContext(acontextClient, diskId);
  if (!ctx) {
    throw new Error("Disk tools are not configured");
  }

  try {
    console.debug(`[DiskTools] Executing: ${name}`, { args, diskId: ctx.diskId });

    // Use DISK_TOOLS.executeTool from the SDK
    const result = await DISK_TOOLS.executeTool(ctx, name, args);

    console.debug(`[DiskTools] Success: ${name}`);
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[DiskTools] Error executing ${name}:`, errorMessage);

    // Provide user-friendly error for common issues
    if (name === "download_file_disk" && errorMessage.includes("not found")) {
      return `File not found. Use list_disk to see available files.`;
    }

    throw error;
  }
}

// ============ Convenience Wrappers ============

/**
 * Write a file to disk (convenience wrapper)
 */
export async function writeFile(
  context: ToolExecutionContext,
  path: string,
  content: string
): Promise<unknown> {
  return executeDiskTool(context, "write_file_disk", {
    path,
    content,
  });
}

/**
 * Read a file from disk (convenience wrapper)
 */
export async function readFile(
  context: ToolExecutionContext,
  path: string
): Promise<string> {
  return executeDiskTool(context, "read_file_disk", { path }) as Promise<string>;
}

/**
 * List files in a directory (convenience wrapper)
 */
export async function listFiles(
  context: ToolExecutionContext,
  path: string = "/"
): Promise<unknown> {
  return executeDiskTool(context, "list_disk", { path });
}

/**
 * Search file contents with grep (convenience wrapper)
 */
export async function grepFiles(
  context: ToolExecutionContext,
  pattern: string,
  path?: string
): Promise<unknown> {
  return executeDiskTool(context, "grep_disk", {
    pattern,
    path: path || "/",
  });
}

/**
 * Match file paths with glob pattern (convenience wrapper)
 */
export async function globFiles(
  context: ToolExecutionContext,
  pattern: string,
  path?: string
): Promise<unknown> {
  return executeDiskTool(context, "glob_disk", {
    pattern,
    path: path || "/",
  });
}

/**
 * Replace string in a file (convenience wrapper)
 */
export async function replaceInFile(
  context: ToolExecutionContext,
  path: string,
  oldString: string,
  newString: string
): Promise<unknown> {
  return executeDiskTool(context, "replace_string_disk", {
    path,
    old_string: oldString,
    new_string: newString,
  });
}
