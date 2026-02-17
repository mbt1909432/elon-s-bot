/**
 * OpenAI client with Acontext integration
 * Extends the minimal client with:
 * - Tool execution context (diskId, sessionId)
 * - Message storage after each turn
 * - Context loading for conversation history
 *
 * Dependencies: openai
 * Copy to your project and adjust as needed.
 */

import OpenAI from "openai";
import type {
  ChatMessage,
  LLMConfig,
  ToolInvocation,
  ToolExecutionContext,
} from "./types";
import { isDiskToolName, executeDiskTool } from "./disk-tools";

// ============ Client Creation ============

export function createOpenAIClient(config: LLMConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.endpoint,
  });
}

// ============ Message Format Conversion ============

function messagesToOpenAIFormat(
  messages: ChatMessage[]
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((msg) => {
    if (msg.role === "system") {
      return { role: "system", content: msg.content as string };
    }
    if (msg.role === "user") {
      // Support Vision API format (content as array)
      if (Array.isArray(msg.content)) {
        return {
          role: "user",
          content: msg.content as OpenAI.Chat.Completions.ChatCompletionContentPart[],
        };
      }
      return { role: "user", content: msg.content as string };
    }
    if (msg.role === "assistant") {
      return {
        role: "assistant",
        content: msg.content as string,
        ...(msg.tool_calls && { tool_calls: msg.tool_calls }),
      };
    }
    if (msg.role === "tool") {
      return {
        role: "tool",
        tool_call_id: msg.tool_call_id!,
        content: msg.content as string,
      };
    }
    return { role: "assistant", content: String(msg.content) };
  });
}

// ============ Tool Execution ============

async function executeToolCall(
  toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
  context: ToolExecutionContext
): Promise<unknown> {
  if (toolCall.type !== "function" || !toolCall.function) {
    throw new Error(`Unsupported tool call type: ${toolCall.type}`);
  }

  const { name, arguments: argsJson } = toolCall.function;
  const args = JSON.parse(argsJson || "{}");

  // Route to disk tools
  if (isDiskToolName(name)) {
    return executeDiskTool(context, name, args);
  }

  // Add your custom tools here:
  // if (name === "my_custom_tool") {
  //   return myCustomToolHandler(args, context);
  // }

  throw new Error(`Unknown tool: ${name}`);
}

// ============ Non-Streaming Chat ============

export async function chatCompletion(
  client: OpenAI,
  messages: ChatMessage[],
  config: LLMConfig,
  tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [],
  context?: ToolExecutionContext,
  maxIterations: number = 10
): Promise<{ message: string; toolCalls?: ToolInvocation[] }> {
  const openAIMessages = messagesToOpenAIFormat(messages);
  const allToolCalls: ToolInvocation[] = [];
  let currentMessages = openAIMessages;

  for (let i = 0; i < maxIterations; i++) {
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
      model: config.model ?? "gpt-4o-mini",
      messages: currentMessages,
      temperature: config.temperature ?? 0.7,
      max_tokens: config.maxTokens ?? 2048,
    };

    if (tools.length > 0) {
      params.tools = tools;
      params.tool_choice = "auto";
    }

    const completion = await client.chat.completions.create(params);
    const assistant = completion.choices[0]?.message;
    if (!assistant) throw new Error("No response from model");

    // No tool calls = final response
    if (!assistant.tool_calls?.length) {
      return {
        message: assistant.content ?? "",
        toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
      };
    }

    // Execute tool calls
    const toolResults: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];
    for (const tc of assistant.tool_calls) {
      const invocation: ToolInvocation = {
        id: tc.id,
        name: tc.function?.name || "unknown",
        arguments: JSON.parse(tc.function?.arguments || "{}"),
        invokedAt: new Date(),
      };

      try {
        const result = context
          ? await executeToolCall(tc, context)
          : { error: "No tool context provided" };
        invocation.result = result;
      } catch (err) {
        invocation.error = err instanceof Error ? err.message : String(err);
      }

      allToolCalls.push(invocation);
      toolResults.push({
        id: tc.id,
        type: "function",
        function: {
          name: tc.function?.name || "unknown",
          arguments: tc.function?.arguments || "{}",
        },
      });
    }

    // Add assistant message and tool results for next iteration
    currentMessages = [
      ...currentMessages,
      assistant,
      ...toolResults.map((tc) => {
        const inv = allToolCalls.find((t) => t.id === tc.id);
        return {
          role: "tool" as const,
          tool_call_id: tc.id,
          content: JSON.stringify(inv?.error ? { error: inv.error } : inv?.result ?? {}),
        };
      }),
    ];
  }

  return {
    message: "Max tool iterations reached.",
    toolCalls: allToolCalls,
  };
}

// ============ Streaming Chat ============

export type StreamEvent =
  | { type: "message"; content: string }
  | { type: "tool_call_start"; toolCall: ToolInvocation }
  | { type: "tool_call_complete"; toolCall: ToolInvocation }
  | { type: "tool_call_error"; toolCall: ToolInvocation }
  | { type: "final_message"; message: string; toolCalls?: ToolInvocation[] };

export async function* chatCompletionStream(
  client: OpenAI,
  messages: ChatMessage[],
  config: LLMConfig,
  tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [],
  context?: ToolExecutionContext,
  maxIterations: number = 10
): AsyncGenerator<StreamEvent> {
  const openAIMessages = messagesToOpenAIFormat(messages);
  const allToolCalls: ToolInvocation[] = [];
  let currentMessages = openAIMessages;

  for (let i = 0; i < maxIterations; i++) {
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
      model: config.model ?? "gpt-4o-mini",
      messages: currentMessages,
      temperature: config.temperature ?? 0.7,
      max_tokens: config.maxTokens ?? 2048,
      stream: true,
    };

    if (tools.length > 0) {
      params.tools = tools;
      params.tool_choice = "auto";
    }

    const stream = await client.chat.completions.create(params);
    let content = "";
    const toolCallsAccumulator: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }> = [];

    // Process stream chunks
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        content += delta.content;
        yield { type: "message", content: delta.content };
      }

      if (delta.tool_calls) {
        for (const d of delta.tool_calls) {
          const idx = d.index ?? 0;
          if (!toolCallsAccumulator[idx]) {
            toolCallsAccumulator[idx] = {
              id: d.id ?? "",
              type: "function",
              function: {
                name: d.function?.name ?? "",
                arguments: d.function?.arguments ?? "",
              },
            };
          } else {
            toolCallsAccumulator[idx].function.arguments += d.function?.arguments ?? "";
          }
        }
      }
    }

    const assistantToolCalls = toolCallsAccumulator.filter(
      (tc) => tc.id && tc.function.name
    );

    // No tool calls = final response
    if (assistantToolCalls.length === 0) {
      yield {
        type: "final_message",
        message: content,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
      };
      return;
    }

    // Execute tool calls
    const toolResults: typeof toolCallsAccumulator = [];
    for (const tc of assistantToolCalls) {
      const invocation: ToolInvocation = {
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || "{}"),
        invokedAt: new Date(),
      };

      yield { type: "tool_call_start", toolCall: invocation };

      try {
        const toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall = {
          id: tc.id,
          type: "function",
          function: tc.function,
        };
        const result = context
          ? await executeToolCall(toolCall, context)
          : { error: "No tool context provided" };
        invocation.result = result;
        allToolCalls.push(invocation);
        yield { type: "tool_call_complete", toolCall: invocation };
        toolResults.push(tc);
      } catch (err) {
        invocation.error = err instanceof Error ? err.message : String(err);
        allToolCalls.push(invocation);
        yield { type: "tool_call_error", toolCall: invocation };
        toolResults.push(tc);
      }
    }

    // Add assistant message and tool results for next iteration
    currentMessages = [
      ...currentMessages,
      {
        role: "assistant" as const,
        content,
        tool_calls: toolResults.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: tc.function,
        })),
      },
      ...toolResults.map((tc) => {
        const inv = allToolCalls.find((t) => t.id === tc.id);
        return {
          role: "tool" as const,
          tool_call_id: tc.id,
          content: JSON.stringify(inv?.error ? { error: inv.error } : inv?.result ?? {}),
        };
      }),
    ];
  }

  yield {
    type: "final_message",
    message: "Max tool iterations reached.",
    toolCalls: allToolCalls,
  };
}

// ============ SSE API Route Helper ============

/**
 * Helper for creating SSE API routes in Next.js
 *
 * @example
 * // app/api/chat/route.ts
 * export async function POST(req: Request) {
 *   const { messages, sessionId, diskId } = await req.json();
 *   return createSSEResponse(client, messages, config, tools, { diskId, sessionId });
 * }
 */
export function createSSEResponse(
  client: OpenAI,
  messages: ChatMessage[],
  config: LLMConfig,
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  context?: ToolExecutionContext
): Response {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        for await (const event of chatCompletionStream(client, messages, config, tools, context)) {
          switch (event.type) {
            case "message":
              send("message", { content: event.content });
              break;
            case "tool_call_start":
              send("tool_call_start", { toolCall: event.toolCall });
              break;
            case "tool_call_complete":
              send("tool_call_complete", { toolCall: event.toolCall });
              break;
            case "tool_call_error":
              send("tool_call_error", { toolCall: event.toolCall });
              break;
            case "final_message":
              send("done", { message: event.message, toolCalls: event.toolCalls });
              break;
          }
        }
      } catch (e) {
        send("error", { error: String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
