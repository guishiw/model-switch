'use client';
import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, statusTone } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';

type Mapping = { publicModel: string; upstreamModel: string; maxConcurrency: number };
type Channel = {
  id: string; name: string; provider: string; baseUrl: string; status: string; weight: number; priority: number; rpmLimit: number; tpmLimit: number; maxConcurrency: number;
  inflight?: { channel: number; models: Record<string, number> };
  keys: Array<{ id: string; hint: string; enabled: boolean; disabledReason?: string | null }>;
  modelMappings: Mapping[];
};

const PRESETS: Record<string, string> = {
  OPENAI: 'https://api.openai.com/v1',
  ANTHROPIC: 'https://api.anthropic.com',
  GEMINI: 'https://generativelanguage.googleapis.com',
  OLLAMA: 'http://localhost:11434/v1',
};

const empty = { name: '', provider: 'OPENAI', baseUrl: PRESETS.OPENAI, weight: 10, priority: 0, rpmLimit: 0, tpmLimit: 0, keys: '', mappings: 'gpt-4o=gpt-4o', insecureTls: false };

/** Inline editor: shows live in-flight / limit, saves on blur or Enter. Changes apply immediately (no restart). */
function ConcurrencyCell({ current, limit, onSave }: { current: number; limit: number; onSave: (n: number) => Promise<unknown> }) {
  const [val, setVal] = useState(String(limit));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setVal(String(limit)); }, [limit]);
  const commit = async () => {
    const n = Math.max(0, parseInt(val || '0', 10) || 0);
    if (n === limit) return;
    setSaving(true); await onSave(n); setSaving(false);
  };
  const full = limit > 0 && current >= limit;
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className={full ? 'font-semibold text-red-600' : 'text-muted-foreground'}>{current}</span>
      <span className="text-muted-foreground">/</span>
      <input
        className="h-6 w-14 rounded border border-border px-1 text-center text-xs disabled:opacity-50"
        value={val} disabled={saving} title="并发上限，0 = 不限"
        onChange={(e) => setVal(e.target.value.replace(/\D/g, ''))}
        onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </span>
  );
}

export function ChannelManager() {
  const [rows, setRows] = useState<Channel[]>([]);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => fetch('/api/admin/channels').then((r) => r.json()).then(setRows), []);
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    const { insecureTls, ...rest } = form;
    const payload = {
      ...rest,
      config: insecureTls ? { insecureTls: true } : undefined,
      keys: form.keys.split(/\n|,/).map((s) => s.trim()).filter(Boolean),
      mappings: form.mappings.split(/\n|,/).map((s) => s.trim()).filter(Boolean).map((line) => {
        const [publicModel, upstreamModel = publicModel] = line.split('=').map((s) => s.trim());
        return { publicModel, upstreamModel };
      }),
    };
    const res = await fetch('/api/admin/channels', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    setBusy(false);
    if (!res.ok) return setErr(JSON.stringify((await res.json()).error));
    setForm(empty); load();
  }

  const patch = (id: string, body: unknown) => fetch(`/api/admin/channels/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(load);
  const remove = (id: string) => confirm('确认删除该渠道？') && fetch(`/api/admin/channels/${id}`, { method: 'DELETE' }).then(load);

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <Card>
        <CardHeader><CardTitle className="text-slate-900">新增渠道</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={create} className="space-y-3">
            <div><Label>名称</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="openai-main" /></div>
            <div><Label>提供商</Label>
              <Select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value, baseUrl: PRESETS[e.target.value] })}>
                {Object.keys(PRESETS).map((p) => <option key={p}>{p}</option>)}
              </Select>
            </div>
            <div><Label>Base URL</Label><Input required value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={form.insecureTls} onChange={(e) => setForm({ ...form, insecureTls: e.target.checked })} /> 跳过 TLS 证书校验（自签名内网服务）
            </label>
            <div><Label>API Keys（每行一个，自动轮询）</Label>
              <textarea className="w-full rounded-md border border-border p-2 text-sm" rows={3} value={form.keys} onChange={(e) => setForm({ ...form, keys: e.target.value })} placeholder="sk-..." />
            </div>
            <div><Label>模型映射（公开名=上游名，每行一个）</Label>
              <textarea className="w-full rounded-md border border-border p-2 text-sm font-mono" rows={3} value={form.mappings} onChange={(e) => setForm({ ...form, mappings: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>权重</Label><Input type="number" value={form.weight} onChange={(e) => setForm({ ...form, weight: +e.target.value })} /></div>
              <div><Label>优先级</Label><Input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: +e.target.value })} /></div>
              <div><Label>RPM (0=不限)</Label><Input type="number" value={form.rpmLimit} onChange={(e) => setForm({ ...form, rpmLimit: +e.target.value })} /></div>
              <div><Label>TPM (0=不限)</Label><Input type="number" value={form.tpmLimit} onChange={(e) => setForm({ ...form, tpmLimit: +e.target.value })} /></div>
            </div>
            {err && <p className="text-xs text-red-600">{err}</p>}
            <Button className="w-full gap-1" disabled={busy}><Plus className="h-4 w-4" /> 创建</Button>
          </form>
        </CardContent>
      </Card>

      <Table>
        <THead><TR><TH>名称</TH><TH>提供商</TH><TH>状态</TH><TH>渠道并发 (当前/上限)</TH><TH>模型映射 · 并发 (当前/上限)</TH><TH>Keys</TH><TH>限流</TH><TH className="text-right">操作</TH></TR></THead>
        <TBody>
          {rows.map((c) => (
            <TR key={c.id}>
              <TD><div className="font-medium">{c.name}</div><div className="text-xs text-muted-foreground">{c.baseUrl}</div></TD>
              <TD>{c.provider}</TD>
              <TD><Badge tone={statusTone(c.status)}>{c.status}</Badge></TD>
              <TD><ConcurrencyCell current={c.inflight?.channel ?? 0} limit={c.maxConcurrency} onSave={(n) => patch(c.id, { maxConcurrency: n })} /></TD>
              <TD className="font-mono text-xs">
                {c.modelMappings.map((m) => (
                  <div key={m.publicModel} className="flex items-center gap-2 py-0.5">
                    <span>{m.publicModel} → {m.upstreamModel}</span>
                    <ConcurrencyCell current={c.inflight?.models[m.publicModel] ?? 0} limit={m.maxConcurrency} onSave={(n) => patch(c.id, { mappingLimits: [{ publicModel: m.publicModel, maxConcurrency: n }] })} />
                  </div>
                ))}
              </TD>
              <TD>
                {c.keys.map((k) => (
                  <div key={k.id} className="flex items-center gap-1 text-xs">
                    <span className="font-mono">…{k.hint}</span>
                    <Badge tone={k.enabled ? 'green' : 'red'}>{k.enabled ? 'ok' : 'disabled'}</Badge>
                    {!k.enabled && <button title={k.disabledReason ?? ''} className="text-blue-600" onClick={() => patch(c.id, { enableKeyIds: [k.id] })}>启用</button>}
                  </div>
                ))}
              </TD>
              <TD className="text-xs">RPM {c.rpmLimit || '∞'} · TPM {c.tpmLimit || '∞'}<br />w={c.weight} p={c.priority}</TD>
              <TD className="text-right">
                <div className="flex justify-end gap-1">
                  {c.status !== 'DISABLED'
                    ? <Button size="sm" variant="outline" onClick={() => patch(c.id, { status: 'DISABLED' })}>停用</Button>
                    : <Button size="sm" variant="outline" onClick={() => patch(c.id, { status: 'ACTIVE' })}>启用</Button>}
                  {c.status === 'CIRCUIT_OPEN' && <Button size="sm" variant="outline" title="重置熔断" onClick={() => patch(c.id, { status: 'ACTIVE' })}><RefreshCw className="h-3 w-3" /></Button>}
                  <Button size="sm" variant="ghost" onClick={() => remove(c.id)}><Trash2 className="h-4 w-4 text-red-600" /></Button>
                </div>
              </TD>
            </TR>
          ))}
          {!rows.length && <TR><TD colSpan={8} className="py-8 text-center text-muted-foreground">暂无渠道</TD></TR>}
        </TBody>
      </Table>
    </div>
  );
}
