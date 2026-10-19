import { CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'info' | 'ok' | 'danger';

const styles: Record<Tone, string> = {
  info: 'border-cyan/40 bg-cyan/10',
  ok: 'border-ok/40 bg-ok/10',
  danger: 'border-danger/40 bg-danger/10',
};

export function Alert({ tone = 'info', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  const Icon = tone === 'danger' ? TriangleAlert : tone === 'ok' ? CircleCheck : Info;
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex gap-2.5 rounded-md border px-3 py-2.5 text-sm text-ink', styles[tone], className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}
