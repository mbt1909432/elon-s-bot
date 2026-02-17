/**
 * Subagent Execution Edge Function
 * Executes background tasks created by the spawn tool
 */

import { corsHeaders, errorResponse, jsonResponse, log, SUPABASE_URL, SUPABASE_SERVICE_KEY, LLM_ENDPOINT, LLM_API_KEY, LLM_MODEL } from '../_shared/channel-utils.ts';

/**
 * Get subagent from database
 */
async function getSubagent(subagentId: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/subagents?id=eq.${subagentId}&select=*`, {
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      apikey: SUPABASE_SERVICE_KEY,
    },
  });

  if (!response.ok) return null;

  const data = await response.json();
  return data[0] || null;
}

/**
 * Update subagent status
 */
async function updateSubagent(
  subagentId: string,
  updates: Record<string, unknown>
): Promise<boolean> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/subagents?id=eq.${subagentId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      apikey: SUPABASE_SERVICE_KEY,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(updates),
  });

  return response.ok;
}

/**
 * Execute subagent task using LLM
 */
async function executeTask(
  task: string,
  conversationId?: string,
  userId?: string
): Promise<string> {
  // Get conversation history if available
  let historyContext = '';
  if (conversationId && userId) {
    try {
      const historyResponse = await fetch(
        `${SUPABASE_URL}/functions/v1/chat-history?conversationId=${conversationId}&limit=10`,
        {
          headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          },
        }
      );

      if (historyResponse.ok) {
        const history = await historyResponse.json();
        if (history.messages && history.messages.length > 0) {
          historyContext = `\n\nRecent conversation context:\n${history.messages
            .slice(-5)
            .map((m: { role: string; content: string }) => `${m.role}: ${m.content}`)
            .join('\n')}`;
        }
      }
    } catch {
      // Ignore history errors
    }
  }

  // Build system prompt for subagent
  const systemPrompt = `You are a subagent tasked with completing a specific job. Work independently and thoroughly.

Your task: ${task}

Instructions:
1. Focus on completing the task completely and accurately
2. If you need to search for information, do so
3. Provide a clear, comprehensive result
4. Be concise but thorough
${historyContext}

After completing the task, provide a summary of what you found or accomplished.`;

  // Call LLM
  const response = await fetch(`${LLM_ENDPOINT}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Please complete the following task:\n\n${task}` },
      ],
      max_tokens: 4096,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM request failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || 'No response generated';
}

/**
 * Notify user of subagent completion
 */
async function notifyCompletion(
  userId: string,
  subagentId: string,
  task: string,
  result: string,
  conversationId?: string
): Promise<void> {
  // Create a notification message in the conversation
  if (conversationId) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          apikey: SUPABASE_SERVICE_KEY,
        },
        body: JSON.stringify({
          conversation_id: conversationId,
          role: 'assistant',
          content: `🔔 Subagent completed!\n\nTask: ${task.slice(0, 100)}...\n\nResult:\n${result}`,
          metadata: {
            type: 'subagent_notification',
            subagent_id: subagentId,
          },
        }),
      });
    } catch (error) {
      log('Failed to create notification message:', error);
    }
  }

  // Could also send push notification, email, etc.
  log(`Subagent ${subagentId} completed for user ${userId}`);
}

/**
 * Main handler
 */
Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Only accept POST
  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const body = await req.json();
    const { subagentId } = body;

    if (!subagentId) {
      return errorResponse('subagentId is required', 400);
    }

    log('Executing subagent:', subagentId);

    // Get subagent record
    const subagent = await getSubagent(subagentId);

    if (!subagent) {
      return errorResponse('Subagent not found', 404);
    }

    // Check status
    if (subagent.status !== 'pending') {
      return jsonResponse({
        message: `Subagent already ${subagent.status}`,
        subagent,
      });
    }

    // Update status to running
    await updateSubagent(subagentId, {
      status: 'running',
      started_at: new Date().toISOString(),
      progress: 10,
    });

    try {
      // Execute the task
      const result = await executeTask(
        subagent.task as string,
        subagent.conversation_id as string | undefined,
        subagent.user_id as string | undefined
      );

      // Update with result
      await updateSubagent(subagentId, {
        status: 'completed',
        result,
        progress: 100,
        completed_at: new Date().toISOString(),
      });

      // Notify user
      await notifyCompletion(
        subagent.user_id as string,
        subagentId,
        subagent.task as string,
        result,
        subagent.conversation_id as string | undefined
      );

      log('Subagent completed:', subagentId);

      return jsonResponse({
        success: true,
        subagentId,
        result: result.slice(0, 200) + '...',
      });
    } catch (execError) {
      const errorMessage = execError instanceof Error ? execError.message : String(execError);

      // Update with error
      await updateSubagent(subagentId, {
        status: 'failed',
        error: errorMessage,
        completed_at: new Date().toISOString(),
      });

      log('Subagent failed:', errorMessage);

      return jsonResponse(
        {
          success: false,
          subagentId,
          error: errorMessage,
        },
        500
      );
    }
  } catch (error) {
    log('Error processing request:', error);
    return errorResponse('Internal server error', 500);
  }
});
