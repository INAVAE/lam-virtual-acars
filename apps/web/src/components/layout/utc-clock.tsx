import { ArrowLeftRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatZuluDate } from '@/lib/format';
import { useTimePrefs } from '@/lib/time-context';

function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Reloj UTC (Zulu) y local. UTC es la referencia de la operación; la hora local
 * del piloto va al lado. En la barra superior, un clic intercambia cuál se ve
 * primero (la preferencia se recuerda en este navegador).
 */
export function UtcClock({ size = 'sm', className }: { size?: 'sm' | 'lg'; className?: string }) {
  const now = useNow();
  const { dual, togglePrimary, primary, timeZone } = useTimePrefs();
  const t = dual(now, { seconds: true });

  if (size === 'lg') {
    return (
      <div className={cn('flex flex-col items-end', className)}>
        <time
          dateTime={now.toISOString()}
          className="font-display text-5xl font-semibold leading-none tracking-tight tabular-nums sm:text-6xl"
        >
          {t.primary}
        </time>
        <span className="mt-1 text-sm text-muted">
          UTC {formatZuluDate(now)}
          {t.secondary ? <span className="font-mono"> · {t.secondary}</span> : null}
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={togglePrimary}
      title={`Hora ${primary === 'utc' ? 'UTC' : 'local'} primero. Clic para ver la ${primary === 'utc' ? 'local' : 'UTC'} primero (zona: ${timeZone}; cámbiala en Settings).`}
      aria-label={`Hora UTC y local. Mostrar primero la hora ${primary === 'utc' ? 'local' : 'UTC'}`}
      className={cn('group flex items-center gap-2 rounded-md px-2 py-1 text-right transition-colors hover:bg-surface-2', className)}
    >
      <time dateTime={now.toISOString()} className="flex flex-col leading-tight">
        <span className="font-display text-lg font-semibold tabular-nums text-ink">{t.primary}</span>
        {t.secondary ? <span className="font-mono text-[11px] tabular-nums text-muted">{t.secondary}</span> : null}
      </time>
      <ArrowLeftRight className="size-3.5 text-muted opacity-60 group-hover:opacity-100" aria-hidden />
    </button>
  );
}
