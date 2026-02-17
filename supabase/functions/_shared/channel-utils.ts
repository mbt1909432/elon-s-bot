/**
 * Shared utilities for Supabase Edge Functions
 */

// Supabase client configuration
export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
export const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
export const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// CORS headers for all responses
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

/**
 * Create a JSON response with CORS headers
 */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

/**
 * Handle OPTIONS preflight requests
 */
export function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * Create an error response
 */
export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

/**
 * Get or create a channel session
 * Returns conversation info for processing messages
 */
export async function getOrCreateChannelSession(
  platform: string,
  platformUserId: string,
  platformChatId: string
): Promise<{
  userId: string;
  conversationId: string;
  sessionId?: string;
  diskId?: string;
  isNew: boolean;
}> {
  // Call the RPC function to get or create session
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_or_create_channel_session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      apikey: SUPABASE_SERVICE_KEY,
    },
    body: JSON.stringify({
      p_platform: platform,
      p_platform_user_id: platformUserId,
      p_platform_chat_id: platformChatId,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to get/create channel session: ${response.statusText}`);
  }

  const result = await response.json();

  if (!result || result.length === 0) {
    throw new Error('No session returned from database');
  }

  return {
    userId: result[0].user_id || result.user_id,
    conversationId: result[0].conversation_id || result.conversation_id,
    sessionId: result[0].session_id || result.session_id,
    diskId: result[0].disk_id || result.disk_id,
    isNew: result[0].is_new ?? result.is_new ?? false,
  };
}

/**
 * Send a message to the chat API
 */
export async function sendToChatAPI(
  conversationId: string,
  message: string,
  userId: string
): Promise<string> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({
      conversationId,
      message,
      userId,
      stream: false, // Get full response instead of streaming
    }),
  });

  if (!response.ok) {
    throw new Error(`Chat API error: ${response.statusText}`);
  }

  // The chat API returns SSE stream, we need to parse it
  const text = await response.text();
  return parseSSEResponse(text);
}

/**
 * Parse SSE response to extract the final content
 */
function parseSSEResponse(text: string): string {
  const lines = text.split('\n');
  let content = '';

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);

        // Handle different response formats
        if (parsed.choices?.[0]?.delta?.content) {
          content += parsed.choices[0].delta.content;
        } else if (parsed.choices?.[0]?.message?.content) {
          content += parsed.choices[0].message.content;
        } else if (parsed.content) {
          content += parsed.content;
        } else if (parsed.response) {
          content += parsed.response;
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  return content.trim();
}

/**
 * Log to console with timestamp
 */
export function log(message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] ${message}`, JSON.stringify(data));
  } else {
    console.log(`[${timestamp}] ${message}`);
  }
}
