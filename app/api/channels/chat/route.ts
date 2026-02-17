// Channel Chat API - For Discord/Telegram/Feishu integrations
// Uses existing user management with metadata to track channel users

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
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
import {
  createSkillContext,
  getDefaultSkillIds,
} from '@/lib/acontext/skill-tools';
import type { ToolExecutionContext } from '@/lib/types/acontext';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// API Key validation
function validateApiKey(apiKey: string | null): boolean {
  const validKey = process.env.CHANNEL_API_KEY;
  if (!validKey) {
    console.warn('CHANNEL_API_KEY not configured - allowing all requests');
    return true;
  }
  return apiKey === validKey;
}

// Create Supabase admin client
function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function POST(request: NextRequest) {
  const requestId = `channel-chat-${Date.now()}`;
  console.log(`\n[${requestId}] ========== Channel Chat API Start ==========`);

  try {
    // Validate API key
    const apiKey = request.headers.get('X-Channel-API-Key');
    if (!validateApiKey(apiKey)) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
    }

    // Parse request
    const body = await request.json();
    const { platform, platformUserId, platformUserName, platformChatId, message } = body;

    console.log(`[${requestId}] Request:`, {
      platform,
      platformUserId,
      platformChatId,
      message: message?.substring(0, 50),
    });

    if (!message || !platform || !platformUserId || !platformChatId) {
      return NextResponse.json(
        { error: 'Missing required fields: platform, platformUserId, platformChatId, message' },
        { status: 400 }
      );
    }

    // Get Supabase admin client
    const supabase = getSupabaseAdmin();

    // Create virtual email for this channel user
    const virtualEmail = `${platform}_${platformUserId}@channels.elonsbot.local`;

    // Check if user already exists
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    let userId: string;

    const existingUser = existingUsers?.users?.find(
      u => u.user_metadata?.platform_user_id === platformUserId &&
           u.user_metadata?.platform === platform
    );

    if (existingUser) {
      userId = existingUser.id;
      console.log(`[${requestId}] Found existing user:`, userId);
    } else {
      // Create new user for this channel
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: virtualEmail,
        email_confirm: true,
        user_metadata: {
          platform,
          platform_user_id: platformUserId,
          platform_user_name: platformUserName,
          platform_chat_id: platformChatId,
          is_channel_user: true,
        },
      });

      if (createError) {
        console.error('Error creating user:', createError);
        throw new Error(`Failed to create user: ${createError.message}`);
      }

      if (!newUser?.user) {
        throw new Error('Failed to create user: no user returned');
      }

      userId = newUser.user.id;
      console.log(`[${requestId}] Created new user:`, userId);
    }

    // Use existing conversation management
    // This handles Acontext session/disk creation properly
    const conversation = await getOrCreateConversation(userId, virtualEmail);

    console.log(`[${requestId}] Conversation:`, {
      id: conversation.id,
      sessionId: conversation.sessionId,
    });

    // Update conversation metadata with channel info
    await supabase
      .from('conversations')
      .update({
        metadata: {
          platform,
          platform_user_id: platformUserId,
          platform_user_name: platformUserName,
          platform_chat_id: platformChatId,
        },
      })
      .eq('id', conversation.id);

    // Load history from Acontext
    const history = await loadChatHistory(conversation.sessionId);
    console.log(`[${requestId}] History loaded: ${history.length} messages`);

    // Store user message
    await storeUserMessage(conversation.sessionId, message);

    // Build messages for LLM
    const defaultSkillIds = getDefaultSkillIds();
    const skillContext = defaultSkillIds.length > 0
      ? await createSkillContext(defaultSkillIds)
      : null;

    let systemPrompt = conversation.systemPrompt || getDefaultSystemPrompt();
    systemPrompt = `${systemPrompt}\n\nYou are responding to a user on ${platform}. Their username is ${platformUserName}.`;
    if (skillContext?.skillsContext) {
      systemPrompt = `${systemPrompt}\n\n---\n\n# Available Skills\n\n${skillContext.skillsContext}`;
    }

    const llmMessages = toOpenAIMessages(history, systemPrompt);
    llmMessages.push({ role: 'user', content: message });

    // Create LLM client
    const llm = createLLMClient();
    const model = getLLMModel();
    const tools = getAllToolSchemas();

    console.log(`[${requestId}] Calling LLM: ${model}`);

    const stream = await llm.chat.completions.create({
      model,
      messages: llmMessages,
      tools,
      tool_choice: 'auto',
      stream: true,
    });

    // Collect full response
    let fullContent = '';
    const toolCalls: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }> = [];

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        fullContent += delta.content;
      }

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

    // Execute tools if any
    if (toolCalls.length > 0) {
      console.log(`[${requestId}] Executing tools:`, toolCalls.map(tc => tc.function.name));

      await storeAssistantMessage(conversation.sessionId, fullContent, toolCalls);

      const acontextClient = getAcontextClient();
      const toolContext: ToolExecutionContext = {
        acontextClient,
        diskId: conversation.diskId,
        sessionId: conversation.sessionId,
        userId,
        conversationId: conversation.id,
        skillIds: skillContext?.mountedSkillIds || [],
        supabase: supabase as any,
      };

      const toolResults: Array<{ tool_call_id: string; content: string }> = [];

      for (const toolCall of toolCalls) {
        const startTime = Date.now();
        const result = await executeTool(toolCall, toolContext);
        const executionTime = Date.now() - startTime;

        logToolExecution(
          conversation.id,
          toolCall.function.name,
          JSON.parse(toolCall.function.arguments || '{}'),
          result.output,
          result.success ? 'success' : 'error',
          executionTime,
          result.error
        );

        const toolResultContent = JSON.stringify(result.output || { error: result.error });
        await storeToolMessage(conversation.sessionId, toolCall.id, toolResultContent);

        toolResults.push({
          tool_call_id: toolCall.id,
          content: toolResultContent,
        });
      }

      // Get final response
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

      const followUpResponse = await llm.chat.completions.create({
        model,
        messages: followUpMessages,
        stream: false,
      });

      const finalContent = followUpResponse.choices[0]?.message?.content || '';
      fullContent = finalContent;

      if (finalContent) {
        await storeAssistantMessage(conversation.sessionId, finalContent);
      }
    } else {
      await storeAssistantMessage(conversation.sessionId, fullContent);
    }

    // Update conversation title
    await updateConversationTitle(conversation.id, message.slice(0, 50));

    console.log(`[${requestId}] Response length: ${fullContent.length}`);

    return NextResponse.json({
      success: true,
      content: fullContent,
      conversation_id: conversation.id,
    });
  } catch (error) {
    console.error(`[${requestId}] Error:`, error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
