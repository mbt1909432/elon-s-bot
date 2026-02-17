/**
 * Acontext SDK wrapper for minimal integration
 * Provides: session management, disk operations, artifact storage
 *
 * Dependencies: @acontext/acontext
 * Copy to your project and adjust imports as needed.
 */

import { Acontext } from "@acontext/acontext";
import type {
  AcontextConfig,
  AcontextClientLike,
  AcontextSession,
  AcontextDisk,
  AcontextArtifact,
  TokenCounts,
  ChatMessage,
  EditStrategy,
} from "./types";

// ============ Client Creation ============

/**
 * Create an Acontext client instance
 * Returns null if config is null (Acontext disabled)
 */
export function createAcontextClient(config: AcontextConfig | null): AcontextClientLike | null {
  if (!config) return null;

  return new Acontext({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  }) as unknown as AcontextClientLike;
}

// ============ Session Management ============

/**
 * Create a new Acontext session
 */
export async function createSession(
  client: AcontextClientLike,
  options?: {
    userId?: string;
    metadata?: Record<string, unknown>;
    diskId?: string;
  }
): Promise<AcontextSession> {
  const configs: Record<string, unknown> = {
    ...(options?.metadata || {}),
  };

  if (options?.userId) {
    configs.userId = options.userId;
  }
  if (options?.diskId) {
    configs.diskId = options.diskId;
  }

  return client.sessions.create({ configs });
}

/**
 * Delete an Acontext session
 */
export async function deleteSession(
  client: AcontextClientLike,
  sessionId: string
): Promise<void> {
  return client.sessions.delete(sessionId);
}

/**
 * Store a message in an Acontext session
 * Supports string content and Vision API format (array with images)
 */
export async function storeMessage(
  client: AcontextClientLike,
  sessionId: string,
  message: ChatMessage
): Promise<void> {
  const messageBlob: Record<string, unknown> = {
    role: message.role,
    content: message.content,
  };

  // Include tool_calls for assistant messages
  if (message.role === "assistant" && message.tool_calls) {
    messageBlob.tool_calls = message.tool_calls;
  }

  // Include tool_call_id for tool response messages
  if (message.role === "tool" && message.tool_call_id) {
    messageBlob.tool_call_id = message.tool_call_id;
  }

  await client.sessions.storeMessage(sessionId, messageBlob, {
    format: "openai",
  });
}

/**
 * Load messages from an Acontext session
 */
export async function loadMessages(
  client: AcontextClientLike,
  sessionId: string,
  options?: {
    limit?: number;
    editStrategies?: EditStrategy[];
  }
): Promise<ChatMessage[]> {
  const result = await client.sessions.getMessages(sessionId, {
    format: "openai",
    limit: options?.limit,
    editStrategies: options?.editStrategies,
  });

  if (!result?.items) return [];

  // Filter out tool messages (they're embedded in assistant messages)
  return result.items
    .filter((item) => item.role !== "tool")
    .map((item) => ({
      role: item.role as "user" | "assistant" | "system",
      content: item.content || "",
      tool_calls: item.tool_calls,
    }));
}

/**
 * Get token counts for a session
 */
export async function getTokenCounts(
  client: AcontextClientLike,
  sessionId: string
): Promise<TokenCounts | null> {
  try {
    return await client.sessions.getTokenCounts(sessionId);
  } catch {
    return null;
  }
}

/**
 * Load messages with automatic compression if over token limit
 */
export async function loadMessagesWithCompression(
  client: AcontextClientLike,
  sessionId: string,
  options?: {
    tokenThreshold?: number;
    targetTokens?: number;
    keepRecentToolResults?: number;
  }
): Promise<ChatMessage[]> {
  const threshold = options?.tokenThreshold ?? 80000;
  const target = options?.targetTokens ?? 70000;
  const keepRecent = options?.keepRecentToolResults ?? 5;

  const tokenCounts = await getTokenCounts(client, sessionId);

  if (!tokenCounts || tokenCounts.total_tokens < threshold) {
    return loadMessages(client, sessionId);
  }

  // Apply compression strategies
  const editStrategies: EditStrategy[] = [
    {
      type: "token_limit",
      params: { limit_tokens: target },
    },
    {
      type: "remove_tool_result",
      params: {
        keep_recent_n_tool_results: keepRecent,
        tool_result_placeholder: "Done",
      },
    },
  ];

  return loadMessages(client, sessionId, { editStrategies });
}

// ============ Disk Management ============

/**
 * Create a new Acontext disk for file storage
 */
export async function createDisk(client: AcontextClientLike): Promise<AcontextDisk> {
  return client.disks.create();
}

/**
 * List all disks
 */
export async function listDisks(
  client: AcontextClientLike
): Promise<AcontextDisk[]> {
  const result = await client.disks.list();
  return result?.items || [];
}

/**
 * Get or create a default disk
 */
export async function getOrCreateDisk(
  client: AcontextClientLike,
  existingDiskId?: string
): Promise<string> {
  if (existingDiskId) return existingDiskId;

  const disks = await listDisks(client);
  if (disks.length > 0) {
    return disks[0].id;
  }

  const newDisk = await createDisk(client);
  return newDisk.id;
}

// ============ Artifact Operations ============

/**
 * Upload a file as an artifact
 */
export async function uploadArtifact(
  client: AcontextClientLike,
  diskId: string,
  options: {
    filename: string;
    content: Buffer | ArrayBuffer;
    mimeType: string;
    path?: string;
  }
): Promise<AcontextArtifact> {
  return client.disks.artifacts.upsert(diskId, {
    file: [options.filename, options.content, options.mimeType],
    filePath: options.path || "/",
  });
}

/**
 * Get artifact content and metadata
 */
export async function getArtifact(
  client: AcontextClientLike,
  diskId: string,
  filePath: string
): Promise<{
  content: Buffer | null;
  mimeType: string;
  publicUrl?: string;
}> {
  // Parse path into directory and filename
  const parts = filePath.split("/").filter(Boolean);
  const filename = parts[parts.length - 1] || filePath;
  const dirPath = parts.length > 1 ? "/" + parts.slice(0, -1).join("/") : "/";

  const result = await client.disks.artifacts.get(diskId, {
    filePath: dirPath,
    filename,
    withContent: true,
    withPublicUrl: true,
  });

  let content: Buffer | null = null;
  let mimeType = "application/octet-stream";

  if (result?.content) {
    mimeType = result.content.type || mimeType;
    if (result.content.text) {
      content = Buffer.from(result.content.text, "utf-8");
    } else if (result.content.raw) {
      if (Buffer.isBuffer(result.content.raw)) {
        content = result.content.raw;
      } else if (typeof result.content.raw === "string") {
        content = Buffer.from(result.content.raw, "base64");
      } else if (result.content.raw instanceof ArrayBuffer) {
        content = Buffer.from(result.content.raw);
      }
    }
  }

  return {
    content,
    mimeType,
    publicUrl: result?.public_url,
  };
}

/**
 * List artifacts in a disk (optionally recursive)
 */
export async function listArtifacts(
  client: AcontextClientLike,
  diskId: string,
  options?: {
    path?: string;
    recursive?: boolean;
  }
): Promise<AcontextArtifact[]> {
  const allArtifacts: AcontextArtifact[] = [];
  const path = options?.path || "/";

  const result = await client.disks.artifacts.list(diskId, { path });

  if (result?.artifacts) {
    allArtifacts.push(...result.artifacts);
  }

  // If recursive, traverse subdirectories
  if (options?.recursive && result?.directories) {
    for (const dir of result.directories) {
      const subArtifacts = await listArtifacts(client, diskId, {
        path: dir,
        recursive: true,
      });
      allArtifacts.push(...subArtifacts);
    }
  }

  return allArtifacts;
}

/**
 * Delete an artifact
 */
export async function deleteArtifact(
  client: AcontextClientLike,
  diskId: string,
  filePath: string
): Promise<void> {
  const parts = filePath.split("/").filter(Boolean);
  const filename = parts[parts.length - 1] || filePath;
  const dirPath = parts.length > 1 ? "/" + parts.slice(0, -1).join("/") : "/";

  await client.disks.artifacts.delete(diskId, {
    filePath: dirPath,
    filename,
  });
}

/**
 * Get public URL for an artifact
 */
export async function getArtifactPublicUrl(
  client: AcontextClientLike,
  diskId: string,
  filePath: string
): Promise<string | null> {
  const result = await getArtifact(client, diskId, filePath);
  return result.publicUrl || null;
}

// ============ Utility ============

/**
 * Check if the client can connect to Acontext
 */
export async function pingAcontext(client: AcontextClientLike): Promise<boolean> {
  try {
    return await client.ping();
  } catch {
    return false;
  }
}
