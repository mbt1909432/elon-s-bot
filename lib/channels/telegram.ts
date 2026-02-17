/**
 * Telegram Channel Adapter
 * Webhook-based implementation for Telegram Bot API
 */

import { BaseChannel, registerChannel, type ChannelAdapterOptions } from './base';
import {
  InboundMessage,
  OutboundMessage,
  WebhookVerification,
  ChannelConfig,
  TelegramUpdate,
  MediaAttachment,
} from './types';

// Telegram API base URL
const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

// Maximum message length for Telegram
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

// Recommended split length (slightly less for safety)
const TELEGRAM_SPLIT_LENGTH = 4000;

export class TelegramChannel extends BaseChannel {
  readonly name = 'Telegram';
  readonly platform = 'telegram';

  private botToken: string;

  constructor(options: ChannelAdapterOptions) {
    super(options);
    this.botToken = options.config.telegramBotToken || '';
  }

  /**
   * Verify webhook request using secret token (if configured)
   * Telegram sends X-Telegram-Bot-Api-Secret-Token header
   */
  async verifyWebhook(request: Request): Promise<WebhookVerification> {
    // If we have a secret token configured, verify it
    const secretToken = this.config.customSettings?.telegramSecretToken;
    if (secretToken) {
      const headerToken = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (headerToken !== secretToken) {
        return { valid: false, error: 'Invalid secret token' };
      }
    }
    return { valid: true };
  }

  /**
   * Parse incoming Telegram webhook update
   */
  async parseWebhook(request: Request): Promise<InboundMessage> {
    const body = (await request.json()) as TelegramUpdate;

    // Handle callback queries (inline button presses)
    if (body.callback_query) {
      return this.parseCallbackQuery(body);
    }

    // Handle regular messages
    const message = body.message || body.edited_message;
    if (!message) {
      throw new Error('No message in Telegram update');
    }

    const user = message.from;
    if (!user) {
      throw new Error('No user in Telegram message');
    }

    // Build content
    const contentParts: string[] = [];
    const media: MediaAttachment[] = [];

    // Text content
    if (message.text) {
      contentParts.push(message.text);
    }
    if (message.caption) {
      contentParts.push(message.caption);
    }

    // Handle photos
    if (message.photo && message.photo.length > 0) {
      const largestPhoto = message.photo[message.photo.length - 1];
      media.push({
        type: 'image',
        url: largestPhoto.file_id, // Will need to be resolved to actual URL
        mimeType: 'image/jpeg',
        size: largestPhoto.file_size,
      });
    }

    // Handle documents
    if (message.document) {
      media.push({
        type: 'document',
        url: message.document.file_id,
        filename: message.document.file_name,
        mimeType: message.document.mime_type,
        size: message.document.file_size,
      });
    }

    // Handle videos
    if (message.video) {
      media.push({
        type: 'video',
        url: message.video.file_id,
        filename: message.video.file_name,
        mimeType: message.video.mime_type,
        size: message.video.file_size,
      });
    }

    // Handle audio/voice
    if (message.audio) {
      media.push({
        type: 'audio',
        url: message.audio.file_id,
        filename: message.audio.file_name,
        mimeType: message.audio.mime_type,
        size: message.audio.file_size,
      });
    }
    if (message.voice) {
      media.push({
        type: 'audio',
        url: message.voice.file_id,
        mimeType: message.voice.mime_type || 'audio/ogg',
        size: message.voice.file_size,
      });
    }

    return {
      id: String(message.message_id),
      channel: 'telegram',
      senderId: this.buildSenderId(user),
      senderName: [user.first_name, user.last_name].filter(Boolean).join(' '),
      senderUsername: user.username,
      chatId: String(message.chat.id),
      chatType: this.mapChatType(message.chat.type),
      content: contentParts.join('\n') || '[media]',
      media: media.length > 0 ? media : undefined,
      replyTo: message.reply_to_message ? String(message.reply_to_message.message_id) : undefined,
      metadata: {
        userId: user.id,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        languageCode: user.language_code,
        isBot: user.is_bot,
        isGroup: message.chat.type !== 'private',
        messageId: message.message_id,
        editDate: message.edit_date,
      },
      timestamp: new Date(message.date * 1000),
      raw: body,
    };
  }

  /**
   * Parse callback query (inline button press)
   */
  private parseCallbackQuery(body: TelegramUpdate): InboundMessage {
    const callback = body.callback_query!;
    const user = callback.from;
    const message = callback.message;

    return {
      id: callback.id,
      channel: 'telegram',
      senderId: user ? this.buildSenderId(user) : 'unknown',
      senderName: user ? [user.first_name, user.last_name].filter(Boolean).join(' ') : 'Unknown',
      senderUsername: user?.username,
      chatId: String(message?.chat.id || ''),
      chatType: message?.chat ? this.mapChatType(message.chat.type) : 'private',
      content: callback.data || '',
      metadata: {
        type: 'callback_query',
        callbackId: callback.id,
        queryData: callback.data,
        userId: user?.id,
        username: user?.username,
      },
      timestamp: new Date(),
      raw: body,
    };
  }

  /**
   * Send message to Telegram
   */
  async sendMessage(message: OutboundMessage): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.botToken) {
      return { success: false, error: 'Telegram bot token not configured' };
    }

    const chatId = parseInt(message.chatId, 10);
    if (isNaN(chatId)) {
      return { success: false, error: 'Invalid chat ID' };
    }

    try {
      // Split long messages
      const chunks = this.splitMessage(message.content, TELEGRAM_SPLIT_LENGTH);

      let lastMessageId: string | undefined;

      for (const chunk of chunks) {
        const html = this.markdownToTelegramHtml(chunk);

        const response = await fetch(`${TELEGRAM_API_BASE}${this.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: html,
            parse_mode: 'HTML',
            reply_to_message_id: message.replyTo ? parseInt(message.replyTo, 10) : undefined,
            disable_web_page_preview: message.metadata?.disablePreview ?? false,
          }),
        });

        const result = await response.json();

        if (!result.ok) {
          // If HTML parsing fails, try plain text
          if (result.description?.includes('parse')) {
            const fallbackResponse = await fetch(`${TELEGRAM_API_BASE}${this.botToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: chunk,
                reply_to_message_id: message.replyTo ? parseInt(message.replyTo, 10) : undefined,
              }),
            });

            const fallbackResult = await fallbackResponse.json();
            if (!fallbackResult.ok) {
              return { success: false, error: fallbackResult.description };
            }
            lastMessageId = String(fallbackResult.result.message_id);
          } else {
            return { success: false, error: result.description };
          }
        } else {
          lastMessageId = String(result.result.message_id);
        }
      }

      return { success: true, messageId: lastMessageId };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Format content - convert Markdown to Telegram HTML
   */
  formatContent(content: string, parseMode?: 'markdown' | 'html' | 'plain'): string {
    if (parseMode === 'plain') {
      return content;
    }
    return this.markdownToTelegramHtml(content);
  }

  /**
   * Get file URL from Telegram file_id
   */
  async getFileUrl(fileId: string): Promise<string> {
    if (!this.botToken) {
      throw new Error('Bot token not configured');
    }

    const response = await fetch(`${TELEGRAM_API_BASE}${this.botToken}/getFile?file_id=${fileId}`);
    const result = await response.json();

    if (!result.ok) {
      throw new Error(result.description || 'Failed to get file info');
    }

    return `https://api.telegram.org/file/bot${this.botToken}/${result.result.file_path}`;
  }

  /**
   * Send typing indicator
   */
  async sendTypingIndicator(chatId: string): Promise<void> {
    if (!this.botToken) return;

    try {
      await fetch(`${TELEGRAM_API_BASE}${this.botToken}/sendChatAction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: parseInt(chatId, 10),
          action: 'typing',
        }),
      });
    } catch {
      // Ignore typing indicator errors
    }
  }

  /**
   * Health check - verify bot token works
   */
  async healthCheck(): Promise<{ healthy: boolean; error?: string }> {
    if (!this.botToken) {
      return { healthy: false, error: 'Bot token not configured' };
    }

    try {
      const response = await fetch(`${TELEGRAM_API_BASE}${this.botToken}/getMe`);
      const result = await response.json();

      if (result.ok) {
        return { healthy: true };
      }
      return { healthy: false, error: result.description };
    } catch (error) {
      return { healthy: false, error: String(error) };
    }
  }

  /**
   * Answer callback query (for inline buttons)
   */
  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<boolean> {
    if (!this.botToken) return false;

    try {
      const response = await fetch(`${TELEGRAM_API_BASE}${this.botToken}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text: text,
        }),
      });

      const result = await response.json();
      return result.ok;
    } catch {
      return false;
    }
  }

  /**
   * Set webhook URL for this bot
   */
  async setWebhook(webhookUrl: string, secretToken?: string): Promise<{ success: boolean; error?: string }> {
    if (!this.botToken) {
      return { success: false, error: 'Bot token not configured' };
    }

    try {
      const body: Record<string, unknown> = {
        url: webhookUrl,
        allowed_updates: ['message', 'edited_message', 'callback_query'],
      };

      if (secretToken) {
        body.secret_token = secretToken;
      }

      const response = await fetch(`${TELEGRAM_API_BASE}${this.botToken}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const result = await response.json();

      if (result.ok) {
        return { success: true };
      }
      return { success: false, error: result.description };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ==================== Private Helper Methods ====================

  /**
   * Build sender ID with optional username for allowlist matching
   */
  private buildSenderId(user: NonNullable<TelegramUpdate['message']>['from'] | undefined): string {
    if (!user) return 'unknown';
    const id = String(user.id);
    return user.username ? `${id}|${user.username}` : id;
  }

  /**
   * Map Telegram chat type to our unified type
   */
  private mapChatType(type: string): 'private' | 'group' | 'channel' {
    switch (type) {
      case 'private':
        return 'private';
      case 'group':
      case 'supergroup':
        return 'group';
      case 'channel':
        return 'channel';
      default:
        return 'private';
    }
  }

  /**
   * Convert Markdown to Telegram-safe HTML
   * Based on nanobot's _markdown_to_telegram_html function
   */
  private markdownToTelegramHtml(text: string): string {
    if (!text) return '';

    // 1. Extract and protect code blocks (preserve content from other processing)
    const codeBlocks: string[] = [];
    text = text.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) => {
      codeBlocks.push(code);
      return `\x00CB${codeBlocks.length - 1}\x00`;
    });

    // 2. Extract and protect inline code
    const inlineCodes: string[] = [];
    text = text.replace(/`([^`]+)`/g, (_, code) => {
      inlineCodes.push(code);
      return `\x00IC${inlineCodes.length - 1}\x00`;
    });

    // 3. Headers # Title -> just the title text (make it bold)
    text = text.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');

    // 4. Blockquotes > text -> just the text
    text = text.replace(/^>\s*(.*)$/gm, '$1');

    // 5. Escape HTML special characters (but not our markers)
    text = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // 6. Links [text](url) - must be before bold/italic
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // 7. Bold **text** or __text__
    text = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    text = text.replace(/__(.+?)__/g, '<b>$1</b>');

    // 8. Italic _text_ (avoid matching inside words)
    text = text.replace(/(?<![a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])/g, '<i>$1</i>');

    // 9. Strikethrough ~~text~~
    text = text.replace(/~~(.+?)~~/g, '<s>$1</s>');

    // 10. Bullet lists - item -> • item
    text = text.replace(/^[-*]\s+/gm, '• ');

    // 11. Restore inline code with HTML tags
    inlineCodes.forEach((code, i) => {
      const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      text = text.replace(`\x00IC${i}\x00`, `<code>${escaped}</code>`);
    });

    // 12. Restore code blocks with HTML tags
    codeBlocks.forEach((code, i) => {
      const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      text = text.replace(`\x00CB${i}\x00`, `<pre><code>${escaped}</code></pre>`);
    });

    return text;
  }
}

// Auto-register this channel
registerChannel('telegram', TelegramChannel);
