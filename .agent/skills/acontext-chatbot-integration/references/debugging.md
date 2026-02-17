# Debugging & Logging

## Recommended Log Format

```ts
const LOG_PREFIX = "[Acontext]";

function log(level: "debug" | "info" | "warn" | "error", message: string, data?: any) {
  const timestamp = new Date().toISOString();
  const logData = data ? ` ${JSON.stringify(data)}` : "";
  console.log(`${timestamp} ${LOG_PREFIX} [${level.toUpperCase()}] ${message}${logData}`);
}

// Usage
log("info", "Creating new session", { userId: "user@example.com" });
log("error", "Failed to store message", { sessionId, error: error.message });
```

## Key Log Points

```ts
// 1. Session creation
console.log("[Acontext] Session created", { sessionId: session.id, diskId: disk.id });

// 2. Message storage
console.log("[Acontext] Message stored", { sessionId, role: message.role, tokenCount });

// 3. Tool calls
console.log("[Tool] Executing", { name: tc.function.name, args: tc.function.arguments });
console.log("[Tool] Result", { name: tc.function.name, success: true, duration: `${ms}ms` });

// 4. Token counts
console.log("[Acontext] Token counts", { sessionId, total: tokenCounts.total_tokens });

// 5. Compression triggered
console.log("[Acontext] Auto-compressing", { sessionId, strategies: strategies.map(s => s.type) });
```

## Common Issues

| Issue | Possible Cause | Solution |
|-------|---------------|----------|
| 404 Not Found | Session/Disk doesn't exist | Check if ID is correct, may be deleted |
| 401 Unauthorized | Invalid API Key | Check `ACONTEXT_API_KEY` env variable |
| Tool call sequence error | Incorrect message order | Check if tool response messages are saved |
| Token limit exceeded | Conversation too long | Check `getTokenCounts()`, apply compression |
| Stream interrupted | Network issue | Add reconnect logic, save received content |

## Test Connection

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
