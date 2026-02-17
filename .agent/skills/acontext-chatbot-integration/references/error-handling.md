# Error Handling

## API Error Handling

```ts
async function safeAcontextCall<T>(
  operation: () => Promise<T>,
  fallback?: T
): Promise<T | null> {
  try {
    return await operation();
  } catch (error: any) {
    if (error.status === 401) {
      console.error("[Acontext] Unauthorized - check API key");
    } else if (error.status === 404) {
      console.error("[Acontext] Resource not found - session/disk may be deleted");
    } else if (error.status === 429) {
      console.error("[Acontext] Rate limited - implement retry with backoff");
    } else if (error.status >= 500) {
      console.error("[Acontext] Server error - retry later");
    }
    return fallback ?? null;
  }
}
```

## Tool Execution Error Handling

```ts
async function executeToolCallSafely(tc: any, context: ToolExecutionContext) {
  try {
    const result = await executeToolCall(tc, context);
    return { success: true, result };
  } catch (error: any) {
    console.error(`[Tool] ${tc.function.name} failed:`, error.message);
    return {
      success: false,
      error: error.message,
      result: { error: `Tool execution failed: ${error.message}` }
    };
  }
}

// Save tool response with error info
await storeMessage(sessionId, {
  role: "tool",
  tool_call_id: tc.id,
  content: JSON.stringify(
    toolResult.success ? toolResult.result : { error: toolResult.error }
  ),
});
```

## Retry with Backoff

```ts
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      if (attempt === maxRetries - 1) throw error;
      const delay = baseDelay * Math.pow(2, attempt);  // 1s, 2s, 4s...
      console.log(`[Retry] Attempt ${attempt + 1} failed, retrying in ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error("Max retries exceeded");
}
```

## Tool Result Size Limit

```ts
function safeToolResult(result: unknown, maxBytes = 9_500_000): string {
  const json = JSON.stringify(result ?? {});
  if (Buffer.byteLength(json, "utf8") <= maxBytes) return json;

  return JSON.stringify({
    truncated: true,
    preview: json.slice(0, 2000),
    note: "Result too large, check saved artifacts"
  });
}
```
