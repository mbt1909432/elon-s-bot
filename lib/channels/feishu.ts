/**
 * Feishu/Lark Channel Adapter
 * Webhook-based implementation using Feishu Open Platform API
 * Supports event subscriptions for receiving messages
 */

import { BaseChannel, registerChannel, type ChannelAdapterOptions } from './base';
import {
  InboundMessage,
  OutboundMessage,
  WebhookVerification,
  ChannelConfig,
  FeishuEvent,
  MediaAttachment,
} from './types';

// Feishu/Lark API constants
const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';
const LARK_API_BASE = 'https://open.larksuite.com/open-apis';

// Message type display mapping
const MSG_TYPE_MAP: Record<string, string> = {
  image: '[image]',
  audio: '[audio]',
  file: '[file]',
  sticker: '[sticker]',
  video: '[video]',
};

// Token cache
interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

export class FeishuChannel extends BaseChannel {
  readonly name = 'Feishu';
  readonly platform = 'feishu';

  private appId: string;
  private appSecret: string;
  private encryptKey?: string;
  private verificationToken?: string;
  private useLark: boolean; // Use Lark (international) or Feishu (China)
  private tokenCache: TokenCache | null = null;

  constructor(options: ChannelAdapterOptions) {
    super(options);
    this.appId = options.config.feishuAppId || '';
    this.appSecret = options.config.feishuAppSecret || '';
    this.encryptKey = options.config.feishuEncryptKey;
    this.verificationToken = options.config.feishuVerificationToken;
    this.useLark = Boolean(options.config.customSettings?.useLark);
  }

  /**
   * Get the API base URL based on whether using Lark or Feishu
   */
  private get apiBase(): string {
    return this.useLark ? LARK_API_BASE : FEISHU_API_BASE;
  }

  /**
   * Verify Feishu webhook request
   * Feishu sends verification challenges and signs requests
   */
  async verifyWebhook(request: Request): Promise<WebhookVerification> {
    // Check verification token if configured
    if (this.verificationToken) {
      const body = await request.clone().json();
      const token = body?.header?.token;

      if (token !== this.verificationToken) {
        return { valid: false, error: 'Invalid verification token' };
      }
    }

    // Handle URL verification challenge
    const body = await request.clone().json();
    if (body?.type === 'url_verification' || body?.header?.event_type === 'url_verification') {
      return {
        valid: true,
        challenge: body?.challenge,
      };
    }

    return { valid: true };
  }

  /**
   * Parse incoming Feishu event
   */
  async parseWebhook(request: Request): Promise<InboundMessage> {
    const body = (await request.json()) as FeishuEvent | { type: string; challenge: string };

    // Handle URL verification challenge
    if ('type' in body && body.type === 'url_verification') {
      return {
        id: 'challenge',
        channel: 'feishu',
        senderId: 'system',
        chatId: '',
        content: '__FEISHU_CHALLENGE__',
        metadata: {
          type: 'challenge',
          challenge: body.challenge,
        },
        timestamp: new Date(),
        raw: body,
      };
    }

    const event = body as FeishuEvent;
    const message = event.event.message;
    const sender = event.event.sender;

    // Parse message content based on type
    let content = '';
    const msgType = message.message_type;

    if (msgType === 'text') {
      try {
        const contentJson = JSON.parse(message.content);
        content = contentJson.text || '';
      } catch {
        content = message.content || '';
      }
    } else if (msgType === 'post') {
      content = this.extractPostText(JSON.parse(message.content));
    } else {
      content = MSG_TYPE_MAP[msgType] || `[${msgType}]`;
    }

    // Determine chat ID format
    const chatType = message.chat_type || 'p2p';
    const chatId = chatType === 'group' ? message.chat_id : sender.sender_id.open_id;

    return {
      id: message.message_id,
      channel: 'feishu',
      senderId: sender.sender_id.open_id,
      senderName: sender.sender_id.union_id,
      chatId: chatId,
      chatType: chatType === 'group' ? 'group' : 'private',
      content,
      replyTo: message.parent_id || message.root_id,
      metadata: {
        eventId: event.header.event_id,
        eventType: event.header.event_type,
        messageId: message.message_id,
        chatType: chatType,
        msgType: msgType,
        createTime: message.create_time,
        tenantKey: event.header.tenant_key,
        appId: event.header.app_id,
        mentions: message.mentions,
      },
      timestamp: new Date(parseInt(message.create_time)),
      raw: event,
    };
  }

  /**
   * Send message to Feishu
   */
  async sendMessage(message: OutboundMessage): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.appId || !this.appSecret) {
      return { success: false, error: 'Feishu app ID or secret not configured' };
    }

    try {
      // Get access token
      const accessToken = await this.getAccessToken();
      if (!accessToken) {
        return { success: false, error: 'Failed to get access token' };
      }

      // Determine receive_id_type based on chat_id format
      // open_id starts with "ou_", chat_id starts with "oc_"
      const receiveIdType = message.chatId.startsWith('oc_') ? 'chat_id' : 'open_id';

      // Build card content with markdown support
      const card = this.buildCardContent(message.content);
      const content = JSON.stringify(card);

      const response = await fetch(`${this.apiBase}/im/v1/messages?receive_id_type=${receiveIdType}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          receive_id: message.chatId,
          msg_type: 'interactive',
          content: content,
        }),
      });

      const result = await response.json();

      if (result.code !== 0) {
        return { success: false, error: result.msg || `Error code: ${result.code}` };
      }

      return { success: true, messageId: result.data?.message_id };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Add reaction to a message
   */
  async addReaction(
    messageId: string,
    emojiType: string = 'THUMBSUP'
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.appId || !this.appSecret) {
      return { success: false, error: 'Feishu app ID or secret not configured' };
    }

    try {
      const accessToken = await this.getAccessToken();
      if (!accessToken) {
        return { success: false, error: 'Failed to get access token' };
      }

      const response = await fetch(`${this.apiBase}/im/v1/messages/${messageId}/reactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          reaction_type: {
            emoji_type: emojiType,
          },
        }),
      });

      const result = await response.json();

      if (result.code !== 0) {
        return { success: false, error: result.msg };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Format content - Feishu uses lark_md markdown variant
   */
  formatContent(content: string, parseMode?: 'markdown' | 'html' | 'plain'): string {
    return content;
  }

  /**
   * Health check - verify app credentials work
   */
  async healthCheck(): Promise<{ healthy: boolean; error?: string }> {
    if (!this.appId || !this.appSecret) {
      return { healthy: false, error: 'App ID or secret not configured' };
    }

    try {
      const token = await this.getAccessToken();
      return { healthy: !!token, error: token ? undefined : 'Failed to get access token' };
    } catch (error) {
      return { healthy: false, error: String(error) };
    }
  }

  // ==================== Private Methods ====================

  /**
   * Get tenant access token (cached)
   */
  private async getAccessToken(): Promise<string | null> {
    // Check cache
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.accessToken;
    }

    try {
      const response = await fetch(`${this.apiBase}/auth/v3/tenant_access_token/internal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: this.appId,
          app_secret: this.appSecret,
        }),
      });

      const result = await response.json();

      if (result.code !== 0 || !result.tenant_access_token) {
        console.error('Failed to get Feishu access token:', result.msg);
        return null;
      }

      // Cache the token (expire 5 minutes early for safety)
      const expiresIn = result.expire || 7200;
      this.tokenCache = {
        accessToken: result.tenant_access_token,
        expiresAt: Date.now() + (expiresIn - 300) * 1000,
      };

      return this.tokenCache.accessToken;
    } catch (error) {
      console.error('Error getting Feishu access token:', error);
      return null;
    }
  }

  /**
   * Extract plain text from Feishu post (rich text) message content
   */
  private extractPostText(contentJson: Record<string, unknown>): string {
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
   * Build Feishu interactive card content
   */
  private buildCardContent(content: string): Record<string, unknown> {
    const elements = this.buildCardElements(content);

    return {
      config: {
        wide_screen_mode: true,
      },
      elements: elements,
    };
  }

  /**
   * Build card elements from markdown content
   * Supports markdown tables and headings
   */
  private buildCardElements(content: string): Array<Record<string, unknown>> {
    const elements: Array<Record<string, unknown>> = [];

    // Regex for markdown tables
    const tableRegex = /((?:^[ \t]*\|.+\|[ \t]*\n)(?:^[ \t]*\|[-:\s|]+\|[ \t]*\n)(?:^[ \t]*\|.+\|[ \t]*\n?)+)/gm;

    // Regex for headings
    const headingRegex = /^(#{1,6})\s+(.+)$/gm;

    // Regex for code blocks
    const codeBlockRegex = /(```[\s\S]*?```)/g;

    // Protect code blocks
    const codeBlocks: string[] = [];
    let protectedContent = content.replace(codeBlockRegex, match => {
      codeBlocks.push(match);
      return `\x00CODE${codeBlocks.length - 1}\x00`;
    });

    let lastEnd = 0;
    let match: RegExpExecArray | null;

    // Find tables
    while ((match = tableRegex.exec(protectedContent)) !== null) {
      // Add content before table
      const before = protectedContent.slice(lastEnd, match.index).trim();
      if (before) {
        elements.push(...this.splitByHeadings(before));
      }

      // Parse table
      const tableElement = this.parseMarkdownTable(match[1]);
      if (tableElement) {
        elements.push(tableElement);
      } else {
        elements.push({ tag: 'markdown', content: match[1] });
      }

      lastEnd = match.index + match[0].length;
    }

    // Add remaining content
    const remaining = protectedContent.slice(lastEnd).trim();
    if (remaining) {
      elements.push(...this.splitByHeadings(remaining));
    }

    // Restore code blocks
    for (let i = 0; i < codeBlocks.length; i++) {
      for (const el of elements) {
        if (el.tag === 'markdown' && typeof el.content === 'string') {
          el.content = el.content.replace(`\x00CODE${i}\x00`, codeBlocks[i]);
        }
      }
    }

    return elements.length > 0 ? elements : [{ tag: 'markdown', content }];
  }

  /**
   * Split content by headings, converting headings to div elements
   */
  private splitByHeadings(content: string): Array<Record<string, unknown>> {
    const headingRegex = /^(#{1,6})\s+(.+)$/gm;
    const elements: Array<Record<string, unknown>> = [];
    let lastEnd = 0;
    let match: RegExpExecArray | null;

    while ((match = headingRegex.exec(content)) !== null) {
      // Add content before heading
      const before = content.slice(lastEnd, match.index).trim();
      if (before) {
        elements.push({ tag: 'markdown', content: before });
      }

      // Add heading as div
      const text = match[2].trim();
      elements.push({
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**${text}**`,
        },
      });

      lastEnd = match.index + match[0].length;
    }

    // Add remaining content
    const remaining = content.slice(lastEnd).trim();
    if (remaining) {
      elements.push({ tag: 'markdown', content: remaining });
    }

    return elements.length > 0 ? elements : [{ tag: 'markdown', content }];
  }

  /**
   * Parse markdown table into Feishu table element
   */
  private parseMarkdownTable(tableText: string): Record<string, unknown> | null {
    const lines = tableText
      .trim()
      .split('\n')
      .map(l => l.trim())
      .filter(l => l);

    if (lines.length < 3) return null;

    const splitRow = (line: string) =>
      line
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map(c => c.trim());

    const headers = splitRow(lines[0]);
    const rows = lines.slice(2).map(splitRow);

    const columns = headers.map((h, i) => ({
      tag: 'column',
      name: `c${i}`,
      display_name: h,
      width: 'auto',
    }));

    const rowData = rows.map(row => {
      const obj: Record<string, string> = {};
      headers.forEach((_, i) => {
        obj[`c${i}`] = row[i] || '';
      });
      return obj;
    });

    return {
      tag: 'table',
      page_size: rows.length + 1,
      columns,
      rows: rowData,
    };
  }
}

// Auto-register this channel
registerChannel('feishu', FeishuChannel);
