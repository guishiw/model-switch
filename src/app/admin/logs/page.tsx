import { prisma } from '@/lib/prisma';
import { Badge, statusTone } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { fmt } from '@/lib/utils';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
const PAGE = 50;

/** Server component: request log with status / model / channel filters + pagination */
export default async function LogsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const page = Math.max(1, Number(searchParams.page ?? 1));
  const where = {
    ...(searchParams.status ? { status: searchParams.status as any } : {}),
    ...(searchParams.model ? { publicModel: searchParams.model } : {}),
    ...(searchParams.channel ? { channelId: searchParams.channel } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.requestLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * PAGE, take: PAGE, include: { channel: { select: { name: true } }, token: { select: { name: true } } } }),
    prisma.requestLog.count({ where }),
  ]);
  const qs = (p: number) => `?${new URLSearchParams({ ...(searchParams as any), page: String(p) })}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">请求日志</h1>
        <form className="flex gap-2 text-sm">
          <select name="status" defaultValue={searchParams.status ?? ''} className="rounded-md border border-border px-2 py-1">
            <option value="">全部状态</option>
            {['SUCCESS', 'FAILED', 'REJECTED_RATE_LIMIT', 'REJECTED_AUDIT', 'QUEUE_TIMEOUT'].map((s) => <option key={s}>{s}</option>)}
          </select>
          <input name="model" placeholder="模型" defaultValue={searchParams.model ?? ''} className="rounded-md border border-border px-2 py-1" />
          <button className="rounded-md bg-primary px-3 py-1 text-white">筛选</button>
        </form>
      </div>
      <Table>
        <THead><TR><TH>时间</TH><TH>状态</TH><TH>模型</TH><TH>渠道</TH><TH>令牌</TH><TH>Tokens</TH><TH>延迟</TH><TH>排队</TH><TH>IP</TH><TH>错误</TH></TR></THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id}>
              <TD className="whitespace-nowrap text-xs">{r.createdAt.toLocaleString()}</TD>
              <TD><Badge tone={statusTone(r.status)}>{r.status}</Badge> <span className="text-xs text-muted-foreground">{r.httpStatus}</span></TD>
              <TD className="font-mono text-xs">{r.publicModel}{r.upstreamModel && r.upstreamModel !== r.publicModel ? ` → ${r.upstreamModel}` : ''}{r.stream ? ' ⚡' : ''}</TD>
              <TD className="text-xs">{r.channel?.name ?? '-'}</TD>
              <TD className="text-xs">{r.token?.name ?? '-'}</TD>
              <TD className="text-xs">{fmt(r.promptTokens)} + {fmt(r.completionTokens)}</TD>
              <TD className="text-xs">{r.latencyMs} ms{r.ttfbMs != null ? ` (ttfb ${r.ttfbMs})` : ''}</TD>
              <TD className="text-xs">{r.queueWaitMs ? `${r.queueWaitMs} ms` : '-'}</TD>
              <TD className="text-xs">{r.clientIp ?? '-'}</TD>
              <TD className="max-w-xs truncate text-xs text-red-600" title={r.errorMessage ?? ''}>{r.errorMessage ?? ''}</TD>
            </TR>
          ))}
          {!rows.length && <TR><TD colSpan={10} className="py-8 text-center text-muted-foreground">暂无日志</TD></TR>}
        </TBody>
      </Table>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>共 {fmt(total)} 条</span>
        <div className="flex gap-2">
          {page > 1 && <Link className="underline" href={qs(page - 1)}>上一页</Link>}
          {page * PAGE < total && <Link className="underline" href={qs(page + 1)}>下一页</Link>}
        </div>
      </div>
    </div>
  );
}
