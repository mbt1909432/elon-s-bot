// Channel Chat API - For Discord/Telegram/Feishu integrations
// Uses API key authentication instead of Supabase auth

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
import { getMemoryContext, consolidateMemory } from '@/lib/memory-consolidation';
import {
  createSkillContext,
  getDefaultSkillIds,
} from '@/lib/acontext/skill-tools';
import type { ToolExecutionContext } from '@/lib/types/acontext';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// Create Supabase admin client for channel operations
function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  }
  if (!serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// API Key validation
function validateApiKey(apiKey: string | null): boolean {
  const validKey = process.env.CHANNEL_API_KEY;
  if (!validKey) {
    console.warn('CHANNEL_API_KEY not configured - allowing all requests');
    return true;
  }
  return apiKey === validKey;
}

// Get or create a virtual user for channel platforms
async function getOrCreateChannelUser(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  platform: string,
  platformUserId: string,
  platformUserName?: string
): Promise<{ userId: string; userEmail: string }> {
  // Try to find existing user by platform_user_id in user_metadata
  const { data: existingUsers, error: searchError } = await supabase.auth.admin.listUsers();

  if (searchError) {
    console.error('Error listing users:', searchError);
    throw new Error(`Failed to search users: ${searchError.message}`);
  }

  // Find user with matching platform_user_id in metadata
  const existingUser = existingUsers.users.find(
    u => u.user_metadata?.platform_user_id === platformUserId &&
         u.user_metadata?.platform === platform
  );

  if (existingUser) {
    console.log('Found existing channel user:', existingUser.id);
    return {
      userId: existingUser.id,
      userEmail: existingUser.email || '',
    };
  }

  // Create new virtual user
  const virtualEmail = `${platform}_${platformUserId}@channels.elonsbot.local`;
  console.log('Creating new channel user with email:', virtualEmail);

  const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
    email: virtualEmail,
    email_confirm: true,
    user_metadata: {
      platform,
      platform_user_id: platformUserId,
      platform_user_name: platformUserName,
      is_channel_user: true,
    },
  });

  if (createError) {
    console.error('Error creating user:', createError);
    throw new Error(`Failed to create channel user: ${createError.message}`);
  }

  if (!newUser.user) {
    throw new Error('Failed to create channel user: No user returned');
  }

  console.log('Created new channel user:', newUser.user.id);

  return {
    userId: newUser.user.id,
    userEmail: virtualEmail,
  };
}

// Get or create conversation for channel
async function getOrCreateChannelConversation(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
  userEmail: string,
  platform: string,
  platformChatId: string
): Promise<{
  id: string;
  sessionId: string;
  diskId: string;
  systemPrompt?: string;
  title?: string;
}> {
  // Check if conversation exists for this channel
  const { data: existingConv } = await supabase
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    .eq('metadata->>platform_chat_id', platformChatId)
    .single();

  if (existingConv) {
    return {
      id: existingConv.id,
      sessionId: existingConv.acontext_session_id,
      diskId: existingConv.acontext_disk_id,
      systemPrompt: existingConv.system_prompt ?? undefined,
      title: existingConv.title ?? undefined,
    };
  }

  // Create new conversation using existing logic
  const conversation = await getOrCreateConversation(userId, userEmail);

  // Update with channel metadata
  await supabase
    .from('conversations')
    .update({
      metadata: {
        platform,
        platform_chat_id: platformChatId,
      },
    })
    .eq('id', conversation.id);

  return {
    id: conversation.id,
    sessionId: conversation.sessionId,
    diskId: conversation.diskId,
    systemPrompt: conversation.systemPrompt ?? undefined,
    title: conversation.title ?? undefined,
  };
}

export async function POST(request: NextRequest) {
  const requestId = `channel-chat-${Date.now()}`;
  console.log(`\n[${requestId}] ========== Channel Chat API Start ==========`);

  try {
    // Validate API key
    const apiKey = request.headers.get('X-Channel-API-Key');
    if (!validateApiKey(apiKey)) {
      console.log(`[${requestId}] Error: Invalid API key`);
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
      console.log(`[${requestId}] Error: Missing required fields`);
      return NextResponse.json(
        { error: 'Missing required fields: platform, platformUserId, platformChatId, message' },
        { status: 400 }
      );
    }

    // Get Supabase admin client
    const supabase = getSupabaseAdmin();

    // Get or create virtual user for this channel user
    const { userId, userEmail } = await getOrCreateChannelUser(
      supabase,
      platform,
      platformUserId,
      platformUserName
    );

    console.log(`[${requestId}] User:`, { userId, userEmail });

    // Get or create conversation
    const conversation = await getOrCreateChannelConversation(
      supabase,
      userId,
      userEmail,
      platform,
      platformChatId
    );

    console.log(`[${requestId}] Conversation:`, {
      id: conversation.id,
      sessionId: conversation.sessionId,
    });

    // Load history from Acontext
    const history = await loadChatHistory(conversation.sessionId);
    console.log(`[${requestId}] History loaded: ${history.length} messages`);

    // Store user message
    await storeUserMessage(conversation.sessionId, message);

    // Build messages for LLM
    const memoryContext = await getMemoryContext(userId);
    const defaultSkillIds = getDefaultSkillIds();
    const skillContext = defaultSkillIds.length > 0
      ? await createSkillContext(defaultSkillIds)
      : null;

    let systemPrompt = conversation.systemPrompt || getDefaultSystemPrompt();
    if (memoryContext) {
      systemPrompt = `${systemPrompt}\n\n---\n\n${memoryContext}`;
    }
    if (skillContext?.skillsContext) {
      systemPrompt = `${systemPrompt}\n\n---\n\n# Available Skills\n\n${skillContext.skillsContext}`;
    }

    const llmMessages = toOpenAIMessages(history, systemPrompt);
    llmMessages.push({ role: 'user', content: message });

    // Create LLM client and stream
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

    // Collect full response (non-streaming for channels)
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

      // Store assistant message with tool_calls
      await storeAssistantMessage(conversation.sessionId, fullContent, toolCalls);

      // Build tool context
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

      // Execute tools and collect results
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

      // Get final response after tool execution
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
        stream: false,
      });

      const finalContent = followUpStream.choices[0]?.message?.content || '';
      fullContent = finalContent;

      if (finalContent) {
        await storeAssistantMessage(conversation.sessionId, finalContent);
      }
    } else {
      // No tool calls - just store assistant message
      await storeAssistantMessage(conversation.sessionId, fullContent);
    }

    // Update title if needed
    if (!conversation.title || conversation.title === 'New Conversation') {
      const title = message.slice(0, 50) + (message.length > 50 ? '...' : '');
      updateConversationTitle(conversation.id, title);
    }

    // Trigger memory consolidation
    if (toolCalls.length === 0) {
      void consolidateMemory(userId, conversation.sessionId, conversation.id).catch(err => {
        console.error(`[${requestId}] Memory consolidation failed:`, err);
      });
    }

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
