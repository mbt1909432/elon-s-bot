/**
 * Discord Channel Webhook Handler
 * Supabase Edge Function for processing Discord interactions
 * Connects to ElonsBot Agent on Vercel
 */

import { corsHeaders, errorResponse, jsonResponse, log } from '../_shared/channel-utils.ts';
// @ts-ignore: tweetnacl has no types
import nacl from 'https://esm.sh/tweetnacl@1.0.3';

// Environment variables
const DISCORD_BOT_TOKEN = Deno.env.get('DISCORD_BOT_TOKEN')!;
const DISCORD_APPLICATION_ID = Deno.env.get('DISCORD_APPLICATION_ID')!;
const DISCORD_PUBLIC_KEY = Deno.env.get('DISCORD_PUBLIC_KEY') || '';

// Vercel API configuration
const VERCEL_API_URL = Deno.env.get('VERCEL_API_URL') || 'https://elon-s-bot.vercel.app';
const CHANNEL_API_KEY = Deno.env.get('CHANNEL_API_KEY') || '';

// Discord API base URL
const DISCORD_API_BASE = 'https://discord.com/api/v10';

// Maximum message length
const DISCORD_MAX_MESSAGE_LENGTH = 2000;

/**
 * Verify Discord request using Ed25519 signature
 */
function verifyDiscordRequest(request: Request, body: string): boolean {
  if (!DISCORD_PUBLIC_KEY) {
    log('No public key configured, skipping verification');
    return true;
  }

  const signature = request.headers.get('X-Signature-Ed25519');
  const timestamp = request.headers.get('X-Signature-Timestamp');

  if (!signature || !timestamp) {
    log('Missing signature headers');
    return false;
  }

  try {
    const message = new TextEncoder().encode(timestamp + body);
    const sigBytes = hexToBytes(signature);
    const pubKeyBytes = hexToBytes(DISCORD_PUBLIC_KEY);

    return nacl.sign.detached.verify(message, sigBytes, pubKeyBytes);
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
 * Parse Discord interaction content
 */
function parseInteractionContent(body: Record<string, unknown>): string {
  const type = body.type as number;

  if (type === 2) {
    const data = body.data as Record<string, unknown>;
    const commandName = data?.name as string;
    const options = data?.options as Array<Record<string, unknown>> | undefined;

    if (options && options.length > 0) {
      return options
        .map(opt => {
          const value = opt.value;
          return typeof value === 'string' ? value : String(value);
        })
        .join(' ');
    }
    return commandName || '';
  } else if (type === 3) {
    const message = body.message as Record<string, unknown> | undefined;
    return (message?.content as string) || '';
  }
  return '';
}

/**
 * Call Vercel Channel API
 */
async function callChannelAPI(
  platform: string,
  platformUserId: string,
  platformUserName: string,
  platformChatId: string,
  message: string
): Promise<string> {
  const response = await fetch(`${VERCEL_API_URL}/api/channels/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Channel-API-Key': CHANNEL_API_KEY,
    },
    body: JSON.stringify({
      platform,
      platformUserId,
      platformUserName,
      platformChatId,
      message,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    log('Channel API error:', errorText);
    throw new Error(`Channel API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.content || 'No response';
}

/**
 * Follow up on an interaction via webhook
 */
async function sendFollowUp(interactionToken: string, content: string): Promise<void> {
  try {
    const chunks = splitMessage(content, DISCORD_MAX_MESSAGE_LENGTH);

    for (const chunk of chunks) {
      await fetch(
        `${DISCORD_API_BASE}/webhooks/${DISCORD_APPLICATION_ID}/${interactionToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: chunk }),
        }
      );
    }
  } catch (error) {
    log('Error sending follow-up:', error);
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

  // Get raw body first for signature verification
  const rawBody = await req.text();
  let body: Record<string, unknown>;

  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  log('Received interaction:', { type: body.type });

  // Handle PING - Discord endpoint verification
  if (body.type === 1) {
    log('PING received, sending PONG');
    return new Response(JSON.stringify({ type: 1 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Handle APPLICATION_COMMAND (slash command)
  if (body.type === 2) {
    const data = body.data as Record<string, unknown>;
    const commandName = data?.name as string;
    const interactionToken = body.token as string;
    const channelId = body.channel_id as string;
    const guildId = body.guild_id as string;

    // Get user info
    const user = (body.member?.user || body.user) as Record<string, unknown> | undefined;
    const userId = user?.id as string || 'unknown';
    const userName = (user?.global_name as string) || (user?.username as string) || 'Unknown';

    log(`Command: ${commandName}, User: ${userId} (${userName}), Channel: ${channelId}`);

    // Parse message content
    const content = parseInteractionContent(body);

    // For simple commands, respond immediately
    if (commandName === 'help' || commandName === 'whoami' || commandName === 'status') {
      let responseText = '';
      if (commandName === 'help') {
        responseText = `**ElonsBot - AI Agent on Discord**

Commands:
\`/ask <message>\` - Chat with the AI agent
\`/chat <message>\` - Same as /ask
\`/whoami\` - Show your Discord ID
\`/help\` - Show this help message

Features:
- Full AI agent with tools (file ops, web search, code execution)
- Conversation history and memory
- Multi-user support`;
      } else if (commandName === 'whoami') {
        responseText = `Your Discord ID: ${userId}\nUsername: ${userName}`;
      } else {
        responseText = 'ElonsBot Agent is running! Use /ask to chat.';
      }

      return new Response(JSON.stringify({
        type: 4,
        data: { content: responseText }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // For /ask and /chat commands - full agent integration
    if (commandName === 'ask' || commandName === 'chat') {
      // Start async processing
      (async () => {
        try {
          log('Calling Vercel API for user:', userId);

          // Call the Vercel Channel API with full agent capabilities
          const response = await callChannelAPI(
            'discord',
            userId,
            userName,
            channelId,
            content
          );

          log('Got response from agent:', response?.substring(0, 100));

          // Send follow-up with the response
          await sendFollowUp(interactionToken, response);
        } catch (error) {
          log('Error in agent processing:', error);
          await sendFollowUp(
            interactionToken,
            `Error: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      })();

      // Return DEFERRED response immediately (type 5)
      return new Response(JSON.stringify({ type: 5 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Unknown command
    return new Response(JSON.stringify({
      type: 4,
      data: { content: `Unknown command: ${commandName}` }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Unknown interaction type
  return new Response(JSON.stringify({ type: 1 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
