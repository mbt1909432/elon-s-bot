/**
 * Channel Types - Unified message model for multi-platform integration
 * Based on nanobot's InboundMessage/OutboundMessage pattern
 */

import { z } from 'zod';

// Supported platforms
export type ChannelPlatform = 'telegram' | 'discord' | 'feishu' | 'web';

// Media attachment types
export interface MediaAttachment {
  type: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  url: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  caption?: string;
}

// Unified inbound message from any platform
export interface InboundMessage {
  id?: string;
  channel: ChannelPlatform;
  senderId: string;
  senderName?: string;
  senderUsername?: string;
  chatId: string;
  chatType?: 'private' | 'group' | 'channel';
  content: string;
  media?: MediaAttachment[];
  replyTo?: string; // Message ID being replied to
  metadata?: Record<string, unknown>;
  timestamp: Date;
  raw?: unknown; // Original platform-specific payload
}

// Unified outbound message to any platform
export interface OutboundMessage {
  channel: ChannelPlatform;
  chatId: string;
  content: string;
  replyTo?: string;
  media?: MediaAttachment[];
  metadata?: Record<string, unknown>;
  parseMode?: 'markdown' | 'html' | 'plain';
}

// Channel connection config stored in database
export interface ChannelConfig {
  // Telegram
  telegramBotToken?: string;

  // Discord
  discordBotToken?: string;
  discordApplicationId?: string;
  discordPublicKey?: string;

  // Feishu
  feishuAppId?: string;
  feishuAppSecret?: string;
  feishuEncryptKey?: string;
  feishuVerificationToken?: string;

  // Generic
  webhookUrl?: string;
  customSettings?: Record<string, unknown>;
}

// Channel record from database
export interface ChannelRecord {
  id: string;
  userId: string;
  platform: ChannelPlatform;
  platformUserId: string;
  platformChatId: string;
  conversationId?: string;
  config: ChannelConfig;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Webhook verification result
export interface WebhookVerification {
  valid: boolean;
  error?: string;
  challenge?: string; // For platform verification challenges
}

// Platform-specific event types
export type TelegramUpdate = {
  message?: {
    message_id: number;
    from?: {
      id: number;
      is_bot: boolean;
      first_name: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
    chat: {
      id: number;
      type: 'private' | 'group' | 'supergroup' | 'channel';
      title?: string;
      username?: string;
    };
    date: number;
    text?: string;
    caption?: string;
    photo?: Array<{ file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }>;
    document?: {
      file_id: string;
      file_unique_id: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
    };
    video?: {
      file_id: string;
      file_unique_id: string;
      width: number;
      height: number;
      duration: number;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
    };
    audio?: {
      file_id: string;
      file_unique_id: string;
      duration: number;
      performer?: string;
      title?: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
    };
    voice?: {
      file_id: string;
      file_unique_id: string;
      duration: number;
      mime_type?: string;
      file_size?: number;
    };
    reply_to_message?: TelegramUpdate['message'];
  };
  edited_message?: TelegramUpdate['message'];
  callback_query?: {
    id: string;
    from: NonNullable<TelegramUpdate['message']>['from'];
    message?: TelegramUpdate['message'];
    data?: string;
  };
};

export type DiscordInteraction = {
  id: string;
  application_id: string;
  type: number; // 1 = PING, 2 = APPLICATION_COMMAND, 3 = MESSAGE_COMPONENT
  data?: {
    id: string;
    name: string;
    type: number;
    options?: Array<{
      name: string;
      type: number;
      value: string | number | boolean;
    }>;
    resolved?: Record<string, unknown>;
  };
  guild_id?: string;
  channel_id?: string;
  member?: {
    user: {
      id: string;
      username: string;
      discriminator: string;
      avatar?: string;
      bot?: boolean;
      system?: boolean;
      public_flags?: number;
    };
    nick?: string;
    roles: string[];
    joined_at: string;
    premium_since?: string;
    pending?: boolean;
    permissions: string;
  };
  user?: DiscordInteraction['member']['user'];
  token: string;
  version: number;
  message?: {
    id: string;
    channel_id: string;
    guild_id?: string;
    content: string;
    author: DiscordInteraction['member']['user'];
  };
};

export type FeishuEvent = {
  schema: string;
  header: {
    event_id: string;
    event_type: string;
    create_time: string;
    token: string;
    app_id: string;
    tenant_key: string;
  };
  event: {
    sender: {
      sender_id: {
        union_id: string;
        user_id: string;
        open_id: string;
      };
      sender_type: string;
      tenant_key: string;
    };
    message: {
      message_id: string;
      root_id?: string;
      parent_id?: string;
      create_time: string;
      chat_id: string;
      message_type: string;
      content: string;
      mentions?: Array<{
        key: string;
        id: {
          union_id: string;
          user_id: string;
          open_id: string;
        };
        name: string;
        tenant_key: string;
      }>;
    };
  };
};

// Zod schemas for validation
export const InboundMessageSchema = z.object({
  id: z.string().optional(),
  channel: z.enum(['telegram', 'discord', 'feishu', 'web']),
  senderId: z.string(),
  senderName: z.string().optional(),
  senderUsername: z.string().optional(),
  chatId: z.string(),
  chatType: z.enum(['private', 'group', 'channel']).optional(),
  content: z.string(),
  media: z.array(z.object({
    type: z.enum(['image', 'video', 'audio', 'document', 'sticker']),
    url: z.string(),
    filename: z.string().optional(),
    mimeType: z.string().optional(),
    size: z.number().optional(),
    caption: z.string().optional(),
  })).optional(),
  replyTo: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  timestamp: z.date().or(z.string().transform(v => new Date(v))),
  raw: z.unknown().optional(),
});

export const OutboundMessageSchema = z.object({
  channel: z.enum(['telegram', 'discord', 'feishu', 'web']),
  chatId: z.string(),
  content: z.string(),
  replyTo: z.string().optional(),
  media: z.array(z.object({
    type: z.enum(['image', 'video', 'audio', 'document', 'sticker']),
    url: z.string(),
    filename: z.string().optional(),
    mimeType: z.string().optional(),
    size: z.number().optional(),
    caption: z.string().optional(),
  })).optional(),
  metadata: z.record(z.unknown()).optional(),
  parseMode: z.enum(['markdown', 'html', 'plain']).optional(),
});
