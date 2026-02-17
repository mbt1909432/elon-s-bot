# Troubleshooting

## 404 Not Found Error

```
[Acontext] Response: { status: 404, statusText: 'Not Found' }
```

### Cause 1: Wrong Import

```ts
// CORRECT
import { AcontextClient } from "@acontext/acontext";
const client = new AcontextClient({ apiKey: process.env.ACONTEXT_API_KEY });

// WRONG
import { Acontext } from "@acontext/acontext";
```

### Cause 2: Wrong Request Body Format

```ts
// CORRECT (official SDK)
const session = await client.sessions.create({
  user: "user@example.com"
});

// WRONG (non-standard)
await client.sessions.create({
  configs: { userId: "user-123" }
});
```

### Cause 3: Missing baseUrl for Self-Hosted

```ts
// For self-hosted Acontext
const client = new AcontextClient({
  baseUrl: "http://localhost:8029/api/v1",
  apiKey: "sk-ac-your-root-api-bearer-token",
});
```

### Cause 4: Wrong API Key Format

```
CORRECT: sk-ac-xxx
WRONG: acx-xxx
```

## Tool Call Sequence Error

```
400 An assistant message with 'tool_calls' must be followed by tool messages
responding to each 'tool_call_id'. The following tool_call_ids did not have
response messages: call_xxx
```

### Diagnosis

1. Check if assistant messages with `tool_calls` are saved
2. Check if corresponding `tool` response messages are saved
3. Verify `tool_call_id` matches between assistant and tool messages

### Debug Logging

```ts
const messages = await client.sessions.getMessages(sessionId);
for (const msg of messages.items) {
  if (msg.role === "assistant" && msg.tool_calls) {
    console.log("Assistant tool_calls:", msg.tool_calls.map(tc => tc.id));
  }
  if (msg.role === "tool") {
    console.log("Tool response for:", msg.tool_call_id);
  }
}
```

### Fix

Always save tool response immediately after execution:

```ts
// Execute tool
const result = await executeToolCall(toolCall, context);

// Save tool response BEFORE next LLM call
await client.sessions.storeMessage(sessionId, {
  role: "tool",
  tool_call_id: toolCall.id,
  content: JSON.stringify(result)
});
```

## Quick Connection Test

```ts
const client = new AcontextClient({ apiKey: process.env.ACONTEXT_API_KEY });

try {
  const pong = await client.ping();
  console.log("Connection OK:", pong);

  const session = await client.sessions.create({ user: "test@example.com" });
  console.log("Session created:", session.id);
} catch (error) {
  console.error("Connection failed:", error);
}
```
