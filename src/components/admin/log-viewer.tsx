'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, statusTone } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { fmt } from '@/lib/utils';
import { LogDetail } from './log-detail';

type Row = {
  id: string; requestId: string; status: string; httpStatus: number; publicModel: string; upstreamModel?: string | null; stream: boolean;
  promptTokens: number; completionTokens: number; latencyMs: number; queueWaitMs: number; ttfbMs?: number | null; retries: number;
  clientIp?: string | null; errorMessage?: string | null; createdAt: string; updatedAt: string;
  channel?: { name: string } | null; token?: { name: string } | null;
};

const STATUSES = ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED', 'REJECTED_RATE_LIMIT', 'REJECTED_AUDIT', 'QUEUE_TIMEOUT'];
const LABEL: Record<string, string> = { QUEUED: '排队中', RUNNING: '等待回复', SUCCESS: '成功', FAILED: '失败', CANCELLED: '客户端断开', REJECTED_RATE_LIMIT: '限流拒绝', REJECTED_AUDIT: '审计拦截', QUEUE_TIMEOUT: '排队超时' };
const REFRESH_MS = 5000;

/**
 * Request log: 20 rows per page, auto-refreshes every 5s so in-flight requests
 * (QUEUED / RUNNING) are visible immediately and update as they progress.
 */
export function LogViewer() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [model, setModel] = useState('');
  const [data, setData] = useState<{ rows: Row[]; total: number; pageSize: number; serverTime: number } | null>(null);
  const [tick, setTick] = useState(0);
  const inflight = useRef(false);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const qs = new URLSearchParams({ page: String(page), status, model });
      const res = await fetch(`/api/admin/logs?${qs}`, { cache: 'no-store' });
      if (res.ok) setData(await res.json());
    } finally {
      inflight.current = false;
    }
  }, [page, status, model]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { load(); setTick((n) => n + 1); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const live = (r: Row) => r.status === 'QUEUED' || r.status === 'RUNNING';
  // elapsed for in-flight rows, computed against server clock to avoid skew
  const elapsed = (r: Row) => (data ? Math.max(0, data.serverTime - new Date(r.createdAt).getTime()) : 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">请求日志 <span className="ml-2 align-middle text-xs font-normal text-muted-foreground">每 {REFRESH_MS / 1000}s 自动刷新</span></h1>
        <div className="flex gap-2 text-sm">
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="rounded-md border border-border px-2 py-1">
            <option value="">全部状态</option>
            {STATUSES.map((s) => <option key={s} value={s}>{LABEL[s]} ({s})</option>)}
          </select>
          <input value={model} onChange={(e) => { setModel(e.target.value); setPage(1); }} placeholder="模型" className="rounded-md border border-border px-2 py-1" />
          <Button size="sm" variant="outline" onClick={load}>刷新</Button>
        </div>
      </div>

      <Table>
        <THead><TR><TH>时间</TH><TH>状态</TH><TH>模型</TH><TH>渠道</TH><TH>令牌</TH><TH>Tokens</TH><TH>耗时</TH><TH>排队</TH><TH>IP</TH><TH>错误</TH></TR></THead>
        <TBody>
          {data?.rows.map((r) => (
            <TR key={r.id} onClick={() => setSelected(r.id)} className={`cursor-pointer ${live(r) ? 'bg-amber-50/40' : ''} ${selected === r.id ? 'bg-blue-50' : ''}`} title="点击查看详情">
              <TD className="whitespace-nowrap text-xs">{new Date(r.createdAt).toLocaleString()}</TD>
              <TD className="whitespace-nowrap">
                <Badge tone={statusTone(r.status)} className={live(r) ? 'animate-pulse' : ''}>{LABEL[r.status] ?? r.status}</Badge>
                {r.httpStatus > 0 && <span className="ml-1 text-xs text-muted-foreground">{r.httpStatus}</span>}
              </TD>
              <TD className="font-mono text-xs">{r.publicModel}{r.upstreamModel && r.upstreamModel !== r.publicModel ? ` → ${r.upstreamModel}` : ''}{r.stream ? ' ⚡' : ''}</TD>
              <TD className="text-xs">{r.channel?.name ?? '-'}</TD>
              <TD className="text-xs">{r.token?.name ?? '-'}</TD>
              <TD className="text-xs">{live(r) ? '…' : `${fmt(r.promptTokens)} + ${fmt(r.completionTokens)}`}</TD>
              <TD className="text-xs">{live(r) ? `${(elapsed(r) / 1000).toFixed(0)}s…` : `${r.latencyMs} ms${r.ttfbMs != null ? ` (ttfb ${r.ttfbMs})` : ''}`}</TD>
              <TD className="text-xs">{r.queueWaitMs ? `${r.queueWaitMs} ms` : r.status === 'QUEUED' ? `${(elapsed(r) / 1000).toFixed(0)}s…` : '-'}</TD>
              <TD className="text-xs">{r.clientIp ?? '-'}</TD>
              <TD className="max-w-xs truncate text-xs text-red-600" title={r.errorMessage ?? ''}>{r.errorMessage ?? ''}</TD>
            </TR>
          ))}
          {data && !data.rows.length && <TR><TD colSpan={10} className="py-8 text-center text-muted-foreground">暂无日志</TD></TR>}
          {!data && <TR><TD colSpan={10} className="py-8 text-center text-muted-foreground">加载中…</TD></TR>}
        </TBody>
      </Table>

      {selected && <LogDetail id={selected} onClose={() => setSelected(null)} />}

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>共 {fmt(data?.total ?? 0)} 条 · 第 {page} / {totalPages} 页</span>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(1)}>首页</Button>
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>下一页</Button>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>末页</Button>
        </div>
      </div>
    </div>
  );
}
