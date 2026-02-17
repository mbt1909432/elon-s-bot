# Context Compression

When conversations get long, compress context to avoid exceeding LLM token limits.

## Token Monitoring

```ts
const tokenCounts = await acontext.sessions.getTokenCounts(sessionId);

// Recommended thresholds
const WARNING_THRESHOLD = 70000;        // Start warning
const AUTO_COMPRESS_THRESHOLD = 80000;  // Auto compress
const MAX_THRESHOLD = 128000;           // Near model limit
```

## Auto Compression

```ts
export async function loadMessages(sessionId: string) {
  const tokenCounts = await acontext.sessions.getTokenCounts(sessionId);
  const editStrategies = [];

  if (tokenCounts.total_tokens > 70000) {
    editStrategies.push({
      type: "token_limit",
      params: { limit_tokens: 60000 }
    });
  }

  editStrategies.push({
    type: "remove_tool_result",
    params: { keep_recent_n_tool_results: 5 }
  });

  const result = await acontext.sessions.getMessages(sessionId, { editStrategies });
  return result.items;
}
```

## Manual Compression

```ts
export async function compressSessionContext(sessionId: string) {
  return acontext.sessions.getMessages(sessionId, {
    editStrategies: [
      { type: "token_limit", params: { limit_tokens: 50000 } },
      { type: "remove_tool_result", params: { keep_recent_n_tool_results: 3 } },
      { type: "remove_tool_call_params", params: { keep_recent_n_tool_calls: 5 } }
    ]
  });
}
```

## Strategy Reference

| Strategy | Purpose | Parameters |
|----------|---------|------------|
| `token_limit` | Limit total tokens | `limit_tokens` |
| `remove_tool_result` | Remove old tool responses | `keep_recent_n_tool_results` |
| `remove_tool_call_params` | Remove old tool call params | `keep_recent_n_tool_calls` |
