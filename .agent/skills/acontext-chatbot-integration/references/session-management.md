# Session Management

## Core Principle

**One Acontext Session = One Conversation = One Disk (1:1:1 binding)**

## Session Lifecycle

```ts
import { AcontextClient } from "@acontext/acontext";

const acontext = new AcontextClient({
  apiKey: process.env.ACONTEXT_API_KEY
});

// ========== Create New Conversation ==========
export async function createChatSession(user: string) {
  // 1. Create Acontext Session
  const session = await acontext.sessions.create({ user });

  // 2. Create independent Disk (CRITICAL: each Session must have its own Disk!)
  const disk = await acontext.disks.create();

  // 3. Bind Session ID and Disk ID
  return {
    sessionId: session.id,
    diskId: disk.id,  // This Disk is exclusive to this Session
    createdAt: new Date().toISOString(),
  };
}

// ========== Get or Create Conversation ==========
export async function getOrCreateSession(
  existingSessionId?: string,
  diskId?: string,
  user?: string
) {
  if (existingSessionId) {
    const messages = await acontext.sessions.getMessages(existingSessionId);
    if (messages.items) {
      // If session exists but no disk, must create new one
      let finalDiskId = diskId;
      if (!finalDiskId) {
        const newDisk = await acontext.disks.create();
        finalDiskId = newDisk.id;
      }
      return { sessionId: existingSessionId, diskId: finalDiskId };
    }
  }

  return createChatSession(user || "anonymous@example.com");
}

// ========== Load History ==========
export async function loadMessages(sessionId: string) {
  const result = await acontext.sessions.getMessages(sessionId, {
    editStrategies: [
      { type: "token_limit", params: { limit_tokens: 70000 } },
      { type: "remove_tool_result", params: { keep_recent_n_tool_results: 5 } }
    ]
  });
  return result.items || [];
}

// ========== Store Message ==========
export async function storeMessage(
  sessionId: string,
  message: { role: "user" | "assistant" | "tool"; content: string; tool_calls?: any[]; tool_call_id?: string }
) {
  await acontext.sessions.storeMessage(sessionId, message);
}

// ========== Get Token Counts ==========
export async function getTokenCounts(sessionId: string) {
  return acontext.sessions.getTokenCounts(sessionId);
}
```

## Common Mistake: Sharing Disk

```ts
// WRONG: Multiple sessions sharing one disk
const sharedDisk = await acontext.disks.create();
const session1 = await acontext.sessions.create({ user });
const session2 = await acontext.sessions.create({ user });
// Files will be mixed up!

// CORRECT: Each session has its own disk
const session1 = await acontext.sessions.create({ user });
const disk1 = await acontext.disks.create(); // Exclusive to session1

const session2 = await acontext.sessions.create({ user });
const disk2 = await acontext.disks.create(); // Exclusive to session2
```

## Session List Management

```ts
// Acontext doesn't store title etc, maintain metadata yourself
// Option 1: Use session's user field for association
// Option 2: Use database for minimal mapping

// Database schema (minimal):
// - user_id
// - acontext_session_id
// - acontext_disk_id
// - title (optional)
// - created_at

export async function listUserSessions(userId: string) {
  const { data: mappings } = await supabase
    .from("session_mappings")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return mappings?.map(m => ({
    sessionId: m.acontext_session_id,
    diskId: m.acontext_disk_id,
    title: m.title,
    createdAt: m.created_at,
  })) || [];
}
```

## File Management (Each Session Has Independent Disk)

```ts
export async function listSessionFiles(diskId: string) {
  const result = await acontext.disks.artifacts.list(diskId, { path: "/" });
  return {
    files: result.artifacts || [],
    directories: result.directories || [],
  };
}

export async function getFileUrl(diskId: string, filePath: string, filename: string) {
  const result = await acontext.disks.artifacts.get(diskId, {
    file_path: filePath,
    filename,
    with_public_url: true,
  });
  return result.public_url;
}
```
