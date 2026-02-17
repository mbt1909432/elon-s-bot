# Acontext SDK API Reference

## Installation

```bash
npm install @acontext/acontext
```

## Initialization

```ts
import { AcontextClient } from "@acontext/acontext";

// baseUrl is optional - only needed for self-hosted Acontext
const client = new AcontextClient({
  apiKey: process.env.ACONTEXT_API_KEY,
  // baseUrl: "http://localhost:8029/api/v1",  // Only for self-hosted
});

// Test connection
await client.ping();  // Returns true if connected
```

## Sessions API

### Create Session

```ts
// Create session with optional user association
const session = await client.sessions.create({
  user: "user@example.com"  // Optional: associate with a user
});

// Create with specific UUID (useful for external correlation)
const session = await client.sessions.create({
  user: "user@example.com",
  useUuid: "123e4567-e89b-12d3-a456-426614174000"
});
// Returns: { id: "session_xxx", ... }
// Note: 409 Conflict if UUID already exists
```

### Store Message

Multi-format support - store in any format, retrieve in any format:

```ts
// OpenAI format
await client.sessions.storeMessage(sessionId, {
  role: "user",
  content: "What is the capital of France?"
});

// Anthropic format (Vision API)
await client.sessions.storeMessage(sessionId, {
  role: "user",
  content: [{ type: "text", text: "Explain quantum computing" }]
});

// With tool calls (assistant message)
await client.sessions.storeMessage(sessionId, {
  role: "assistant",
  content: "Done!",
  tool_calls: [{ id: "tc_123", type: "function", function: { name: "tool", arguments: "{}" } }]
});

// Tool response
await client.sessions.storeMessage(sessionId, {
  role: "tool",
  tool_call_id: "tc_123",
  content: '{"result": "success"}'
});
```

### Get Messages

```ts
// Retrieve messages (format auto-converts)
const result = await client.sessions.getMessages(sessionId);

// With compression strategies
const result = await client.sessions.getMessages(sessionId, {
  editStrategies: [
    { type: "token_limit", params: { limit_tokens: 70000 } },
    { type: "remove_tool_result", params: { keep_recent_n_tool_results: 5 } }
  ]
});

// Returns: { items: Message[], total?: number }
```

### Get Token Counts

```ts
const counts = await client.sessions.getTokenCounts(sessionId);
// Returns: { total_tokens: number }
```

### Delete Session

```ts
await client.sessions.delete(sessionId);
```

## Disks API

### Create Disk

```ts
const disk = await client.disks.create();
// Returns: { id: "disk_xxx", ... }
```

### List Disks

```ts
const result = await client.disks.list();
// Returns: { items: Disk[] }
```

## Artifacts API

Import `FileUpload` for file operations:

```ts
import { FileUpload } from "@acontext/acontext";
```

### Upload Artifact

```ts
// Using FileUpload class
const artifact = await client.disks.artifacts.upsert(disk.id, {
  file: new FileUpload("notes.md", Buffer.from("# Notes\nContent here")),
  file_path: "/documents/2024/",
  meta: { author: "alice", version: "1.0" }
});

// Alternative: array format
await client.disks.artifacts.upsert(diskId, {
  file: ["script.py", scriptBuffer, "text/x-python"],
  file_path: "/scripts/"
});
```

### Get Artifact

```ts
const result = await client.disks.artifacts.get(disk.id, {
  file_path: "/documents/2024/",
  filename: "notes.md",
  with_public_url: true,
  with_content: true
});

// Returns: {
//   artifact?: { path, filename, mimeType, meta, ... },
//   content?: { type, text?, raw? },
//   public_url?: string
// }
```

### List Artifacts

```ts
const result = await client.disks.artifacts.list(diskId, {
  path: "/figures/"
});

// Returns: {
//   artifacts: Artifact[],
//   directories: string[]
// }
```

### Update Metadata

```ts
// Update metadata only (no re-upload needed)
await client.disks.artifacts.update(disk.id, {
  file_path: "/documents/2024/",
  filename: "notes.md",
  meta: { reviewed: true }
});
```

### Delete Artifact

```ts
await client.disks.artifacts.delete(diskId, {
  file_path: "/path/to/dir/",
  filename: "file.png"
});
```

### Delete Disk

```ts
await client.disks.delete(disk.id);
```

### Download to Sandbox

```ts
await client.disks.artifacts.downloadToSandbox(diskId, {
  filePath: "/scripts/",
  filename: "script.py",
  sandboxId: "sandbox_xxx",
  sandboxPath: "/workspace/"
});
```

### Upload from Sandbox

```ts
await client.disks.artifacts.uploadFromSandbox(diskId, {
  sandboxId: "sandbox_xxx",
  sandboxPath: "/workspace/",
  sandboxFilename: "figure.png",
  filePath: "/figures/"
});
```

## Sandboxes API

### Create Sandbox

```ts
const sandbox = await client.sandboxes.create();
// Returns: { sandbox_id: "sandbox_xxx", ... }
```

### Execute Command

```ts
const result = await client.sandboxes.execCommand({
  sandboxId: "sandbox_xxx",
  command: "python3 script.py",
  timeout: 60000  // ms
});

// Returns: {
//   exit_code: number,
//   stdout: string,
//   stderr: string
// }
```

### Kill Sandbox

```ts
await client.sandboxes.kill(sandboxId);
```

## Tool Bundles

### DISK_TOOLS Bundle

Pre-configured tool bundle for file operations.

```ts
import { DISK_TOOLS } from "@acontext/acontext";

// Create context for execution
const ctx = DISK_TOOLS.format_context(client, disk.id);

// Get OpenAI-compatible schemas
const schemas = DISK_TOOLS.to_openai_tool_schema();

// Get context prompt for system message
const contextPrompt = ctx.get_context_prompt();

// Execute tool
const result = await DISK_TOOLS.execute_tool(ctx, toolName, args);
```

**Available Tools:**

| Tool | Description | Parameters |
|------|-------------|------------|
| `write_file_disk` | Create/overwrite files | `filename`, `content`, `file_path` |
| `read_file_disk` | Read file contents | `filename`, `file_path`, `line_offset`, `line_limit` |
| `replace_string_disk` | Find and replace text | `filename`, `old_string`, `new_string`, `file_path` |
| `list_disk` | List directory contents | `file_path` |
| `download_file_disk` | Get public download URL | `filename`, `file_path`, `expire` |
| `grep_disk` | Search contents with regex | `query`, `limit` |
| `glob_disk` | Find files by pattern | `query`, `limit` |

### SANDBOX_TOOLS Bundle

Pre-configured tool bundle for code execution.

```ts
import { SANDBOX_TOOLS } from "@acontext/acontext";

// Create sandbox and disk
const sandbox = client.sandboxes.create();
const disk = client.disks.create();

// Create context with optional skill mounting
const ctx = SANDBOX_TOOLS.format_context(
  client,
  sandbox.sandbox_id,
  disk.id,
  // mount_skills: ["skill-uuid-1", "skill-uuid-2"]
);

// Get tools and context prompt
const tools = SANDBOX_TOOLS.to_openai_tool_schema();
const contextPrompt = ctx.get_context_prompt();

// Mount skills after creation (optional)
ctx.mount_skills(["skill-uuid-3"]);
```

**Available Tools:**

| Tool | Description | Parameters |
|------|-------------|------------|
| `bash_execution_sandbox` | Execute bash commands | `command`, `timeout` |
| `text_editor_sandbox` | View, create, edit files | `command`, `path`, `file_text`, `old_str`, `new_str`, `view_range` |
| `export_file_sandbox` | Export files to disk | `sandbox_path`, `sandbox_filename` |

**Sandbox Environment:**
- Pre-installed: Python 3, ripgrep, fd, sqlite3, jq, imagemagick
- Limitations: No blocking calls (`plt.show()`, `input()`), expires after 30 minutes

## Edit Strategies

### Token Limit

```ts
{
  type: "token_limit",
  params: {
    limit_tokens: 70000
  }
}
```

### Remove Tool Results

```ts
{
  type: "remove_tool_result",
  params: {
    keep_recent_n_tool_results: 5,
    tool_result_placeholder: "Done"
  }
}
```

### Remove Tool Call Params

```ts
{
  type: "remove_tool_call_params",
  params: {
    keep_recent_n_tool_calls: 10
  }
}
```

## Error Handling

```ts
try {
  await client.sessions.storeMessage(sessionId, message);
} catch (error) {
  // Common errors:
  // - UNAUTHORIZED: Invalid API key
  // - NOT_FOUND: Session/disk doesn't exist
  // - RATE_LIMITED: Too many requests
  // - PAYLOAD_TOO_LARGE: Message exceeds limit
  console.error(error.message);
}
```
