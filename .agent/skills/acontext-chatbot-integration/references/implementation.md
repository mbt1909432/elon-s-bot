# Acontext Implementation Details

Complete implementation patterns for Acontext integration.

## Table of Contents

1. [Types Definition](#types-definition)
2. [Configuration](#configuration)
3. [Acontext Client Wrapper](#acontext-client-wrapper)
4. [OpenAI Client with Tools](#openai-client-with-tools)
5. [Next.js API Route](#nextjs-api-route)
6. [Frontend Integration](#frontend-integration)

## Types Definition

```ts
// types.ts

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentPart[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface LLMConfig {
  endpoint: string;
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AcontextConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface ToolInvocation {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: string;
  invokedAt: Date;
}

export interface ToolExecutionContext {
  acontextClient: AcontextClientLike;
  diskId?: string;
  sandboxId?: string;
  sessionId?: string;
  userId?: string;
}

export type EditStrategy =
  | { type: "token_limit"; params: { limit_tokens: number } }
  | { type: "remove_tool_result"; params: { keep_recent_n_tool_results?: number } }
  | { type: "remove_tool_call_params"; params: { keep_recent_n_tool_calls?: number } };
```

## Configuration

```ts
// config.ts

import type { LLMConfig, AcontextConfig } from "./types";

export function getLLMConfig(): LLMConfig {
  const endpoint = process.env.OPENAI_LLM_ENDPOINT;
  const apiKey = process.env.OPENAI_LLM_API_KEY;

  if (!endpoint || !apiKey) {
    throw new Error("Missing LLM configuration");
  }

  return {
    endpoint,
    apiKey,
    model: process.env.OPENAI_LLM_MODEL ?? "gpt-4o-mini",
    temperature: parseFloat(process.env.OPENAI_LLM_TEMPERATURE ?? "0.7"),
    maxTokens: parseInt(process.env.OPENAI_LLM_MAX_TOKENS ?? "2048", 10),
  };
}

export function getAcontextConfig(): AcontextConfig | null {
  const apiKey = process.env.ACONTEXT_API_KEY;
  if (!apiKey) return null;

  return {
    apiKey,
    baseUrl: process.env.ACONTEXT_BASE_URL ?? "https://api.acontext.com/api/v1",
  };
}
```

## Acontext Client Wrapper

```ts
// acontext-client.ts

import { AcontextClient, FileUpload } from "@acontext/acontext";
import type { AcontextConfig, ChatMessage, EditStrategy } from "./types";

export function createAcontextClient(config: AcontextConfig | null) {
  if (!config) return null;
  // baseUrl is optional - only needed for self-hosted Acontext
  return new AcontextClient({ apiKey: config.apiKey });
}

// Session Management
export async function createSession(client: any, options?: {
  user?: string;
  useUuid?: string;
}) {
  return client.sessions.create({
    user: options?.user,
    useUuid: options?.useUuid
  });
}

export async function storeMessage(
  client: any,
  sessionId: string,
  message: ChatMessage
) {
  await client.sessions.storeMessage(sessionId, message);
}

export async function loadMessages(
  client: any,
  sessionId: string,
  options?: { limit?: number; editStrategies?: EditStrategy[] }
) {
  const result = await client.sessions.getMessages(sessionId, options);
  return result?.items?.filter((m: any) => m.role !== "tool") || [];
}

// Disk Management
export async function createDisk(client: any) {
  return client.disks.create();
}

export async function getOrCreateDisk(client: any, existingDiskId?: string) {
  if (existingDiskId) return existingDiskId;
  const disks = await client.disks.list();
  if (disks?.items?.length) return disks.items[0].id;
  const newDisk = await client.disks.create();
  return newDisk.id;
}

// Artifact Operations
export async function uploadArtifact(
  client: any,
  diskId: string,
  options: { filename: string; content: Buffer; mimeType: string; path?: string; meta?: Record<string, any> }
) {
  return client.disks.artifacts.upsert(diskId, {
    file: new FileUpload(options.filename, options.content, options.mimeType),
    file_path: options.path || "/",
    meta: options.meta
  });
}

export async function getArtifact(
  client: any,
  diskId: string,
  filePath: string
) {
  const parts = filePath.split("/").filter(Boolean);
  const filename = parts[parts.length - 1];
  const dirPath = parts.length > 1 ? "/" + parts.slice(0, -1).join("/") : "/";

  return client.disks.artifacts.get(diskId, {
    file_path: dirPath,
    filename,
    with_content: true,
    with_public_url: true
  });
}
```

## OpenAI Client with Tools

```ts
// openai-client.ts

import OpenAI from "openai";
import type { ChatMessage, LLMConfig, ToolInvocation, ToolExecutionContext } from "./types";
import { DISK_TOOLS, SANDBOX_TOOLS } from "@acontext/acontext";

const DISK_TOOL_NAMES = ["write_file_disk", "read_file_disk", "replace_string_disk",
                         "list_disk", "download_file_disk", "grep_disk", "glob_disk"];

const SANDBOX_TOOL_NAMES = ["bash_execution_sandbox", "text_editor_sandbox", "export_file_sandbox"];

function isDiskToolName(name: string): boolean {
  return DISK_TOOL_NAMES.includes(name);
}

function isSandboxToolName(name: string): boolean {
  return SANDBOX_TOOL_NAMES.includes(name);
}

export function createOpenAIClient(config: LLMConfig): OpenAI {
  return new OpenAI({ apiKey: config.apiKey, baseURL: config.endpoint });
}

export async function* chatCompletionStream(
  client: OpenAI,
  messages: ChatMessage[],
  config: LLMConfig,
  tools: any[],
  context?: ToolExecutionContext,
  maxIterations: number = 10
): AsyncGenerator<any> {
  let currentMessages = messagesToOpenAIFormat(messages);
  const allToolCalls: ToolInvocation[] = [];

  for (let i = 0; i < maxIterations; i++) {
    const stream = await client.chat.completions.create({
      model: config.model ?? "gpt-4o-mini",
      messages: currentMessages,
      temperature: config.temperature ?? 0.7,
      max_tokens: config.maxTokens ?? 2048,
      stream: true,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? "auto" : undefined,
    });

    let content = "";
    const toolCallsAccumulator: any[] = [];

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        content += delta.content;
        yield { type: "message", content: delta.content };
      }
      if (delta?.tool_calls) {
        for (const d of delta.tool_calls) {
          const idx = d.index ?? 0;
          if (!toolCallsAccumulator[idx]) {
            toolCallsAccumulator[idx] = {
              id: d.id ?? "",
              type: "function",
              function: { name: d.function?.name ?? "", arguments: d.function?.arguments ?? "" }
            };
          } else {
            toolCallsAccumulator[idx].function.arguments += d.function?.arguments ?? "";
          }
        }
      }
    }

    const assistantToolCalls = toolCallsAccumulator.filter(tc => tc.id && tc.function.name);

    if (assistantToolCalls.length === 0) {
      yield { type: "final_message", message: content, toolCalls: allToolCalls };
      return;
    }

    // Execute tool calls
    for (const tc of assistantToolCalls) {
      const invocation: ToolInvocation = {
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || "{}"),
        invokedAt: new Date()
      };

      yield { type: "tool_call_start", toolCall: invocation };

      try {
        const result = await executeToolCall(tc, context);
        invocation.result = result;
        allToolCalls.push(invocation);
        yield { type: "tool_call_complete", toolCall: invocation };
      } catch (err) {
        invocation.error = String(err);
        allToolCalls.push(invocation);
        yield { type: "tool_call_error", toolCall: invocation };
      }
    }

    // CRITICAL: Save assistant message with tool_calls
    if (context?.sessionId) {
      await context.acontextClient.sessions.storeMessage(context.sessionId, {
        role: "assistant",
        content: content,
        tool_calls: assistantToolCalls.map(tc => ({
          id: tc.id,
          type: "function",
          function: tc.function
        }))
      });

      // CRITICAL: Save tool response messages for each tool call
      for (const invocation of allToolCalls) {
        await context.acontextClient.sessions.storeMessage(context.sessionId, {
          role: "tool",
          tool_call_id: invocation.id,
          content: JSON.stringify(invocation.error ? { error: invocation.error } : invocation.result)
        });
      }
    }

    // Add messages for next iteration
    currentMessages = [
      ...currentMessages,
      { role: "assistant", content, tool_calls: assistantToolCalls },
      ...assistantToolCalls.map(tc => {
        const inv = allToolCalls.find(t => t.id === tc.id);
        return {
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(inv?.error ? { error: inv.error } : inv?.result ?? {})
        };
      })
    ];
  }

  yield { type: "final_message", message: "Max iterations reached", toolCalls: allToolCalls };
}

async function executeToolCall(tc: any, context?: ToolExecutionContext) {
  const args = JSON.parse(tc.function.arguments || "{}");

  if (isDiskToolName(tc.function.name) && context?.diskId) {
    const ctx = DISK_TOOLS.format_context(context.acontextClient, context.diskId);
    return DISK_TOOLS.execute_tool(ctx, tc.function.name, args);
  }

  if (isSandboxToolName(tc.function.name) && context?.sandboxId && context?.diskId) {
    const ctx = SANDBOX_TOOLS.format_context(
      context.acontextClient,
      context.sandboxId,
      context.diskId
    );
    return SANDBOX_TOOLS.execute_tool(ctx, tc.function.name, args);
  }

  throw new Error(`Unknown tool: ${tc.function.name}`);
}
```

## Next.js API Route

```ts
// app/api/chat/route.ts

import { getLLMConfig, getAcontextConfig } from "@/lib/config";
import { createOpenAIClient, chatCompletionStream } from "@/lib/openai-client";
import { createAcontextClient, createSession, createDisk, storeMessage } from "@/lib/acontext-client";
import { DISK_TOOLS, SANDBOX_TOOLS } from "@acontext/acontext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { messages, sessionId, diskId } = await req.json();

  const acontextConfig = getAcontextConfig();
  if (!acontextConfig) {
    return Response.json({ error: "Acontext not configured" }, { status: 500 });
  }

  const llmClient = createOpenAIClient(getLLMConfig());
  const acontextClient = createAcontextClient(acontextConfig);

  // Get or create session/disk
  let currentSessionId = sessionId;
  let currentDiskId = diskId;

  if (!currentSessionId) {
    const session = await createSession(acontextClient, {
      user: req.headers.get("x-user-id") || "anonymous@example.com"
    });
    currentSessionId = session.id;
  }

  if (!currentDiskId) {
    const disk = await createDisk(acontextClient);
    currentDiskId = disk.id;
  }

  // Create sandbox for code execution (if needed)
  const sandbox = await acontextClient.sandboxes.create();

  // Store user message
  const userMessage = messages[messages.length - 1];
  if (userMessage?.role === "user") {
    await storeMessage(acontextClient, currentSessionId, userMessage);
  }

  // Get tools from bundles
  const tools = [
    ...DISK_TOOLS.to_openai_tool_schema(),
    ...SANDBOX_TOOLS.to_openai_tool_schema()
  ];

  // Create SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send("session", { sessionId: currentSessionId, diskId: currentDiskId, sandboxId: sandbox.sandbox_id });

      let assistantContent = "";

      try {
        for await (const event of chatCompletionStream(llmClient, messages, getLLMConfig(), tools, {
          acontextClient,
          diskId: currentDiskId,
          sandboxId: sandbox.sandbox_id,
          sessionId: currentSessionId
        })) {
          if (event.type === "message") {
            send("message", { content: event.content });
            assistantContent += event.content;
          } else {
            send(event.type, event);
            if (event.type === "final_message") {
              await storeMessage(acontextClient, currentSessionId, {
                role: "assistant",
                content: assistantContent
              });
            }
          }
        }
      } catch (error) {
        send("error", { error: String(error) });
      } finally {
        // Clean up sandbox
        await acontextClient.sandboxes.kill(sandbox.sandbox_id);
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" }
  });
}
```

## Frontend Integration

```tsx
// components/ChatMessage.tsx

function rewriteDiskPath(content: string, diskId?: string): string {
  // Pattern 1: disk:: prefix
  const diskPattern = /disk::\s*([A-Za-z0-9/_-]+\.(?:png|jpg|jpeg|webp|gif))/gi;
  content = content.replace(diskPattern, (_, path) => {
    const url = `/api/acontext/artifacts/public-url?filePath=${path}${diskId ? `&diskId=${diskId}` : ""}`;
    return `![Image](${url})`;
  });

  // Pattern 2: bracketed paths
  const bracketPattern = /\[([A-Za-z0-9/_-]+\.(?:png|jpg|jpeg|webp|gif))\](?!\()/gi;
  content = content.replace(bracketPattern, (_, path) => {
    const url = `/api/acontext/artifacts/public-url?filePath=${path}${diskId ? `&diskId=${diskId}` : ""}`;
    return `[Open image](${url})`;
  });

  return content;
}

export function ChatMessage({ content, diskId }: { content: string; diskId?: string }) {
  const rewritten = rewriteDiskPath(content, diskId);
  return <Markdown content={rewritten} />;
}
```

```ts
// app/api/acontext/artifacts/public-url/route.ts

import { getAcontextConfig } from "@/lib/config";
import { createAcontextClient, getArtifact } from "@/lib/acontext-client";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const filePath = url.searchParams.get("filePath");
  const diskId = url.searchParams.get("diskId");

  if (!filePath || !diskId) {
    return Response.json({ error: "Missing parameters" }, { status: 400 });
  }

  const acontextClient = createAcontextClient(getAcontextConfig()!);
  const result = await getArtifact(acontextClient, diskId, filePath);

  if (result?.public_url) {
    return Response.json({ publicUrl: result.public_url });
  }

  return Response.json({ error: "Artifact not found" }, { status: 404 });
}
```
