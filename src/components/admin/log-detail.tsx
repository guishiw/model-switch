'use client';
import { useEffect, useState } from 'react';
import { X, Copy, Check } from 'lucide-react';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn, fmt } from '@/lib/utils';

type Msg = { role: string; content: unknown; name?: string; tool_calls?: any[]; tool_call_id?: string };
type Detail = {
  id: string; requestId: string; status: string; httpStatus: number; publicModel: string; upstreamModel?: string | null; stream: boolean;
  promptTokens: number; completionTokens: number; totalTokens: number; cost: number; latencyMs: number; queueWaitMs: number; ttfbMs?: number | null; retries: number;
  clientIp?: string | null; userAgent?: string | null; errorMessage?: string | null; createdAt: string; updatedAt: string;
  requestBody?: any; responseBody?: any;
  channel?: { name: string; provider: string; baseUrl: string } | null; token?: { name: string; user: { username: string } } | null;
  audits: Array<{ direction: string; matched: string[]; snippet: string }>;
  serverTime: number;
};

const LABEL: Record<string, string> = { QUEUED: '排队中', RUNNING: '等待回复', SUCCESS: '成功', FAILED: '失败', CANCELLED: '客户端断开', REJECTED_RATE_LIMIT: '限流拒绝', REJECTED_AUDIT: '审计拦截', QUEUE_TIMEOUT: '排队超时' };
const PARAM_KEYS = ['temperature', 'top_p', 'max_tokens', 'stop', 'presence_penalty', 'frequency_penalty', 'response_format', 'tool_choice', 'session_id', 'user'];
const isLive = (s: string) => s === 'QUEUED' || s === 'RUNNING';

/** Flatten OpenAI message content (string or multimodal parts) to display text */
function contentText(c: unknown): string {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p: any) => (p?.type === 'text' ? p.text : p?.type === 'image_url' ? `[图片 ${String(p.image_url?.url ?? '').slice(0, 60)}…]` : JSON.stringify(p))).join('\n');
  return JSON.stringify(c, null, 2);
}

/** Extract the assistant reply from a stored response (non-stream: OpenAI object; stream: {text, finish_reason}) */
function replyOf(d: Detail): { text: string; toolCalls?: any[]; finish?: string | null; partial?: boolean } | null {
  const r = d.responseBody;
  if (!r) return null;
  if (typeof r.text === 'string') return { text: r.text, finish: r.finish_reason, partial: r.partial === true };
  const m = r.choices?.[0]?.message;
  if (m) return { text: contentText(m.content), toolCalls: m.tool_calls, finish: r.choices[0].finish_reason };
  return { text: JSON.stringify(r, null, 2) };
}

function CopyButton({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted" onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1200); }}>
      {ok ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{ok ? '已复制' : '复制'}
    </button>
  );
}

const roleStyle: Record<string, { label: string; cls: string; align: string }> = {
  system: { label: 'System', cls: 'bg-slate-100 text-slate-700 border-slate-200', align: 'justify-center' },
  user: { label: '用户', cls: 'bg-blue-600 text-white border-blue-600', align: 'justify-end' },
  assistant: { label: '助手', cls: 'bg-white text-slate-900 border-border', align: 'justify-start' },
  tool: { label: 'Tool', cls: 'bg-amber-50 text-amber-900 border-amber-200', align: 'justify-start' },
};

function Bubble({ role, children, meta }: { role: string; children: React.ReactNode; meta?: string }) {
  const s = roleStyle[role] ?? roleStyle.assistant;
  return (
    <div className={cn('flex', s.align)}>
      <div className={cn('max-w-[85%] rounded-lg border px-3 py-2 text-sm shadow-sm', s.cls)}>
        <div className={cn('mb-1 text-[10px] font-medium uppercase tracking-wide opacity-70')}>{s.label}{meta ? ` · ${meta}` : ''}</div>
        <div className="whitespace-pre-wrap break-words leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="rounded-md bg-muted/60 px-2.5 py-1.5"><div className="text-[10px] text-muted-foreground">{k}</div><div className="text-sm font-medium">{v}</div></div>;
}

export function LogDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [tab, setTab] = useState<'chat' | 'raw'>('chat');

  useEffect(() => {
    let alive = true;
    const load = () => fetch(`/api/admin/logs/${id}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => alive && j && setD(j));
    load();
    const t = setInterval(() => { if (!d || isLive(d.status)) load(); }, 5000);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => { alive = false; clearInterval(t); window.removeEventListener('keydown', onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, d?.status]);

  const msgs: Msg[] = d?.requestBody?.messages ?? [];
  const reply = d ? replyOf(d) : null;
  const params = d ? PARAM_KEYS.filter((k) => d.requestBody?.[k] !== undefined).map((k) => [k, d.requestBody[k]] as const) : [];
  const elapsed = d && isLive(d.status) ? Math.max(0, d.serverTime - new Date(d.createdAt).getTime()) : 0;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-3xl flex-col bg-slate-50 shadow-2xl">
        {/* header */}
        <div className="flex items-start justify-between gap-3 border-b border-border bg-white px-5 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {d && <Badge tone={statusTone(d.status)} className={isLive(d.status) ? 'animate-pulse' : ''}>{LABEL[d.status] ?? d.status}</Badge>}
              {d && d.httpStatus > 0 && <span className="text-xs text-muted-foreground">HTTP {d.httpStatus}</span>}
              {d?.stream && <Badge tone="blue">流式</Badge>}
              <span className="font-mono text-sm font-medium">{d?.publicModel}{d?.upstreamModel && d.upstreamModel !== d.publicModel ? ` → ${d.upstreamModel}` : ''}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
              {d && <span>{new Date(d.createdAt).toLocaleString()}</span>}
              {d?.channel && <span>渠道 {d.channel.name} ({d.channel.provider})</span>}
              {d?.token && <span>令牌 {d.token.name} · {d.token.user.username}</span>}
              {d?.clientIp && <span>IP {d.clientIp}</span>}
              {d && <span className="inline-flex items-center gap-1 font-mono">req {d.requestId.slice(0, 8)}… <CopyButton text={d.requestId} /></span>}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        {!d ? <div className="p-6 text-sm text-muted-foreground">加载中…</div> : (
          <>
            {/* metrics */}
            <div className="grid grid-cols-4 gap-2 border-b border-border bg-white px-5 py-3 sm:grid-cols-8">
              <Stat k="输入 Tokens" v={isLive(d.status) ? '…' : fmt(d.promptTokens)} />
              <Stat k="输出 Tokens" v={isLive(d.status) ? '…' : fmt(d.completionTokens)} />
              <Stat k="费用" v={`$${d.cost.toFixed(6)}`} />
              <Stat k="总耗时" v={isLive(d.status) ? `${(elapsed / 1000).toFixed(0)}s…` : `${fmt(d.latencyMs)} ms`} />
              <Stat k="排队等待" v={`${fmt(d.queueWaitMs)} ms`} />
              <Stat k="首字节" v={d.ttfbMs != null ? `${fmt(d.ttfbMs)} ms` : '-'} />
              <Stat k="重试" v={d.retries} />
              <Stat k="结束原因" v={reply?.finish ?? '-'} />
            </div>

            {d.errorMessage && (
              <div className="mx-5 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"><span className="font-medium">错误：</span>{d.errorMessage}</div>
            )}
            {d.audits.length > 0 && (
              <div className="mx-5 mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <span className="font-medium">审计命中：</span>{d.audits.map((a, i) => <span key={i} className="mr-2">[{a.direction}] {a.matched.join(', ')}</span>)}
              </div>
            )}

            {/* tabs */}
            <div className="flex gap-1 px-5 pt-3">
              {(['chat', 'raw'] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)} className={cn('rounded-md px-3 py-1.5 text-sm', tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>{t === 'chat' ? '对话视图' : '原始 JSON'}</button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {tab === 'chat' ? (
                <div className="space-y-4">
                  {params.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {params.map(([k, v]) => <span key={k} className="rounded-full border border-border bg-white px-2 py-0.5 font-mono text-[11px] text-slate-600">{k}={typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>)}
                    </div>
                  )}
                  <div className="space-y-3">
                    {msgs.map((m, i) => (
                      <Bubble key={i} role={m.role} meta={m.name ?? (m.tool_call_id ? `call ${m.tool_call_id}` : undefined)}>
                        {contentText(m.content)}
                        {m.tool_calls?.map((tc: any, j: number) => (
                          <pre key={j} className="mt-2 overflow-x-auto rounded bg-slate-900 p-2 text-xs text-slate-100">{tc.function?.name}({tc.function?.arguments})</pre>
                        ))}
                      </Bubble>
                    ))}
                    {!msgs.length && <p className="text-sm text-muted-foreground">无消息内容</p>}
                  </div>

                  <div className="border-t border-dashed border-border pt-3">
                    <div className="mb-2 text-xs font-medium text-muted-foreground">大模型回复</div>
                    {isLive(d.status) ? (
                      <div className="rounded-lg border border-border bg-white px-3 py-2 text-sm text-muted-foreground"><span className="animate-pulse">● </span>{d.status === 'QUEUED' ? '排队中，等待并发槽位…' : '等待大模型回复…'}</div>
                    ) : reply ? (
                      <Bubble role="assistant" meta={reply.partial ? '流式拼接 · 未完成（客户端中断）' : d.stream ? '流式拼接' : undefined}>
                        {reply.text || <span className="italic opacity-60">（空内容）</span>}
                        {reply.toolCalls?.map((tc: any, j: number) => (
                          <pre key={j} className="mt-2 overflow-x-auto rounded bg-slate-900 p-2 text-xs text-slate-100">{tc.function?.name}({tc.function?.arguments})</pre>
                        ))}
                      </Bubble>
                    ) : (
                      <div className="rounded-lg border border-border bg-white px-3 py-2 text-sm text-muted-foreground">无回复内容</div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {[['请求 (request body)', d.requestBody], ['响应 (response body)', d.responseBody]].map(([title, body]) => {
                    const text = body ? JSON.stringify(body, null, 2) : '';
                    return (
                      <div key={String(title)}>
                        <div className="mb-1 flex items-center justify-between text-xs font-medium text-muted-foreground"><span>{String(title)}</span>{text && <CopyButton text={text} />}</div>
                        <pre className="max-h-[50vh] overflow-auto rounded-md border border-border bg-white p-3 text-xs leading-relaxed">{text || '—'}</pre>
                      </div>
                    );
                  })}
                  {d.userAgent && <div className="text-xs text-muted-foreground">User-Agent: <span className="font-mono">{d.userAgent}</span></div>}
                </div>
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}
