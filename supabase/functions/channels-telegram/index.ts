/**
 * Telegram Channel Webhook Handler
 * Supabase Edge Function for processing Telegram bot updates
 */

import { corsHeaders, errorResponse, jsonResponse, log, getOrCreateChannelSession, sendToChatAPI } from '../_shared/channel-utils.ts';

// Environment variables
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
const TELEGRAM_SECRET_TOKEN = Deno.env.get('TELEGRAM_SECRET_TOKEN') || '';

// Telegram API base URL
const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

/**
 * Verify webhook request using secret token
 */
function verifyRequest(request: Request): boolean {
  if (!TELEGRAM_SECRET_TOKEN) return true;

  const headerToken = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  return headerToken === TELEGRAM_SECRET_TOKEN;
}

/**
 * Parse Telegram update to unified format
 */
interface ParsedMessage {
  senderId: string;
  senderName: string;
  senderUsername?: string;
  chatId: string;
  chatType: string;
  content: string;
  messageId: string;
  metadata: Record<string, unknown>;
}

function parseTelegramUpdate(body: Record<string, unknown>): ParsedMessage | null {
  const message = (body.message || body.edited_message) as Record<string, unknown> | undefined;

  if (!message) return null;

  const user = message.from as Record<string, unknown> | undefined;
  const chat = message.chat as Record<string, unknown> | undefined;

  if (!user || !chat) return null;

  // Skip bot messages
  if (user.is_bot) return null;

  // Build content
  const contentParts: string[] = [];

  if (message.text) contentParts.push(message.text as string);
  if (message.caption) contentParts.push(message.caption as string);

  // Handle media (just note it for now)
  if (message.photo) contentParts.push('[photo]');
  if (message.document) contentParts.push(`[document: ${(message.document as Record<string, unknown>).file_name || 'file'}]`);
  if (message.video) contentParts.push('[video]');
  if (message.audio) contentParts.push('[audio]');
  if (message.voice) contentParts.push('[voice]');

  const userId = String(user.id);
  const username = user.username as string | undefined;

  return {
    senderId: username ? `${userId}|${username}` : userId,
    senderName: [user.first_name, user.last_name].filter(Boolean).join(' '),
    senderUsername: username,
    chatId: String(chat.id),
    chatType: chat.type as string,
    content: contentParts.join('\n') || '[empty message]',
    messageId: String(message.message_id),
    metadata: {
      userId: user.id,
      username: username,
      firstName: user.first_name,
      lastName: user.last_name,
      isGroup: chat.type !== 'private',
    },
  };
}

/**
 * Send message to Telegram
 */
async function sendTelegramMessage(chatId: string, text: string, replyTo?: string): Promise<boolean> {
  // Split long messages
  const chunks = splitMessage(text, 4000);

  for (const chunk of chunks) {
    const html = markdownToTelegramHtml(chunk);

    const body: Record<string, unknown> = {
      chat_id: parseInt(chatId, 10),
      text: html,
      parse_mode: 'HTML',
    };

    if (replyTo) {
      body.reply_to_message_id = parseInt(replyTo, 10);
    }

    try {
      const response = await fetch(`${TELEGRAM_API_BASE}${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const result = await response.json();

      if (!result.ok) {
        // Try plain text if HTML fails
        if (result.description?.includes('parse')) {
          const fallbackResponse = await fetch(`${TELEGRAM_API_BASE}${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: parseInt(chatId, 10),
              text: chunk,
              reply_to_message_id: replyTo ? parseInt(replyTo, 10) : undefined,
            }),
          });

          const fallbackResult = await fallbackResponse.json();
          if (!fallbackResult.ok) {
            log('Failed to send Telegram message:', fallbackResult);
            return false;
          }
        } else {
          log('Failed to send Telegram message:', result);
          return false;
        }
      }
    } catch (error) {
      log('Error sending Telegram message:', error);
      return false;
    }
  }

  return true;
}

/**
 * Send typing indicator
 */
async function sendTypingIndicator(chatId: string): Promise<void> {
  try {
    await fetch(`${TELEGRAM_API_BASE}${TELEGRAM_BOT_TOKEN}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: parseInt(chatId, 10),
        action: 'typing',
      }),
    });
  } catch {
    // Ignore errors
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
 * Convert Markdown to Telegram HTML
 */
function markdownToTelegramHtml(text: string): string {
  if (!text) return '';

  // Extract and protect code blocks
  const codeBlocks: string[] = [];
  text = text.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) => {
    codeBlocks.push(code);
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });

  // Extract and protect inline code
  const inlineCodes: string[] = [];
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    inlineCodes.push(code);
    return `\x00IC${inlineCodes.length - 1}\x00`;
  });

  // Headers -> bold
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');

  // Blockquotes
  text = text.replace(/^>\s*(.*)$/gm, '$1');

  // Escape HTML
  text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  text = text.replace(/__(.+?)__/g, '<b>$1</b>');

  // Italic
  text = text.replace(/(?<![a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])/g, '<i>$1</i>');

  // Strikethrough
  text = text.replace(/~~(.+?)~~/g, '<s>$1</s>');

  // Bullet lists
  text = text.replace(/^[-*]\s+/gm, '• ');

  // Restore inline code
  inlineCodes.forEach((code, i) => {
    const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    text = text.replace(`\x00IC${i}\x00`, `<code>${escaped}</code>`);
  });

  // Restore code blocks
  codeBlocks.forEach((code, i) => {
    const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    text = text.replace(`\x00CB${i}\x00`, `<pre><code>${escaped}</code></pre>`);
  });

  return text;
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
  if (!verifyRequest(req)) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const body = await req.json();
    log('Received Telegram update:', body);

    // Parse the message
    const parsed = parseTelegramUpdate(body as Record<string, unknown>);

    if (!parsed) {
      log('No parseable message in update');
      return jsonResponse({ ok: true });
    }

    log('Parsed message:', parsed);

    // Handle /start command
    if (parsed.content === '/start') {
      await sendTelegramMessage(
        parsed.chatId,
        `👋 Hi ${parsed.senderName}! I'm ElonsBot.\n\nSend me a message and I'll respond!`
      );
      return jsonResponse({ ok: true });
    }

    // Send typing indicator
    await sendTypingIndicator(parsed.chatId);

    // Get or create channel session
    let session;
    try {
      session = await getOrCreateChannelSession(
        'telegram',
        parsed.senderId,
        parsed.chatId
      );
    } catch (error) {
      log('Failed to get/create session:', error);
      await sendTelegramMessage(
        parsed.chatId,
        '❌ Sorry, I encountered an error. Please try again later.'
      );
      return jsonResponse({ ok: true });
    }

    log('Session:', session);

    // Send message to chat API
    let response: string;
    try {
      response = await sendToChatAPI(
        session.conversationId,
        parsed.content,
        session.userId
      );
    } catch (error) {
      log('Chat API error:', error);
      await sendTelegramMessage(
        parsed.chatId,
        '❌ Sorry, I encountered an error processing your message. Please try again.'
      );
      return jsonResponse({ ok: true });
    }

    log('Chat response:', response?.substring(0, 100));

    // Send response to Telegram
    if (response) {
      await sendTelegramMessage(parsed.chatId, response, parsed.messageId);
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    log('Error processing request:', error);
    return errorResponse('Internal server error', 500);
  }
});
