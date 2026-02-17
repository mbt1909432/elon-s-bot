/**
 * Base Channel Adapter
 * Abstract class defining the standard interface for all platform adapters
 * Based on nanobot's BaseChannel pattern
 */

import { InboundMessage, OutboundMessage, WebhookVerification, ChannelConfig } from './types';

export interface ChannelAdapterOptions {
  config: ChannelConfig;
  userId?: string;
  conversationId?: string;
}

export abstract class BaseChannel {
  abstract readonly name: string;
  abstract readonly platform: string;

  protected config: ChannelConfig;
  protected userId?: string;
  protected conversationId?: string;

  constructor(options: ChannelAdapterOptions) {
    this.config = options.config;
    this.userId = options.userId;
    this.conversationId = options.conversationId;
  }

  /**
   * Verify webhook request authenticity
   * Each platform has its own verification mechanism
   */
  abstract verifyWebhook(request: Request): Promise<WebhookVerification>;

  /**
   * Parse incoming webhook request into unified InboundMessage
   */
  abstract parseWebhook(request: Request): Promise<InboundMessage>;

  /**
   * Send message to the platform
   */
  abstract sendMessage(message: OutboundMessage): Promise<{ success: boolean; messageId?: string; error?: string }>;

  /**
   * Format message content for the platform
   * Convert Markdown to platform-specific format (HTML, Markdown variant, etc.)
   */
  abstract formatContent(content: string, parseMode?: 'markdown' | 'html' | 'plain'): string;

  /**
   * Get platform-specific file URL from file ID (optional)
   */
  getFileUrl?(fileId: string): Promise<string>;

  /**
   * Download media file from platform (optional)
   */
  downloadMedia?(fileId: string): Promise<Blob>;

  /**
   * Send typing indicator (optional)
   */
  sendTypingIndicator?(chatId: string): Promise<void>;

  /**
   * Health check for the channel connection
   */
  async healthCheck(): Promise<{ healthy: boolean; error?: string }> {
    return { healthy: true };
  }

  /**
   * Split long messages for platforms with character limits
   */
  protected splitMessage(content: string, maxLength: number): string[] {
    if (content.length <= maxLength) {
      return [content];
    }

    const messages: string[] = [];
    let remaining = content;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        messages.push(remaining);
        break;
      }

      // Try to find a good break point
      let breakPoint = remaining.lastIndexOf('\n\n', maxLength);
      if (breakPoint < maxLength * 0.5) {
        breakPoint = remaining.lastIndexOf('\n', maxLength);
      }
      if (breakPoint < maxLength * 0.5) {
        breakPoint = remaining.lastIndexOf('. ', maxLength);
      }
      if (breakPoint < maxLength * 0.5) {
        breakPoint = remaining.lastIndexOf(' ', maxLength);
      }
      if (breakPoint < maxLength * 0.5) {
        breakPoint = maxLength - 1;
      }

      messages.push(remaining.slice(0, breakPoint + 1).trim());
      remaining = remaining.slice(breakPoint + 1).trim();
    }

    return messages;
  }

  /**
   * Escape special characters for platform
   */
  protected escapeHtml(text: string): string {
    const htmlEntities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return text.replace(/[&<>"']/g, char => htmlEntities[char] || char);
  }

  /**
   * Clean and validate message content
   */
  protected sanitizeContent(content: string): string {
    return content.trim();
  }
}

/**
 * Channel Factory
 * Creates appropriate channel adapter based on platform
 */
export type ChannelConstructor = new (options: ChannelAdapterOptions) => BaseChannel;

let channelRegistry: Map<string, ChannelConstructor> = new Map();

export function registerChannel(platform: string, adapter: ChannelConstructor): void {
  channelRegistry.set(platform, adapter);
}

export function getChannelAdapter(platform: string, options: ChannelAdapterOptions): BaseChannel | null {
  const Adapter = channelRegistry.get(platform);
  if (!Adapter) {
    return null;
  }
  return new Adapter(options);
}

export function getRegisteredPlatforms(): string[] {
  return Array.from(channelRegistry.keys());
}
