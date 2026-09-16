import { cn } from '@/lib/utils';

const tones: Record<string, string> = {
  green: 'bg-emerald-100 text-emerald-800',
  red: 'bg-red-100 text-red-800',
  amber: 'bg-amber-100 text-amber-800',
  gray: 'bg-muted text-muted-foreground',
  blue: 'bg-blue-100 text-blue-800',
};
export function Badge({ tone = 'gray', className, children }: { tone?: keyof typeof tones; className?: string; children: React.ReactNode }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', tones[tone], className)}>{children}</span>;
}
export const statusTone = (s: string) => (s === 'ACTIVE' || s === 'SUCCESS' ? 'green' : s === 'CIRCUIT_OPEN' || s === 'QUEUE_TIMEOUT' ? 'amber' : s === 'DISABLED' ? 'gray' : 'red');
