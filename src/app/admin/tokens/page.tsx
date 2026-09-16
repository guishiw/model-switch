import { TokenManager } from '@/components/admin/token-manager';
export const dynamic = 'force-dynamic';
export default function TokensPage() {
  return <div className="space-y-6"><h1 className="text-xl font-semibold">访问令牌</h1><TokenManager /></div>;
}
