// Chat API - Streaming endpoint with tool execution
// Refactored to use Acontext as PRIMARY message storage

import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import {
  createLLMClient,
  getLLMModel,
  getAllToolSchemas,
  executeTool,
  logToolExecution,
  toOpenAIMessages,
  getDefaultSystemPrompt,
} from '@/lib/openai-client';
import {
  getOrCreateConversation,
  loadChatHistory,
  storeUserMessage,
  storeAssistantMessage,
  storeToolMessage,
  updateConversationTitle,
} from '@/lib/chat-session';
import { getAcontextClient } from '@/lib/acontext/client';
import { getMemoryContext, consolidateMemory } from '@/lib/memory-consolidation';
import {
  createSkillContext,
  getDefaultSkillIds,
} from '@/lib/acontext/skill-tools';
import type { ChatMessage, ToolExecutionContext } from '@/lib/types/acontext';

// ============================================
// Chat API Handler
// ============================================

export async function POST(request: NextRequest) {
  const requestId = `chat-${Date.now()}`;
  console.log(`\n[${requestId}] ========== Chat API Start ==========`);

  try {
    // Parse request body
    const body = await request.json();
    const { conversation_id, message, model: _requestedModel } = body;

    console.log(`[${requestId}] Request:`, {
      message: message?.substring(0, 50),
      conversation_id,
    });

    if (!message || typeof message !== 'string') {
      console.log(`[${requestId}] Error: Message is required`);
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // Authenticate user
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      console.log(`[${requestId}] Error: Unauthorized -`, authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log(`[${requestId}] User:`, user.email);

    // ==========================================
    // Step 1: Get or Create Conversation (1:1:1 binding)
    // ==========================================
    const conversation = await getOrCreateConversation(
      user.id,
      user.email || '',
      conversation_id
    );

    console.log(`[${requestId}] Conversation:`, {
      id: conversation.id,
      sessionId: conversation.sessionId,
      diskId: conversation.diskId,
    });

    // ==========================================
    // Step 2: Load History from Acontext (NOT Supabase!)
    // ==========================================
    const history = await loadChatHistory(conversation.sessionId);
    console.log(`[${requestId}] History loaded: ${history.length} messages`);

    // ==========================================
    // Step 3: Store User Message to Acontext
    // ==========================================
    await storeUserMessage(conversation.sessionId, message);
    console.log(`[${requestId}] User message stored to Acontext`);

    // ==========================================
    // Step 4: Build Messages for LLM
    // ==========================================
    // Load user's long-term memory
    const memoryContext = await getMemoryContext(user.id);

    // Load skill context (if skills are configured)
    const defaultSkillIds = getDefaultSkillIds();
    const skillContext = defaultSkillIds.length > 0
      ? await createSkillContext(defaultSkillIds)
      : null;

    let systemPrompt = conversation.systemPrompt || getDefaultSystemPrompt();

    // Append memory to system prompt if exists
    if (memoryContext) {
      systemPrompt = `${systemPrompt}\n\n---\n\n${memoryContext}`;
    }

    // Append skill context if skills are mounted
    if (skillContext?.skillsContext) {
      systemPrompt = `${systemPrompt}\n\n---\n\n# Available Skills\n\n${skillContext.skillsContext}`;
      console.log(`[${requestId}] Skills mounted:`, skillContext.mountedSkillIds);
    }

    const llmMessages = toOpenAIMessages(history, systemPrompt);

    // Add current user message
    llmMessages.push({ role: 'user', content: message });

    // ==========================================
    // Step 5: Create LLM Stream
    // ==========================================
    const llm = createLLMClient();
    const model = getLLMModel();
    const tools = getAllToolSchemas();

    console.log(`[${requestId}] Model: ${model}`);
    console.log(`[${requestId}] Tools available:`, tools.map(t => t.function.name));

    const stream = await llm.chat.completions.create({
      model,
      messages: llmMessages,
      tools,
      tool_choice: 'auto',
      stream: true,
    });

    // ==========================================
    // Step 6: Create SSE Stream
    // ==========================================
    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        let fullContent = '';
        const toolCalls: Array<{
          id: string;
          type: 'function';
          function: { name: string; arguments: string };
        }> = [];

        try {
          // Send conversation ID first
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'conversation_id', conversation_id: conversation.id })}\n\n`)
          );

          // ==========================================
          // Step 7: Process LLM Stream
          // ==========================================
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;
            if (!delta) continue;

            // Handle content
            if (delta.content) {
              fullContent += delta.content;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'content', content: delta.content })}\n\n`)
              );
            }

            // Handle tool calls
            if (delta.tool_calls) {
              for (const toolCallDelta of delta.tool_calls) {
                const index = toolCallDelta.index;

                if (toolCallDelta.id) {
                  toolCalls[index] = {
                    id: toolCallDelta.id,
                    type: 'function',
                    function: { name: '', arguments: '' },
                  };
                }

                if (toolCallDelta.function?.name && toolCalls[index]) {
                  toolCalls[index].function.name = toolCallDelta.function.name;
                }

                if (toolCallDelta.function?.arguments && toolCalls[index]) {
                  toolCalls[index].function.arguments += toolCallDelta.function.arguments;
                }
              }
            }
          }

          console.log(`[${requestId}] Stream ended. Tool calls: ${toolCalls.length}`);

          // ==========================================
          // Step 8: Execute Tools (if any)
          // ==========================================
          if (toolCalls.length > 0) {
            console.log(`[${requestId}] Tool call names:`, toolCalls.map(tc => tc.function.name));

            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'tool_calls_start', count: toolCalls.length })}\n\n`)
            );

            // Store assistant message with tool_calls FIRST
            await storeAssistantMessage(conversation.sessionId, fullContent, toolCalls);
            console.log(`[${requestId}] Assistant message (with tool_calls) stored`);

            // Build tool execution context
            const acontextClient = getAcontextClient();
            const toolContext: ToolExecutionContext = {
              acontextClient,
              diskId: conversation.diskId,
              sessionId: conversation.sessionId,
              userId: user.id,
              conversationId: conversation.id,
              skillIds: skillContext?.mountedSkillIds || [],
              supabase,
            };

            // Execute each tool and store result IMMEDIATELY
            const toolResults: Array<{ tool_call_id: string; content: string }> = [];

            for (const toolCall of toolCalls) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'tool_call', tool_call: toolCall })}\n\n`)
              );

              // Execute tool
              const startTime = Date.now();
              const result = await executeTool(toolCall, toolContext);
              const executionTime = Date.now() - startTime;

              // Log tool execution (fire and forget)
              logToolExecution(
                conversation.id,
                toolCall.function.name,
                JSON.parse(toolCall.function.arguments || '{}'),
                result.output,
                result.success ? 'success' : 'error',
                executionTime,
                result.error
              );

              // CRITICAL: Store tool result message IMMEDIATELY
              const toolResultContent = JSON.stringify(result.output || { error: result.error });
              await storeToolMessage(conversation.sessionId, toolCall.id, toolResultContent);
              console.log(`[${requestId}] Tool result stored for: ${toolCall.function.name}`);

              toolResults.push({
                tool_call_id: toolCall.id,
                content: toolResultContent,
              });

              // Stream tool result
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({
                  type: 'tool_result',
                  tool_call_id: toolCall.id,
                  output: result.output,
                })}\n\n`)
              );
            }

            // ==========================================
            // Step 9: Get Final Response After Tools
            // ==========================================
            // Build messages for follow-up: history + user + assistant + tool results
            const followUpMessages = [...llmMessages];
            followUpMessages.push({
              role: 'assistant',
              content: fullContent || null,
              tool_calls: toolCalls,
            });

            for (const tr of toolResults) {
              followUpMessages.push({
                role: 'tool',
                tool_call_id: tr.tool_call_id,
                content: tr.content,
              });
            }

            const followUpStream = await llm.chat.completions.create({
              model,
              messages: followUpMessages,
              stream: true,
            });

            let finalContent = '';
            for await (const chunk of followUpStream) {
              const delta = chunk.choices[0]?.delta;
              if (delta?.content) {
                finalContent += delta.content;
                fullContent += delta.content;
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: 'content', content: delta.content })}\n\n`)
                );
              }
            }

            // Store final assistant message
            if (finalContent) {
              await storeAssistantMessage(conversation.sessionId, finalContent);
              console.log(`[${requestId}] Final assistant message stored`);
            }
          } else {
            // No tool calls - just store assistant message
            await storeAssistantMessage(conversation.sessionId, fullContent);
            console.log(`[${requestId}] Assistant message stored`);
          }

          // ==========================================
          // Step 10: Update Conversation Title (fire and forget)
          // ==========================================
          if (!conversation.title || conversation.title === 'New Conversation') {
            const title = message.slice(0, 50) + (message.length > 50 ? '...' : '');
            updateConversationTitle(conversation.id, title);
          }

          // ==========================================
          // Step 11: Memory Consolidation (fire and forget)
          // ==========================================
          // Trigger consolidation when no tool calls (conversation turn complete)
          if (toolCalls.length === 0) {
            void consolidateMemory(user.id, conversation.sessionId, conversation.id)
              .then((consolidated) => {
                if (consolidated) {
                  console.log(`[${requestId}] Memory consolidation completed`);
                }
              })
              .catch((err) => {
                console.error(`[${requestId}] Memory consolidation failed:`, err);
              });
          }

          // Send done event
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'done', conversation_id: conversation.id })}\n\n`)
          );
        } catch (error) {
          console.error(`[${requestId}] Stream error:`, error);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({
              type: 'error',
              error: error instanceof Error ? error.message : 'Stream error',
            })}\n\n`)
          );
        } finally {
          controller.close();
          console.log(`[${requestId}] ========== Chat API End ==========`);
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
