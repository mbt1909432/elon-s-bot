'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

type ChannelPlatform = 'telegram' | 'discord' | 'feishu';
type ChannelStatus = 'connected' | 'disconnected' | 'error';

interface Channel {
  id: string;
  platform: ChannelPlatform;
  platformChatId: string;
  enabled: boolean;
  status?: ChannelStatus;
  createdAt: string;
}

interface ChannelSettingsProps {
  userId: string;
}

const platformInfo: Record<ChannelPlatform, { name: string; icon: string; description: string }> = {
  telegram: {
    name: 'Telegram',
    icon: '📱',
    description: 'Connect your Telegram bot to receive and send messages',
  },
  discord: {
    name: 'Discord',
    icon: '💬',
    description: 'Connect your Discord bot for server and DM interactions',
  },
  feishu: {
    name: 'Feishu',
    icon: '🪶',
    description: 'Connect your Feishu/Lark bot for enterprise messaging',
  },
};

export function ChannelSettings({ userId }: ChannelSettingsProps) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [configuring, setConfiguring] = useState<ChannelPlatform | null>(null);
  const [config, setConfig] = useState<Record<string, string>>({});

  // Form states
  const [telegramToken, setTelegramToken] = useState('');
  const [discordToken, setDiscordToken] = useState('');
  const [discordAppId, setDiscordAppId] = useState('');
  const [discordPublicKey, setDiscordPublicKey] = useState('');
  const [feishuAppId, setFeishuAppId] = useState('');
  const [feishuAppSecret, setFeishuAppSecret] = useState('');

  useEffect(() => {
    fetchChannels();
  }, []);

  const fetchChannels = async () => {
    try {
      const response = await fetch('/api/channels');
      if (response.ok) {
        const data = await response.json();
        setChannels(data.channels || []);
      }
    } catch (error) {
      console.error('Failed to fetch channels:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConfigure = (platform: ChannelPlatform) => {
    setConfiguring(platform);
  };

  const handleSaveTelegram = async () => {
    try {
      const response = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'telegram',
          config: { telegramBotToken: telegramToken },
        }),
      });

      if (response.ok) {
        setConfiguring(null);
        setTelegramToken('');
        fetchChannels();
      }
    } catch (error) {
      console.error('Failed to save Telegram config:', error);
    }
  };

  const handleSaveDiscord = async () => {
    try {
      const response = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'discord',
          config: {
            discordBotToken: discordToken,
            discordApplicationId: discordAppId,
            discordPublicKey: discordPublicKey,
          },
        }),
      });

      if (response.ok) {
        setConfiguring(null);
        setDiscordToken('');
        setDiscordAppId('');
        setDiscordPublicKey('');
        fetchChannels();
      }
    } catch (error) {
      console.error('Failed to save Discord config:', error);
    }
  };

  const handleSaveFeishu = async () => {
    try {
      const response = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'feishu',
          config: {
            feishuAppId: feishuAppId,
            feishuAppSecret: feishuAppSecret,
          },
        }),
      });

      if (response.ok) {
        setConfiguring(null);
        setFeishuAppId('');
        setFeishuAppSecret('');
        fetchChannels();
      }
    } catch (error) {
      console.error('Failed to save Feishu config:', error);
    }
  };

  const handleDelete = async (channelId: string) => {
    if (!confirm('Are you sure you want to delete this channel?')) return;

    try {
      const response = await fetch(`/api/channels?id=${channelId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        fetchChannels();
      }
    } catch (error) {
      console.error('Failed to delete channel:', error);
    }
  };

  const getStatusBadge = (status?: ChannelStatus) => {
    switch (status) {
      case 'connected':
        return <Badge variant="default">Connected</Badge>;
      case 'error':
        return <Badge variant="destructive">Error</Badge>;
      default:
        return <Badge variant="secondary">Disconnected</Badge>;
    }
  };

  if (loading) {
    return <div className="p-4">Loading channels...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Channel Settings</h2>
        <p className="text-muted-foreground">
          Connect ElonsBot to your favorite messaging platforms
        </p>
      </div>

      {/* Platform Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {(Object.keys(platformInfo) as ChannelPlatform[]).map(platform => {
          const info = platformInfo[platform];
          const existingChannel = channels.find(c => c.platform === platform);

          return (
            <Card key={platform}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span>{info.icon}</span>
                  {info.name}
                </CardTitle>
                <CardDescription>{info.description}</CardDescription>
              </CardHeader>
              <CardContent>
                {existingChannel ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      {getStatusBadge(existingChannel.status)}
                      <span className="text-sm text-muted-foreground">
                        {existingChannel.platformChatId.slice(0, 12)}...
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => handleDelete(existingChannel.id)}
                    >
                      Disconnect
                    </Button>
                  </div>
                ) : (
                  <Button className="w-full" onClick={() => handleConfigure(platform)}>
                    Connect
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Configuration Modals */}
      {configuring === 'telegram' && (
        <Card>
          <CardHeader>
            <CardTitle>Configure Telegram Bot</CardTitle>
            <CardDescription>
              Enter your Telegram bot token from @BotFather
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="telegram-token">Bot Token</Label>
              <Input
                id="telegram-token"
                type="password"
                placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                value={telegramToken}
                onChange={e => setTelegramToken(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSaveTelegram}>Save</Button>
              <Button variant="outline" onClick={() => setConfiguring(null)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {configuring === 'discord' && (
        <Card>
          <CardHeader>
            <CardTitle>Configure Discord Bot</CardTitle>
            <CardDescription>
              Enter your Discord bot credentials from the Developer Portal
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="discord-token">Bot Token</Label>
              <Input
                id="discord-token"
                type="password"
                placeholder="Bot token"
                value={discordToken}
                onChange={e => setDiscordToken(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="discord-app-id">Application ID</Label>
              <Input
                id="discord-app-id"
                placeholder="Application ID"
                value={discordAppId}
                onChange={e => setDiscordAppId(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="discord-public-key">Public Key</Label>
              <Input
                id="discord-public-key"
                placeholder="Public Key for verification"
                value={discordPublicKey}
                onChange={e => setDiscordPublicKey(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSaveDiscord}>Save</Button>
              <Button variant="outline" onClick={() => setConfiguring(null)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {configuring === 'feishu' && (
        <Card>
          <CardHeader>
            <CardTitle>Configure Feishu/Lark Bot</CardTitle>
            <CardDescription>
              Enter your Feishu app credentials from the Developer Console
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="feishu-app-id">App ID</Label>
              <Input
                id="feishu-app-id"
                placeholder="cli_xxx"
                value={feishuAppId}
                onChange={e => setFeishuAppId(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="feishu-app-secret">App Secret</Label>
              <Input
                id="feishu-app-secret"
                type="password"
                placeholder="App secret"
                value={feishuAppSecret}
                onChange={e => setFeishuAppSecret(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSaveFeishu}>Save</Button>
              <Button variant="outline" onClick={() => setConfiguring(null)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Webhook URLs */}
      <Card>
        <CardHeader>
          <CardTitle>Webhook URLs</CardTitle>
          <CardDescription>
            Configure these URLs in your platform developer consoles
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Telegram Webhook</Label>
            <code className="block p-2 bg-muted rounded text-sm">
              {process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/channels-telegram
            </code>
          </div>
          <div className="space-y-2">
            <Label>Discord Interactions Endpoint</Label>
            <code className="block p-2 bg-muted rounded text-sm">
              {process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/channels-discord
            </code>
          </div>
          <div className="space-y-2">
            <Label>Feishu Event Subscription</Label>
            <code className="block p-2 bg-muted rounded text-sm">
              {process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/channels-feishu
            </code>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
