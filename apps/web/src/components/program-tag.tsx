import { Flag, Trophy } from 'lucide-react';
import { Link } from 'react-router';
import type { PirepProgram } from '@/hooks/use-pireps';
import { cn } from '@/lib/cn';

/** Etiqueta del tour (con su leg) o del evento de un vuelo o PIREP, con enlace. */
export function ProgramTag({ program, className, compact = false }: { program: PirepProgram | undefined; className?: string; compact?: boolean }) {
  if (program?.tour) {
    const t = program.tour;
    return (
      <Link
        to={`/tours/${t.id}`}
        className={cn('inline-flex flex-wrap items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs hover:bg-surface-2', className)}
        style={{ borderColor: t.color, color: t.color }}
        title={`Vuelo del tour ${t.code}: leg ${t.leg} de ${t.legs}`}
      >
        <Flag className="size-3" aria-hidden />
        <strong>{`Tour ${t.code}`}</strong>
        {compact ? null : <span>{`· ${t.name}`}</span>}
        <strong>{`· Leg ${t.leg}/${t.legs}`}</strong>
      </Link>
    );
  }
  if (program?.event) {
    const e = program.event;
    return (
      <Link
        to={`/events/${e.id}`}
        className={cn('inline-flex flex-wrap items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs hover:bg-surface-2', className)}
        style={{ borderColor: e.color, color: e.color }}
        title={`Vuelo del evento ${e.folio}`}
      >
        <Trophy className="size-3" aria-hidden />
        <strong>{`Evento ${e.folio}`}</strong>
        {compact ? null : <span>{`· ${e.name}`}</span>}
      </Link>
    );
  }
  return null;
}
