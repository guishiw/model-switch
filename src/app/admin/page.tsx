import { Dashboard } from '@/components/admin/dashboard';

export const dynamic = 'force-dynamic';

export default function AdminHome() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">实时监控</h1>
      <Dashboard />
    </div>
  );
}
