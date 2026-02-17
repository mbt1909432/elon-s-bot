/**
 * Feishu/Lark Channel Webhook Handler
 * Supabase Edge Function for processing Feishu event subscriptions
 */

import { corsHeaders, errorResponse, jsonResponse, log, getOrCreateChannelSession, sendToChatAPI } from '../_shared/channel-utils.ts';

// Environment variables
const FEISHU_APP_ID = Deno.env.get('FEISHU_APP_ID')!;
const FEISHU_APP_SECRET = Deno.env.get('FEISHU_APP_SECRET')!;
const FEISHU_VERIFICATION_TOKEN = Deno.env.get('FEISHU_VERIFICATION_TOKEN') || '';
const FEISHU_ENCRYPT_KEY = Deno.env.get('FEISHU_ENCRYPT_KEY') || '';
const USE_LARK = Deno.env.get('USE_LARK') === 'true'; // Use Lark (international) or Feishu (China)

// API base URL
const API_BASE = USE_LARK ? 'https://open.larksuite.com/open-apis' : 'https://open.feishu.cn/open-apis';

// Token cache
let tokenCache: { accessToken: string; expiresAt: number } | null = null;

// Message type mapping
const MSG_TYPE_MAP: Record<string, string> = {
  image: '[image]',
  audio: '[audio]',
  file: '[file]',
  sticker: '[sticker]',
  video: '[video]',
};

/**
 * Verify Feishu request
 */
function verifyFeishuRequest(body: Record<string, unknown>): boolean {
  if (!FEISHU_VERIFICATION_TOKEN) return true;

  const token = body?.header?.token as string;
  return token === FEISHU_VERIFICATION_TOKEN;
}

/**
 * Parse Feishu event
 */
interface ParsedEvent {
  type: 'challenge' | 'message';
  challenge?: string;
  senderId?: string;
  senderName?: string;
  chatId?: string;
  chatType?: string;
  content?: string;
  messageId?: string;
  metadata?: Record<string, unknown>;
}

function parseFeishuEvent(body: Record<string, unknown>): ParsedEvent {
  // Handle URL verification challenge
  if (body.type === 'url_verification') {
    return {
      type: 'challenge',
      challenge: body.challenge as string,
    };
  }

  // Parse event
  const header = body.header as Record<string, unknown>;
  const event = body.event as Record<string, unknown>;

  if (!event) {
    return { type: 'message' };
  }

  const sender = event.sender as Record<string, unknown>;
  const message = event.message as Record<string, unknown>;

  if (!sender || !message) {
    return { type: 'message' };
  }

  const senderId = (sender.sender_id as Record<string, unknown>)?.open_id as string;
  const chatType = message.chat_type as string;
  const chatId = message.chat_id as string;

  // Parse message content
  const msgType = message.message_type as string;
  let content = '';

  if (msgType === 'text') {
    try {
      const contentJson = JSON.parse(message.content as string);
      content = contentJson.text || '';
    } catch {
      content = message.content as string || '';
    }
  } else if (msgType === 'post') {
    try {
      const contentJson = JSON.parse(message.content as string);
      content = extractPostText(contentJson);
    } catch {
      content = message.content as string || '';
    }
  } else {
    content = MSG_TYPE_MAP[msgType] || `[${msgType}]`;
  }

  return {
    type: 'message',
    senderId,
    senderName: (sender.sender_id as Record<string, unknown>)?.union_id as string,
    chatId: chatType === 'group' ? chatId : senderId,
    chatType,
    content,
    messageId: message.message_id as string,
    metadata: {
      eventId: header?.event_id,
      eventType: header?.event_type,
      createTime: message.create_time,
      tenantKey: header?.tenant_key,
    },
  };
}

/**
 * Extract plain text from Feishu post (rich text) message content
 */
function extractPostText(contentJson: Record<string, unknown>): string {
  const extractFromLang = (langContent: unknown): string | null => {
    if (!langContent || typeof langContent !== 'object') return null;

    const content = langContent as Record<string, unknown>;
    const title = (content.title as string) || '';
    const contentBlocks = content.content as Array<Array<Record<string, unknown>>> | undefined;

    if (!Array.isArray(contentBlocks)) return null;

    const textParts: string[] = [];
    if (title) textParts.push(title);

    for (const block of contentBlocks) {
      if (!Array.isArray(block)) continue;
      for (const element of block) {
        if (!element || typeof element !== 'object') continue;
        const tag = element.tag as string;
        if (tag === 'text') {
          textParts.push((element.text as string) || '');
        } else if (tag === 'a') {
          textParts.push((element.text as string) || '');
        } else if (tag === 'at') {
          textParts.push(`@${(element.user_name as string) || 'user'}`);
        }
      }
    }

    return textParts.length > 0 ? textParts.join(' ').trim() : null;
  };

  // Try direct format first
  if ('content' in contentJson) {
    const result = extractFromLang(contentJson);
    if (result) return result;
  }

  // Try localized format
  for (const langKey of ['zh_cn', 'en_us', 'ja_jp'] as const) {
    const langContent = contentJson[langKey];
    const result = extractFromLang(langContent);
    if (result) return result;
  }

  return '';
}

/**
 * Get tenant access token (cached)
 */
async function getAccessToken(): Promise<string | null> {
  // Check cache
  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.accessToken;
  }

  try {
    const response = await fetch(`${API_BASE}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: FEISHU_APP_ID,
        app_secret: FEISHU_APP_SECRET,
      }),
    });

    const result = await response.json();

    if (result.code !== 0 || !result.tenant_access_token) {
      log('Failed to get Feishu access token:', result);
      return null;
    }

    // Cache the token (expire 5 minutes early for safety)
    const expiresIn = result.expire || 7200;
    tokenCache = {
      accessToken: result.tenant_access_token,
      expiresAt: Date.now() + (expiresIn - 300) * 1000,
    };

    return tokenCache.accessToken;
  } catch (error) {
    log('Error getting Feishu access token:', error);
    return null;
  }
}

/**
 * Send message to Feishu
 */
async function sendFeishuMessage(
  chatId: string,
  content: string
): Promise<{ success: boolean; error?: string }> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return { success: false, error: 'Failed to get access token' };
  }

  // Determine receive_id_type based on chat_id format
  const receiveIdType = chatId.startsWith('oc_') ? 'chat_id' : 'open_id';

  // Build card content
  const card = buildCardContent(content);

  try {
    const response = await fetch(`${API_BASE}/im/v1/messages?receive_id_type=${receiveIdType}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      }),
    });

    const result = await response.json();

    if (result.code !== 0) {
      log('Failed to send Feishu message:', result);
      return { success: false, error: result.msg };
    }

    return { success: true };
  } catch (error) {
    log('Error sending Feishu message:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Add reaction to a message
 */
async function addReaction(messageId: string, emojiType: string = 'THUMBSUP'): Promise<void> {
  const accessToken = await getAccessToken();
  if (!accessToken) return;

  try {
    await fetch(`${API_BASE}/im/v1/messages/${messageId}/reactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        reaction_type: { emoji_type: emojiType },
      }),
    });
  } catch {
    // Ignore errors
  }
}

/**
 * Build Feishu interactive card content
 */
function buildCardContent(content: string): Record<string, unknown> {
  const elements = buildCardElements(content);

  return {
    config: { wide_screen_mode: true },
    elements,
  };
}

/**
 * Build card elements from content
 */
function buildCardElements(content: string): Array<Record<string, unknown>> {
  const elements: Array<Record<string, unknown>> = [];

  // Split by markdown headings
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  let lastEnd = 0;
  let match;

  while ((match = headingRegex.exec(content)) !== null) {
    const before = content.slice(lastEnd, match.index).trim();
    if (before) {
      elements.push({ tag: 'markdown', content: before });
    }

    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**${match[2].trim()}**`,
      },
    });

    lastEnd = match.index + match[0].length;
  }

  const remaining = content.slice(lastEnd).trim();
  if (remaining) {
    elements.push({ tag: 'markdown', content: remaining });
  }

  return elements.length > 0 ? elements : [{ tag: 'markdown', content }];
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
    log('Received Feishu event:', { type: body.type || body.header?.event_type });

    // Parse the event
    const parsed = parseFeishuEvent(body as Record<string, unknown>);

    // Handle URL verification challenge
    if (parsed.type === 'challenge' && parsed.challenge) {
      log('Responding to challenge:', parsed.challenge);
      return jsonResponse({ challenge: parsed.challenge });
    }

    // Verify request
    if (!verifyFeishuRequest(body as Record<string, unknown>)) {
      return errorResponse('Unauthorized', 401);
    }

    // Skip if not a valid message
    if (parsed.type !== 'message' || !parsed.senderId || !parsed.content) {
      log('No parseable message');
      return jsonResponse({ ok: true });
    }

    log('Parsed event:', parsed);

    // Add reaction to show "seen"
    if (parsed.messageId) {
      await addReaction(parsed.messageId, 'THUMBSUP');
    }

    // Get or create channel session
    let session;
    try {
      session = await getOrCreateChannelSession(
        'feishu',
        parsed.senderId,
        parsed.chatId!
      );
    } catch (error) {
      log('Failed to get/create session:', error);
      await sendFeishuMessage(parsed.chatId!, '❌ 抱歉，遇到了错误，请稍后再试。');
      return jsonResponse({ ok: true });
    }

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
      await sendFeishuMessage(parsed.chatId!, '❌ 抱歉，处理消息时遇到了错误。');
      return jsonResponse({ ok: true });
    }

    log('Chat response:', response?.substring(0, 100));

    // Send response to Feishu
    if (response) {
      await sendFeishuMessage(parsed.chatId!, response);
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    log('Error processing request:', error);
    return errorResponse('Internal server error', 500);
  }
});
