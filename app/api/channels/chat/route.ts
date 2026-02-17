// Channel Chat API - For Discord/Telegram/Feishu integrations
// Simplified: Uses a single service user for all channel operations
// User isolation is maintained via separate conversations per platform user

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
import { consolidateMemory } from '@/lib/memory-consolidation';
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

// Get or create a channel conversation
// Uses a single service user but maintains separate conversations per platform user
async function getOrCreateChannelConversation(
  platform: string,
  platformUserId: string,
  platformUserName: string,
  platformChatId: string
): Promise<{
  conversationId: string;
  sessionId: string;
  diskId: string;
}> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Create a unique conversation ID based on platform + chat_id
  // This ensures each Discord channel has its own conversation
  const uniqueKey = `${platform}_${platformChatId}`;

  // Check if conversation exists with this channel key
  const { data: existingConv } = await supabase
    .from('conversations')
    .select('*')
    .eq('metadata->>channel_key', uniqueKey)
    .single();

  if (existingConv && existingConv.acontext_session_id && existingConv.acontext_disk_id) {
    console.log('Found existing channel conversation:', existingConv.id);
    return {
      conversationId: existingConv.id,
      sessionId: existingConv.acontext_session_id,
      diskId: existingConv.acontext_disk_id,
    };
  }

  // Create new conversation using the service account
  // We use a fixed service email for all channel operations
  const serviceEmail = 'channels@elonsbot.service';
  const serviceUserId = '00000000-0000-0000-0000-000000000001'; // Fixed service user ID

  // First, ensure the service user exists in the database
  const { data: existingUser } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', serviceUserId)
    .single();

  if (!existingUser) {
    // Create service user profile (doesn't need auth account)
    await supabase.from('profiles').upsert({
      id: serviceUserId,
      email: serviceEmail,
      full_name: 'Channel Service',
    }).select();
  }

  // Create new conversation
  const { data: newConv, error: convError } = await supabase
    .from('conversations')
    .insert({
      user_id: serviceUserId,
      title: `${platform} - ${platformUserName}`,
      model: 'default',
      system_prompt: null,
      metadata: {
        channel_key: uniqueKey,
        platform,
        platform_user_id: platformUserId,
        platform_user_name: platformUserName,
        platform_chat_id: platformChatId,
      },
    })
    .select()
    .single();

  if (convError || !newConv) {
    console.error('Error creating conversation:', convError);
    throw new Error(`Failed to create conversation: ${convError?.message}`);
  }

  // Create Acontext session and disk for this conversation
  const acontextClient = getAcontextClient();

  try {
    // Create session
    const sessionResponse = await acontextClient.POST('/sessions', {
      body: {
        label: `Channel: ${platform} - ${platformUserName}`,
      },
    });

    if (sessionResponse.error || !sessionResponse.data) {
      throw new Error('Failed to create Acontext session');
    }

    const sessionId = sessionResponse.data.session_id;

    // Create disk
    const diskResponse = await acontextClient.POST('/disks', {
      body: {
        label: `Channel Disk: ${platform} - ${platformChatId}`,
      },
    });

    const diskId = diskResponse.data?.disk_id || null;

    // Update conversation with Acontext IDs
    await supabase
      .from('conversations')
      .update({
        acontext_session_id: sessionId,
        acontext_disk_id: diskId,
      })
      .eq('id', newConv.id);

    console.log('Created new channel conversation:', newConv.id);

    return {
      conversationId: newConv.id,
      sessionId,
      diskId: diskId || '',
    };
  } catch (error) {
    console.error('Error creating Acontext resources:', error);
    throw new Error(`Failed to create Acontext resources: ${error instanceof Error ? error.message : String(error)}`);
  }
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

    // Get or create conversation
    const { conversationId, sessionId, diskId } = await getOrCreateChannelConversation(
      platform,
      platformUserId,
      platformUserName || 'Unknown',
      platformChatId
    );

    console.log(`[${requestId}] Conversation:`, { conversationId, sessionId });

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

      await storeAssistantMessage(sessionId, fullContent, toolCalls);

      const acontextClient = getAcontextClient();
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
      const supabase = createClient(supabaseUrl, serviceRoleKey);

      const toolContext: ToolExecutionContext = {
        acontextClient,
        diskId,
        sessionId,
        userId: 'channel-service',
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

    // Update conversation title
    await updateConversationTitle(conversationId, message.slice(0, 50));

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
