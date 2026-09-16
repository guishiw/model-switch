'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { fmt } from '@/lib/utils';

type Token = { id: string; name: string; hint: string; enabled: boolean; rpmLimit: number; tpmLimit: number; tokenQuota: number; tokensUsed: number; allowedModels: string[]; lastUsedAt?: string; user: { username: string; tier: number } };

export function TokenManager() {
  const [rows, setRows] = useState<Token[]>([]);
  const [form, setForm] = useState({ name: '', rpmLimit: 0, tpmLimit: 0, tokenQuota: 0, allowedModels: '' });
  const [created, setCreated] = useState('');
  const load = useCallback(() => fetch('/api/admin/tokens').then((r) => r.json()).then(setRows), []);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/admin/tokens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...form, allowedModels: form.allowedModels.split(',').map((s) => s.trim()).filter(Boolean) }) });
    if (res.ok) { const j = await res.json(); setCreated(j.token); setForm({ name: '', rpmLimit: 0, tpmLimit: 0, tokenQuota: 0, allowedModels: '' }); load(); }
  }
  const patch = (id: string, body: Record<string, unknown>) => fetch('/api/admin/tokens', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, ...body }) }).then(load);
  const remove = (id: string) => confirm('确认删除？') && fetch('/api/admin/tokens', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }).then(load);

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <Card>
        <CardHeader><CardTitle className="text-slate-900">创建令牌</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={create} className="space-y-3">
            <div><Label>名称</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label>RPM</Label><Input type="number" value={form.rpmLimit} onChange={(e) => setForm({ ...form, rpmLimit: +e.target.value })} /></div>
              <div><Label>TPM</Label><Input type="number" value={form.tpmLimit} onChange={(e) => setForm({ ...form, tpmLimit: +e.target.value })} /></div>
              <div><Label>总配额</Label><Input type="number" value={form.tokenQuota} onChange={(e) => setForm({ ...form, tokenQuota: +e.target.value })} /></div>
            </div>
            <div><Label>允许模型（逗号分隔，空=全部）</Label><Input value={form.allowedModels} onChange={(e) => setForm({ ...form, allowedModels: e.target.value })} /></div>
            <Button className="w-full">创建</Button>
          </form>
          {created && (
            <div className="mt-3 rounded-md bg-amber-50 p-3 text-xs">
              <div className="font-medium text-amber-800">令牌仅显示一次，请立即保存：</div>
              <code className="mt-1 block break-all">{created}</code>
            </div>
          )}
        </CardContent>
      </Card>
      <Table>
        <THead><TR><TH>名称</TH><TH>用户</TH><TH>令牌</TH><TH>限流</TH><TH>用量 / 配额</TH><TH>最后使用</TH><TH className="text-right">操作</TH></TR></THead>
        <TBody>
          {rows.map((t) => (
            <TR key={t.id}>
              <TD className="font-medium">{t.name}</TD>
              <TD>{t.user.username} <Badge tone="blue">tier {t.user.tier}</Badge></TD>
              <TD className="font-mono text-xs">sk-…{t.hint} <Badge tone={t.enabled ? 'green' : 'red'}>{t.enabled ? 'enabled' : 'disabled'}</Badge></TD>
              <TD className="text-xs">RPM {t.rpmLimit || '∞'} · TPM {t.tpmLimit || '∞'}{t.allowedModels.length ? <div className="text-muted-foreground">{t.allowedModels.join(', ')}</div> : null}</TD>
              <TD className="text-xs">{fmt(t.tokensUsed)} / {t.tokenQuota ? fmt(t.tokenQuota) : '∞'}</TD>
              <TD className="text-xs">{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : '-'}</TD>
              <TD className="text-right">
                <Button size="sm" variant="outline" onClick={() => patch(t.id, { enabled: !t.enabled })}>{t.enabled ? '禁用' : '启用'}</Button>{' '}
                <Button size="sm" variant="ghost" className="text-red-600" onClick={() => remove(t.id)}>删除</Button>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
