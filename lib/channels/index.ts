/**
 * Channel Module - Multi-platform integration
 *
 * This module provides unified message handling across different platforms:
 * - Telegram
 * - Discord
 * - Feishu (Lark)
 * - Web (built-in)
 *
 * Usage:
 * ```typescript
 * import { getChannelAdapter, registerChannel } from '@/lib/channels';
 * import { TelegramChannel } from '@/lib/channels/telegram';
 *
 * // Register adapters (typically done at app startup)
 * registerChannel('telegram', TelegramChannel);
 *
 * // Create adapter instance
 * const adapter = getChannelAdapter('telegram', { config: { telegramBotToken: 'xxx' } });
 *
 * // Handle webhook
 * const message = await adapter.parseWebhook(request);
 * ```
 */

export * from './types';
export * from './base';
export * from './telegram';
export * from './discord';
export * from './feishu';

// Re-export commonly used types and functions
export type {
  InboundMessage,
  OutboundMessage,
  ChannelPlatform,
  MediaAttachment,
  ChannelConfig,
  ChannelRecord,
  WebhookVerification,
} from './types';

export {
  BaseChannel,
  getChannelAdapter,
  registerChannel,
  getRegisteredPlatforms,
  type ChannelAdapterOptions,
  type ChannelConstructor,
} from './base';
