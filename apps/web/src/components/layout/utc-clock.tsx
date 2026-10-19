import { useEffect, useState } from 'react';
import { formatZulu, formatZuluDate } from '@/lib/format';
import { cn } from '@/lib/cn';

function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Hora UTC (Zulu): la referencia horaria de toda operación aérea. */
export function UtcClock({ size = 'sm', className }: { size?: 'sm' | 'lg'; className?: string }) {
  const now = useNow();
  const zulu = formatZulu(now);

  if (size === 'lg') {
    return (
      <div className={cn('flex flex-col items-end', className)}>
        <time
          dateTime={now.toISOString()}
          className="font-display text-5xl font-semibold leading-none tracking-tight tabular-nums sm:text-6xl"
        >
          {zulu}
        </time>
        <span className="mt-1 text-sm text-muted">UTC {formatZuluDate(now)}</span>
      </div>
    );
  }

  return (
    <time
      dateTime={now.toISOString()}
      title="Hora UTC"
      className={cn('font-display text-lg font-semibold tabular-nums text-ink', className)}
    >
      {zulu}
    </time>
  );
}
