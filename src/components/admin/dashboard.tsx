'use client';
import { useEffect, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, statusTone } from '@/components/ui/badge';
import { fmt } from '@/lib/utils';

type Stats = {
  queue: { active: number; waiting: number; max: number };
  summary: { requests24h: number; successRate: number; tokens24h: number; cost24h: number; avgLatencyMs: number; latency: { p50: number; p90: number; p99: number } };
  hourly: Array<{ hour: string; requests: number; tokens: number; failures: number }>;
  byModel: Array<{ model: string; requests: number; tokens: number; cost: number }>;
  channels: Array<{ id: string; name: string; status: string; provider: string; _count: { keys: number } }>;
};

function Stat({ title, value, sub }: { title: string; value: React.ReactNode; sub?: string }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent><div className="text-2xl font-semibold">{value}</div>{sub && <div className="text-xs text-muted-foreground">{sub}</div>}</CardContent>
    </Card>
  );
}

export function Dashboard() {
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch('/api/admin/stats').then((r) => r.json()).then((d) => alive && setS(d)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (!s) return <p className="text-sm text-muted-foreground">加载中…</p>;

  const hourly = s.hourly.map((h) => ({ ...h, label: new Date(h.hour).getHours() + ':00' }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Stat title="当前并发" value={`${s.queue.active} / ${s.queue.max}`} sub={`排队中 ${s.queue.waiting}`} />
        <Stat title="24h 请求数" value={fmt(s.summary.requests24h)} />
        <Stat title="成功率" value={`${s.summary.successRate}%`} />
        <Stat title="24h Token" value={fmt(s.summary.tokens24h)} sub={`成本 $${s.summary.cost24h.toFixed(4)}`} />
        <Stat title="平均延迟" value={`${s.summary.avgLatencyMs} ms`} />
        <Stat title="延迟分布" value={`P50 ${s.summary.latency.p50}`} sub={`P90 ${s.summary.latency.p90} · P99 ${s.summary.latency.p99} ms`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>每小时请求 / 失败</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hourly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" fontSize={11} /><YAxis fontSize={11} /><Tooltip />
                <Area type="monotone" dataKey="requests" stroke="#0f172a" fill="#0f172a" fillOpacity={0.1} />
                <Area type="monotone" dataKey="failures" stroke="#ef4444" fill="#ef4444" fillOpacity={0.15} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Token 消耗（按模型）</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={s.byModel}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="model" fontSize={11} /><YAxis fontSize={11} /><Tooltip />
                <Bar dataKey="tokens" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>渠道状态</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {s.channels.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm">
              <span className="font-medium">{c.name}</span>
              <span className="text-xs text-muted-foreground">{c.provider} · {c._count.keys} keys</span>
              <Badge tone={statusTone(c.status)}>{c.status}</Badge>
            </div>
          ))}
          {!s.channels.length && <span className="text-sm text-muted-foreground">尚未配置渠道</span>}
        </CardContent>
      </Card>
    </div>
  );
}
