import { ChannelSettings } from '@/components/channels/channel-settings';
import { createClient } from '@/lib/supabase/server';

export default async function SettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  return (
    <div className="container py-8">
      <ChannelSettings userId={user.id} />
    </div>
  );
}
