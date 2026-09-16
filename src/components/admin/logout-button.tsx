'use client';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function LogoutButton() {
  const router = useRouter();
  return (
    <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={async () => { await fetch('/api/admin/login', { method: 'DELETE' }); router.push('/admin/login'); }}>
      <LogOut className="h-4 w-4" /> 退出登录
    </Button>
  );
}
