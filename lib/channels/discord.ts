/**
 * Discord Channel Adapter
 * Webhook-based implementation using Discord Interactions
 * Supports slash commands and message components
 */

import { BaseChannel, registerChannel, type ChannelAdapterOptions } from './base';
import {
  InboundMessage,
  OutboundMessage,
  WebhookVerification,
  ChannelConfig,
  DiscordInteraction,
  MediaAttachment,
} from './types';

// Discord API constants
const DISCORD_API_BASE = 'https://discord.com/api/v10';
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20MB
const DISCORD_MAX_MESSAGE_LENGTH = 2000;

// Nacl import for Ed25519 verification (for web crypto)
type VerifyEd25519 = (publicKey: string, signature: string, timestamp: string, body: string) => boolean;

export class DiscordChannel extends BaseChannel {
  readonly name = 'Discord';
  readonly platform = 'discord';

  private botToken: string;
  private applicationId: string;
  private publicKey: string;
  private verifyEd25519?: VerifyEd25519;

  constructor(options: ChannelAdapterOptions) {
    super(options);
    this.botToken = options.config.discordBotToken || '';
    this.applicationId = options.config.discordApplicationId || '';
    this.publicKey = options.config.discordPublicKey || '';
  }

  /**
   * Set Ed25519 verification function (injected to avoid nacl dependency in Edge Runtime)
   */
  setVerifyFunction(verifyFn: VerifyEd25519): void {
    this.verifyEd25519 = verifyFn;
  }

  /**
   * Verify Discord webhook request using Ed25519 signature
   * Discord signs requests with X-Signature-Ed25519 and X-Signature-Timestamp
   */
  async verifyWebhook(request: Request): Promise<WebhookVerification> {
    if (!this.publicKey || !this.verifyEd25519) {
      // If no public key or verify function, skip verification
      // (Should only be used in development)
      return { valid: true };
    }

    const signature = request.headers.get('X-Signature-Ed25519');
    const timestamp = request.headers.get('X-Signature-Timestamp');

    if (!signature || !timestamp) {
      return { valid: false, error: 'Missing signature headers' };
    }

    // Clone request to read body without consuming it
    const clonedRequest = request.clone();
    const body = await clonedRequest.text();

    const isValid = this.verifyEd25519(this.publicKey, signature, timestamp, body);

    if (!isValid) {
      return { valid: false, error: 'Invalid request signature' };
    }

    return { valid: true };
  }

  /**
   * Parse incoming Discord interaction
   */
  async parseWebhook(request: Request): Promise<InboundMessage> {
    const body = (await request.json()) as DiscordInteraction;

    // Handle PING (type 1) - should be responded to immediately
    if (body.type === 1) {
      return {
        id: body.id,
        channel: 'discord',
        senderId: 'system',
        chatId: '',
        content: '__DISCORD_PING__',
        metadata: { type: 'ping', interactionId: body.id },
        timestamp: new Date(),
        raw: body,
      };
    }

    // Get user info
    const user = body.member?.user || body.user;
    if (!user) {
      throw new Error('No user in Discord interaction');
    }

    const channelId = body.channel_id || '';
    const guildId = body.guild_id;

    // Parse content based on interaction type
    let content = '';
    let commandName = '';

    if (body.type === 2) {
      // APPLICATION_COMMAND (slash command)
      commandName = body.data?.name || '';
      const options = body.data?.options || [];

      // Build content from command and options
      const optionStr = options
        .map(opt => {
          const value = opt.value;
          if (typeof value === 'string') return value;
          return String(value);
        })
        .join(' ');

      content = optionStr || commandName;
    } else if (body.type === 3) {
      // MESSAGE_COMPONENT (button/select menu)
      const messages = body.data?.resolved?.messages as Record<string, { content?: string }> | undefined;
      if (messages) {
        const firstKey = Object.keys(messages)[0];
        content = messages[firstKey]?.content || '';
      }
      commandName = body.data?.name || 'component';
    } else if (body.type === 4) {
      // AUTOCOMPLETE
      content = body.data?.options?.[0]?.value?.toString() || '';
    }

    return {
      id: body.id,
      channel: 'discord',
      senderId: user.id,
      senderName: body.member?.nick || user.username,
      senderUsername: user.username,
      chatId: channelId,
      chatType: guildId ? 'group' : 'private',
      content,
      replyTo: body.message?.id,
      media: this.extractMediaFromMessage(body.message),
      metadata: {
        type: 'interaction',
        interactionType: body.type,
        interactionId: body.id,
        interactionToken: body.token,
        commandName,
        commandData: body.data,
        guildId,
        memberId: body.member?.user?.id,
        applicationId: body.application_id,
      },
      timestamp: new Date(),
      raw: body,
    };
  }

  /**
   * Send message to Discord
   */
  async sendMessage(message: OutboundMessage): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.botToken) {
      return { success: false, error: 'Discord bot token not configured' };
    }

    const chatId = message.chatId;
    if (!chatId) {
      return { success: false, error: 'Invalid channel ID' };
    }

    try {
      // Split long messages
      const chunks = this.splitMessage(message.content, DISCORD_MAX_MESSAGE_LENGTH);

      let lastMessageId: string | undefined;

      for (const chunk of chunks) {
        const payload: Record<string, unknown> = {
          content: chunk,
        };

        if (message.replyTo) {
          payload.message_reference = { message_id: message.replyTo };
          payload.allowed_mentions = { replied_user: false };
        }

        const response = await fetch(`${DISCORD_API_BASE}/channels/${chatId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bot ${this.botToken}`,
          },
          body: JSON.stringify(payload),
        });

        // Handle rate limiting
        if (response.status === 429) {
          const data = await response.json();
          const retryAfter = data.retry_after || 1;
          await this.sleep(retryAfter * 1000);

          // Retry once
          const retryResponse = await fetch(`${DISCORD_API_BASE}/channels/${chatId}/messages`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bot ${this.botToken}`,
            },
            body: JSON.stringify(payload),
          });

          if (!retryResponse.ok) {
            const retryData = await retryResponse.json();
            return { success: false, error: retryData.message || 'Rate limited' };
          }

          const retryResult = await retryResponse.json();
          lastMessageId = retryResult.id;
        } else if (!response.ok) {
          const data = await response.json();
          return { success: false, error: data.message || `HTTP ${response.status}` };
        } else {
          const result = await response.json();
          lastMessageId = result.id;
        }
      }

      return { success: true, messageId: lastMessageId };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Respond to an interaction (for immediate response)
   * Must be called within 3 seconds of receiving the interaction
   */
  async respondToInteraction(
    interactionToken: string,
    content: string,
    ephemeral: boolean = false
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.botToken) {
      return { success: false, error: 'Discord bot token not configured' };
    }

    try {
      const response = await fetch(
        `${DISCORD_API_BASE}/webhooks/${this.applicationId}/${interactionToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
            data: {
              content,
              flags: ephemeral ? 64 : 0, // EPHEMERAL flag
            },
          }),
        }
      );

      if (!response.ok) {
        const data = await response.json();
        return { success: false, error: data.message };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Follow up on an interaction (for delayed response)
   * Can be called after initial 3-second window
   */
  async followUpInteraction(
    interactionToken: string,
    content: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.botToken) {
      return { success: false, error: 'Discord bot token not configured' };
    }

    try {
      const response = await fetch(
        `${DISCORD_API_BASE}/webhooks/${this.applicationId}/${interactionToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content,
          }),
        }
      );

      if (!response.ok) {
        const data = await response.json();
        return { success: false, error: data.message };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Format content - Discord uses a variant of Markdown
   */
  formatContent(content: string, parseMode?: 'markdown' | 'html' | 'plain'): string {
    if (parseMode === 'plain') {
      // Escape Discord markdown characters
      return content.replace(/([*_~`|>])/g, '\\$1');
    }
    // Discord supports markdown natively
    return content;
  }

  /**
   * Send typing indicator
   */
  async sendTypingIndicator(chatId: string): Promise<void> {
    if (!this.botToken) return;

    try {
      await fetch(`${DISCORD_API_BASE}/channels/${chatId}/typing`, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${this.botToken}`,
        },
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
      const response = await fetch(`${DISCORD_API_BASE}/users/@me`, {
        headers: { Authorization: `Bot ${this.botToken}` },
      });

      if (response.ok) {
        return { healthy: true };
      }
      const data = await response.json();
      return { healthy: false, error: data.message };
    } catch (error) {
      return { healthy: false, error: String(error) };
    }
  }

  /**
   * Register slash commands for the bot
   */
  async registerCommands(
    commands: Array<{ name: string; description: string; options?: unknown[] }>
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.botToken || !this.applicationId) {
      return { success: false, error: 'Bot token or application ID not configured' };
    }

    try {
      const response = await fetch(`${DISCORD_API_BASE}/applications/${this.applicationId}/commands`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bot ${this.botToken}`,
        },
        body: JSON.stringify(commands),
      });

      if (!response.ok) {
        const data = await response.json();
        return { success: false, error: data.message };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ==================== Private Helper Methods ====================

  /**
   * Extract media attachments from a Discord message
   */
  private extractMediaFromMessage(message?: DiscordInteraction['message']): MediaAttachment[] | undefined {
    if (!message) return undefined;

    // Note: Discord message attachments are in a different structure
    // For now, we'll handle this when we have access to the full message object
    return undefined;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ==================== Ed25519 Verification Utility ====================

/**
 * Create an Ed25519 verification function using Web Crypto API
 * This can be used in Edge Runtime environments
 */
export async function createEd25519Verifier(): Promise<VerifyEd25519> {
  // Dynamic import for tweetnacl (or use Web Crypto API)
  const { default: nacl } = await import('tweetnacl');

  return (publicKey: string, signature: string, timestamp: string, body: string): boolean => {
    try {
      const message = new TextEncoder().encode(timestamp + body);
      const sig = hexToUint8Array(signature);
      const pubKey = hexToUint8Array(publicKey);

      return nacl.sign.detached.verify(message, sig, pubKey);
    } catch {
      return false;
    }
  };
}

/**
 * Convert hex string to Uint8Array
 */
function hexToUint8Array(hex: string): Uint8Array {
  const length = hex.length / 2;
  const arr = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

// Auto-register this channel
registerChannel('discord', DiscordChannel);
