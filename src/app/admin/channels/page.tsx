import { ChannelManager } from '@/components/admin/channel-manager';

export const dynamic = 'force-dynamic';

export default function ChannelsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">渠道管理</h1>
      <ChannelManager />
    </div>
  );
}
