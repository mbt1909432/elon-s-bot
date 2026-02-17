/**
 * Discord Channel Webhook Handler
 * Supabase Edge Function for processing Discord interactions
 */

import { corsHeaders, errorResponse, jsonResponse, log, getOrCreateChannelSession, sendToChatAPI } from '../_shared/channel-utils.ts';

// Environment variables
const DISCORD_BOT_TOKEN = Deno.env.get('DISCORD_BOT_TOKEN')!;
const DISCORD_APPLICATION_ID = Deno.env.get('DISCORD_APPLICATION_ID')!;
const DISCORD_PUBLIC_KEY = Deno.env.get('DISCORD_PUBLIC_KEY') || '';

// Discord API base URL
const DISCORD_API_BASE = 'https://discord.com/api/v10';

// Maximum message length
const DISCORD_MAX_MESSAGE_LENGTH = 2000;

/**
 * Verify Discord request using Ed25519 signature
 * Using Web Crypto API for Edge Runtime compatibility
 */
async function verifyDiscordRequest(request: Request): Promise<boolean> {
  if (!DISCORD_PUBLIC_KEY) return true;

  const signature = request.headers.get('X-Signature-Ed25519');
  const timestamp = request.headers.get('X-Signature-Timestamp');

  if (!signature || !timestamp) return false;

  try {
    // Get request body
    const body = await request.clone().text();
    const message = new TextEncoder().encode(timestamp + body);

    // Convert hex to Uint8Array
    const sigBytes = hexToBytes(signature);
    const pubKeyBytes = hexToBytes(DISCORD_PUBLIC_KEY);

    // Import public key
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      pubKeyBytes,
      { name: 'Ed25519', namedCurve: 'Ed25519' },
      false,
      ['verify']
    );

    // Verify signature
    return await crypto.subtle.verify(
      { name: 'Ed25519' },
      cryptoKey,
      sigBytes,
      message
    );
  } catch (error) {
    log('Signature verification error:', error);
    return false;
  }
}

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const length = hex.length / 2;
  const arr = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

/**
 * Parse Discord interaction
 */
interface ParsedInteraction {
  type: number;
  interactionId: string;
  interactionToken: string;
  senderId: string;
  senderName: string;
  senderUsername?: string;
  chatId: string;
  guildId?: string;
  content: string;
  commandName?: string;
  metadata: Record<string, unknown>;
}

function parseDiscordInteraction(body: Record<string, unknown>): ParsedInteraction | null {
  const type = body.type as number;

  // Handle PING
  if (type === 1) {
    return {
      type: 1,
      interactionId: body.id as string,
      interactionToken: body.token as string,
      senderId: 'system',
      senderName: 'System',
      chatId: '',
      content: '__DISCORD_PING__',
      metadata: { type: 'ping' },
    };
  }

  const user = (body.member?.user || body.user) as Record<string, unknown> | undefined;
  if (!user) return null;

  // Skip bot messages
  if (user.bot) return null;

  const channelId = body.channel_id as string;
  const guildId = body.guild_id as string;

  let content = '';
  let commandName: string | undefined;

  if (type === 2) {
    // APPLICATION_COMMAND (slash command)
    const data = body.data as Record<string, unknown>;
    commandName = data?.name as string;
    const options = data?.options as Array<Record<string, unknown>> | undefined;

    if (options && options.length > 0) {
      content = options
        .map(opt => {
          const value = opt.value;
          return typeof value === 'string' ? value : String(value);
        })
        .join(' ');
    } else {
      content = commandName || '';
    }
  } else if (type === 3) {
    // MESSAGE_COMPONENT
    const message = body.message as Record<string, unknown> | undefined;
    content = (message?.content as string) || '';
  }

  return {
    type,
    interactionId: body.id as string,
    interactionToken: body.token as string,
    senderId: user.id as string,
    senderName: (body.member?.nick as string) || (user.global_name as string) || (user.username as string),
    senderUsername: user.username as string,
    chatId: channelId,
    guildId,
    content,
    commandName,
    metadata: {
      applicationId: body.application_id,
      commandData: body.data,
    },
  };
}

/**
 * Respond to interaction (immediate response, within 3 seconds)
 */
async function respondToInteraction(
  interactionToken: string,
  content: string,
  ephemeral: boolean = false
): Promise<boolean> {
  try {
    const response = await fetch(
      `${DISCORD_API_BASE}/webhooks/${DISCORD_APPLICATION_ID}/${interactionToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
          data: {
            content: content.slice(0, DISCORD_MAX_MESSAGE_LENGTH),
            flags: ephemeral ? 64 : 0, // EPHEMERAL flag
          },
        }),
      }
    );

    return response.ok;
  } catch (error) {
    log('Error responding to interaction:', error);
    return false;
  }
}

/**
 * Follow up on interaction (delayed response)
 */
async function followUpInteraction(interactionToken: string, content: string): Promise<boolean> {
  try {
    // Split long messages
    const chunks = splitMessage(content, DISCORD_MAX_MESSAGE_LENGTH);

    for (const chunk of chunks) {
      const response = await fetch(
        `${DISCORD_API_BASE}/webhooks/${DISCORD_APPLICATION_ID}/${interactionToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: chunk }),
        }
      );

      if (!response.ok) {
        log('Follow-up failed:', await response.text());
        return false;
      }
    }

    return true;
  } catch (error) {
    log('Error following up:', error);
    return false;
  }
}

/**
 * Send regular message to a channel
 */
async function sendChannelMessage(
  channelId: string,
  content: string,
  replyTo?: string
): Promise<boolean> {
  try {
    const chunks = splitMessage(content, DISCORD_MAX_MESSAGE_LENGTH);

    for (const chunk of chunks) {
      const body: Record<string, unknown> = { content: chunk };

      if (replyTo) {
        body.message_reference = { message_id: replyTo };
        body.allowed_mentions = { replied_user: false };
      }

      const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        },
        body: JSON.stringify(body),
      });

      // Handle rate limiting
      if (response.status === 429) {
        const data = await response.json();
        await new Promise(resolve => setTimeout(resolve, (data.retry_after || 1) * 1000));
        // Don't retry for simplicity
      }

      if (!response.ok) {
        log('Failed to send message:', await response.text());
        return false;
      }
    }

    return true;
  } catch (error) {
    log('Error sending message:', error);
    return false;
  }
}

/**
 * Split long messages
 */
function splitMessage(content: string, maxLen: number): string[] {
  if (content.length <= maxLen) return [content];

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    let breakPoint = remaining.lastIndexOf('\n\n', maxLen);
    if (breakPoint < maxLen * 0.5) breakPoint = remaining.lastIndexOf('\n', maxLen);
    if (breakPoint < maxLen * 0.5) breakPoint = remaining.lastIndexOf(' ', maxLen);
    if (breakPoint < maxLen * 0.5) breakPoint = maxLen - 1;

    chunks.push(remaining.slice(0, breakPoint + 1).trim());
    remaining = remaining.slice(breakPoint + 1).trim();
  }

  return chunks;
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

  // Verify request
  const isValid = await verifyDiscordRequest(req);
  if (!isValid) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const body = await req.json();
    log('Received Discord interaction:', { type: body.type, id: body.id });

    // Parse the interaction
    const parsed = parseDiscordInteraction(body as Record<string, unknown>);

    if (!parsed) {
      log('No parseable interaction');
      return jsonResponse({ type: 1 }); // PONG just in case
    }

    // Handle PING
    if (parsed.type === 1 || parsed.content === '__DISCORD_PING__') {
      return jsonResponse({ type: 1 }); // PONG
    }

    log('Parsed interaction:', parsed);

    // Get or create channel session
    let session;
    try {
      session = await getOrCreateChannelSession(
        'discord',
        parsed.senderId,
        parsed.chatId
      );
    } catch (error) {
      log('Failed to get/create session:', error);
      await respondToInteraction(parsed.interactionToken, '❌ Sorry, I encountered an error. Please try again later.', true);
      return jsonResponse({ type: 4, data: { content: 'Error', flags: 64 } });
    }

    // Send immediate acknowledgment (to avoid timeout)
    // We'll follow up with the actual response
    await respondToInteraction(parsed.interactionToken, '⏳ Thinking...', true);

    // Process message through chat API
    let response: string;
    try {
      response = await sendToChatAPI(
        session.conversationId,
        parsed.content,
        session.userId
      );
    } catch (error) {
      log('Chat API error:', error);
      await followUpInteraction(parsed.interactionToken, '❌ Sorry, I encountered an error processing your message.');
      return jsonResponse({ ok: true });
    }

    log('Chat response:', response?.substring(0, 100));

    // Send follow-up response
    if (response) {
      await followUpInteraction(parsed.interactionToken, response);
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    log('Error processing request:', error);
    return errorResponse('Internal server error', 500);
  }
});
