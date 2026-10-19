import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info';

const tones: Record<Tone, string> = {
  neutral: 'border-line text-muted',
  ok: 'border-ok/40 text-ok-ink bg-ok/10',
  warn: 'border-warn/40 text-warn-ink bg-warn/10',
  danger: 'border-danger/40 text-danger-ink bg-danger/10',
  info: 'border-cyan/40 text-cyan bg-cyan/10',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-xs font-medium leading-none',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
