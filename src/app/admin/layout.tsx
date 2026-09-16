import Link from 'next/link';
import { Activity, KeyRound, ScrollText, Server, LogOut } from 'lucide-react';
import { LogoutButton } from '@/components/admin/logout-button';

const nav = [
  { href: '/admin', label: '监控面板', icon: Activity },
  { href: '/admin/channels', label: '渠道管理', icon: Server },
  { href: '/admin/tokens', label: '访问令牌', icon: KeyRound },
  { href: '/admin/logs', label: '请求日志', icon: ScrollText },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r border-border bg-white">
        <div className="px-5 py-4 text-base font-semibold">LLM Relay</div>
        <nav className="flex-1 space-y-1 px-3">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-muted">
              <Icon className="h-4 w-4" /> {label}
            </Link>
          ))}
        </nav>
        <div className="p-3"><LogoutButton /></div>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
