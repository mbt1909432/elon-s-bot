// Channel Chat API - For Discord/Telegram/Feishu integrations
// Simplified: Uses the main user's account with separate conversations per channel

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

// Get the main channel service user ID from database
async function getChannelServiceUser(supabase: ReturnType<typeof createClient>): Promise<string> {
  // Try to find an existing user to use for channel operations
  const { data: existingUser } = await supabase
    .from('profiles')
    .select('id')
    .limit(1)
    .single();

  if (existingUser) {
    console.log('Using existing user for channel operations:', existingUser.id);
    return existingUser.id;
  }

  // If no user exists, get the first user from auth
  const { data: { users } } = await supabase.auth.admin.listUsers();

  if (users && users.length > 0) {
    console.log('Using first auth user for channel operations:', users[0].id);
    return users[0].id;
  }

  throw new Error('No users found in database. Please create a user first by logging into the web app.');
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
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Get the service user (use existing user instead of creating new one)
    const userId = await getChannelServiceUser(supabase);
    const serviceEmail = 'channels@elonsbot.service';

    // Create unique conversation key for this channel
    const channelKey = `${platform}_${platformChatId}`;

    // Check if conversation already exists for this channel
    const { data: existingConv } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_id', userId)
      .eq('metadata->>channel_key', channelKey)
      .single();

    let conversationId: string;
    let sessionId: string;
    let diskId: string;

    if (existingConv && existingConv.acontext_session_id) {
      // Use existing conversation
      conversationId = existingConv.id;
      sessionId = existingConv.acontext_session_id;
      diskId = existingConv.acontext_disk_id || '';
      console.log(`[${requestId}] Using existing conversation:`, conversationId);
    } else {
      // Create new conversation using existing flow
      const conversation = await getOrCreateConversation(userId, serviceEmail);
      conversationId = conversation.id;
      sessionId = conversation.sessionId;
      diskId = conversation.diskId;

      // Update with channel metadata
      await supabase
        .from('conversations')
        .update({
          title: `${platform} - ${platformUserName || 'Unknown'}`,
          metadata: {
            channel_key: channelKey,
            platform,
            platform_user_id: platformUserId,
            platform_user_name: platformUserName,
            platform_chat_id: platformChatId,
          },
        })
        .eq('id', conversationId);

      console.log(`[${requestId}] Created new conversation:`, conversationId);
    }

    // Load history from Acontext
    const history = await loadChatHistory(sessionId);
    console.log(`[${requestId}] History loaded: ${history.length} messages`);

    // Store user message
    await storeUserMessage(sessionId, message);

    // Build messages for LLM
    const defaultSkillIds = getDefaultSkillIds();
    const skillContext = defaultSkillIds.length > 0
      ? await createSkillContext(defaultSkillIds)
      : null;

    let systemPrompt = getDefaultSystemPrompt();
    systemPrompt = `${systemPrompt}\n\nYou are responding to a user named ${platformUserName || 'Unknown'} on ${platform}.`;
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

      await storeAssistantMessage(sessionId, fullContent, toolCalls);

      const acontextClient = getAcontextClient();
      const toolContext: ToolExecutionContext = {
        acontextClient,
        diskId,
        sessionId,
        userId,
        conversationId,
        skillIds: skillContext?.mountedSkillIds || [],
        supabase: supabase as any,
      };

      const toolResults: Array<{ tool_call_id: string; content: string }> = [];

      for (const toolCall of toolCalls) {
        const startTime = Date.now();
        const result = await executeTool(toolCall, toolContext);
        const executionTime = Date.now() - startTime;

        logToolExecution(
          conversationId,
          toolCall.function.name,
          JSON.parse(toolCall.function.arguments || '{}'),
          result.output,
          result.success ? 'success' : 'error',
          executionTime,
          result.error
        );

        const toolResultContent = JSON.stringify(result.output || { error: result.error });
        await storeToolMessage(sessionId, toolCall.id, toolResultContent);

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
        await storeAssistantMessage(sessionId, finalContent);
      }
    } else {
      await storeAssistantMessage(sessionId, fullContent);
    }

    // Update conversation title if new
    if (!existingConv) {
      await updateConversationTitle(conversationId, message.slice(0, 50));
    }

    console.log(`[${requestId}] Response length: ${fullContent.length}`);

    return NextResponse.json({
      success: true,
      content: fullContent,
      conversation_id: conversationId,
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
