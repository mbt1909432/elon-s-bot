# Streaming Response Handling

## SSE Server-Side (API Route)

```ts
export async function POST(req: Request) {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const send = (event: string, data: any) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      send("session", { sessionId, diskId });

      let content = "";
      for await (const chunk of llmStream) {
        const delta = chunk.choices[0]?.delta;

        if (delta?.content) {
          content += delta.content;
          send("message", { content: delta.content });
        }

        if (delta?.tool_calls) {
          // Handle tool calls
        }
      }

      await storeMessage(sessionId, { role: "assistant", content });
      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    }
  });
}
```

## SSE Client-Side (Frontend)

```ts
async function sendMessage(message: string) {
  const response = await fetch("/api/chatbot", {
    method: "POST",
    body: JSON.stringify({
      messages: [...messages, { role: "user", content: message }]
    }),
  });

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split("\n");

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6));

        if (data.type === "message" || data.content) {
          setAssistantContent(prev => prev + data.content);
        } else if (data.sessionId) {
          setSessionId(data.sessionId);
          setDiskId(data.diskId);
        }
      }
    }
  }
}
```
