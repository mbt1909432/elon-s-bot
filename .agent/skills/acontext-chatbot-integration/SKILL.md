---
name: acontext-chatbot-integration
description: "Build AI chatbots with Acontext integration for persistent storage, file operations, and Python sandbox execution. Use when: (1) Building chatbots with conversation history storage, (2) Implementing file read/write/list/grep tools, (3) Adding Python code execution for data analysis, (4) Creating figure generation pipelines, (5) Managing artifacts with disk:: protocol, (6) Implementing token-aware context compression."
---

# Acontext Chatbot Integration

Integration patterns for building AI chatbots with Acontext SDK - provides session management, disk tools, sandbox execution, and artifact storage.

## Architecture

**Core Principle: One Acontext Session = One Conversation, all messages stored in Acontext, no database needed for messages.**

```
┌─────────────────────────────────────────────────────┐
│                  Your Chatbot                        │
├─────────────────────────────────────────────────────┤
│  LLM Client  │  Tool Router  │  Session Manager     │
└──────┬───────┴───────┬───────┴────────┬─────────────┘
       │               │                │
       ▼               ▼                ▼
┌─────────────────────────────────────────────────────┤
│              Acontext SDK (Only Storage Layer)       │
├─────────────────────────────────────────────────────┤
│  sessions.*        disks.*          sandboxes.*     │
│  - storeMessage    - create         - create        │
│  - getMessages     - artifacts.*    - execCommand   │
│  - getTokenCounts    - upsert       - kill          │
│  - delete            - get                          │
│                      - delete                       │
└─────────────────────────────────────────────────────┘
```

**Storage Architecture:**

| Layer | Content | Required? |
|-------|---------|-----------|
| **Acontext Sessions** | Conversation messages, context, token counts | Required |
| **Acontext Disk** | Generated files, images, artifacts | Required |
| **Database (Supabase)** | User auth, session ID mapping | Optional |

**Do NOT use database for messages!** All messages managed via `sessions.storeMessage()` and `sessions.getMessages()`.

## Session + Disk Binding (1:1:1)

**One Session = One Conversation = One Disk (1:1:1 binding)**

- Each Session gets its own independent Disk
- Files are completely isolated between conversations
- Never share Disk between Sessions

```ts
// CORRECT: Each session has its own disk
const session = await acontext.sessions.create({ user });
const disk = await acontext.disks.create(); // Exclusive to this session

// WRONG: Multiple sessions sharing one disk
const sharedDisk = await acontext.disks.create();
// Don't share this disk across sessions!
```

See [references/session-management.md](references/session-management.md) for detailed lifecycle management.

## Quick Start

### 1. Initialize Clients

```ts
import { AcontextClient } from "@acontext/acontext";

// baseUrl is optional - only needed for self-hosted
const client = new AcontextClient({
  apiKey: process.env.ACONTEXT_API_KEY,
});

await client.ping();  // Test connection
```

### 2. Create Session + Disk

```ts
const session = await client.sessions.create({ user: "user@example.com" });
const disk = await client.disks.create();

console.log(`Session: ${session.id}, Disk: ${disk.id}`);
```

### 3. Store and Load Messages

```ts
await client.sessions.storeMessage(session.id, {
  role: "user",
  content: "Hello!"
});

const messages = await client.sessions.getMessages(session.id);
console.log(messages.items);
```

## Core Features

### Session Management

```ts
// Store message
await client.sessions.storeMessage(session.id, {
  role: "user" | "assistant" | "system",
  content: string,              // Also supports ContentPart[] for images
  tool_calls?: ToolCall[],      // For assistant with tool calls
  tool_call_id?: string         // For tool response
});

// Load messages
const result = await client.sessions.getMessages(session.id);

// Get token counts
const tokens = await client.sessions.getTokenCounts(session.id);
```

### Disk Tools

| Tool | Description |
|------|-------------|
| `write_file_disk` | Create or overwrite a file |
| `read_file_disk` | Read file contents |
| `replace_string_disk` | Find and replace in a file |
| `list_disk` | List files in a directory |
| `download_file_disk` | Get file with public URL |
| `grep_disk` | Search file contents |
| `glob_disk` | Match file paths by pattern |

```ts
import { DISK_TOOLS } from "@acontext/acontext";

const ctx = DISK_TOOLS.format_context(acontext, diskId);
const toolSchemas = DISK_TOOLS.to_openai_tool_schema();

const result = await DISK_TOOLS.execute_tool(ctx, "write_file_disk", {
  filename: "notes.txt",
  content: "Hello, World!",
  file_path: "/"
});
```

### Sandbox Tools

| Tool | Description |
|------|-------------|
| `bash_execution_sandbox` | Execute bash commands |
| `text_editor_sandbox` | View, create, edit text files |
| `export_file_sandbox` | Export files to disk with download URL |

```ts
import { SANDBOX_TOOLS } from "@acontext/acontext";

const sandbox = await acontext.sandboxes.create();
const ctx = SANDBOX_TOOLS.format_context(acontext, sandbox.sandbox_id, disk.id);

const result = await SANDBOX_TOOLS.execute_tool(ctx, "bash_execution_sandbox", {
  command: "python3 script.py",
  timeout: 30
});

await acontext.sandboxes.kill(sandbox.sandbox_id); // Always cleanup
```

### Artifact Storage

```ts
import { FileUpload } from "@acontext/acontext";

// Upload
const artifact = await client.disks.artifacts.upsert(disk.id, {
  file: new FileUpload("notes.md", Buffer.from("# Notes")),
  file_path: "/documents/",
  meta: { author: "alice" }
});

// Get with public URL
const result = await client.disks.artifacts.get(disk.id, {
  file_path: "/documents/",
  filename: "notes.md",
  with_public_url: true,
  with_content: true
});
```

## disk:: Protocol

Use `disk::` for permanent image references instead of expiring URLs.

**Tool Output:**
```ts
{ diskPath: "disk::figures/2026-02-17/chart.png" }
```

**Frontend Rewrite:**
```ts
const pattern = /disk::\s*([A-Za-z0-9/_-]+\.(?:png|jpg|jpeg|webp|gif))/gi;
content.replace(pattern, (_, path) =>
  `/api/artifacts/public-url?filePath=${path}&diskId=${diskId}`
);
```

## Critical: Message Sequence for Tool Calls

OpenAI API requires strict message ordering:

```
User → Assistant (tool_calls) → Tool Response → Assistant Response
```

```ts
// 1. User message
await client.sessions.storeMessage(sessionId, { role: "user", content: "Draw" });

// 2. Assistant with tool_calls (MUST save!)
await client.sessions.storeMessage(sessionId, {
  role: "assistant",
  content: "",
  tool_calls: [{ id: "call_xxx", type: "function", function: {...} }]
});

// 3. Tool response (MUST follow tool_call_id!)
await client.sessions.storeMessage(sessionId, {
  role: "tool",
  tool_call_id: "call_xxx",
  content: JSON.stringify({ result: "success" })
});
```

**Common Error:**
```
400 An assistant message with 'tool_calls' must be followed by tool messages
```
Cause: Assistant with `tool_calls` saved but tool response not saved.

## Tool Routing Pattern

```ts
import { DISK_TOOLS, SANDBOX_TOOLS } from "@acontext/acontext";

async function executeToolCall(toolCall, context) {
  const { name } = toolCall.function;
  const args = JSON.parse(toolCall.function.arguments || "{}");

  if (isDiskToolName(name)) {
    const ctx = DISK_TOOLS.format_context(context.acontextClient, context.diskId);
    return DISK_TOOLS.execute_tool(ctx, name, args);
  }

  if (isSandboxToolName(name)) {
    const ctx = SANDBOX_TOOLS.format_context(
      context.acontextClient, context.sandboxId, context.diskId
    );
    return SANDBOX_TOOLS.execute_tool(ctx, name, args);
  }

  throw new Error(`Unknown tool: ${name}`);
}

// Register tools
const tools = [
  ...DISK_TOOLS.to_openai_tool_schema(),
  ...SANDBOX_TOOLS.to_openai_tool_schema(),
];
```

## Integration Checklist

1. **Setup**: Install `@acontext/acontext`, configure `ACONTEXT_API_KEY`
2. **Sessions**: Create on new chat, store every message in Acontext, load on resume
3. **Session + Disk**: 1:1 binding, each session gets its own disk
4. **Message Sequence**: Always save tool responses after tool_calls
5. **disk::**: Tools return diskPath, frontend rewrites to API URL
6. **Compression**: Monitor tokens, apply strategies when >80K
7. **Cleanup**: Delete both Session AND Disk when deleting conversation

## Acontext Skill System

Acontext provides a built-in Skill system that can be mounted into sandboxes for code execution.

```ts
import { SANDBOX_TOOLS } from "@acontext/acontext";

// Create sandbox and disk
const sandbox = await acontext.sandboxes.create();
const disk = await acontext.disks.create();

// Create context with skill mounting
const ctx = SANDBOX_TOOLS.format_context(
  acontext,
  sandbox.sandbox_id,
  disk.id,
  { mount_skills: ["skill-uuid-1", "skill-uuid-2"] }
);

// Or mount skills after creation
ctx.mount_skills(["skill-uuid-3"]);

// Skills are available at /skills/{skill_name}/ in sandbox
// Example: /skills/my-skill/scripts/process.py
```

**Use Cases:**
- Provide domain-specific scripts to LLM
- Share reusable code across sessions
- Give agents access to specialized tools

**Note:** Always call `get_context_prompt()` after mounting to include skill info in system message.

## Advanced Topics

See reference files for detailed implementations:

- **[Session Management](references/session-management.md)** - Lifecycle, list management, file isolation
- **[Context Compression](references/context-compression.md)** - Token monitoring, auto/manual compression
- **[Error Handling](references/error-handling.md)** - API errors, tool errors, retry strategies
- **[Vision API](references/vision-api.md)** - Multimodal content, image processing
- **[Streaming](references/streaming.md)** - SSE server and client implementation
- **[Session Cleanup](references/session-cleanup.md)** - Delete sessions, batch cleanup
- **[Debugging](references/debugging.md)** - Logging format, common issues
- **[Troubleshooting](references/troubleshooting.md)** - 404 errors, tool sequence errors
- **[Skill System](references/skill-system.md)** - Mount Acontext skills into sandboxes
- **[API Reference](references/api-reference.md)** - Complete SDK method reference
- **[Implementation](references/implementation.md)** - Full code examples

## Scripts

Copy these files to your project:

- `scripts/types.ts` - Core type definitions
- `scripts/config.ts` - Environment configuration
- `scripts/acontext-client.ts` - SDK wrapper utilities
- `scripts/disk-tools.ts` - Disk tool schemas and execution
- `scripts/sandbox-tool.ts` - Python sandbox execution
- `scripts/openai-client.ts` - OpenAI client with tool routing

## Common Mistakes

**Wrong Architecture:**
```
Database → Store message history  // WRONG!
Acontext → Only for tools         // WRONG!
```

**Correct Architecture:**
```
Acontext Sessions → Store all messages, context management
Acontext Disk     → Store generated files
Database (opt)    → Only for user auth, session ID mapping
```

```ts
// CORRECT: Store messages in Acontext
await client.sessions.storeMessage(sessionId, { role: "user", content: "Hello" });

// WRONG: Store messages in database
await supabase.from('messages').insert({ content: "Hello" });
```
