import { CalendarDays, ChevronLeft, ChevronRight, GraduationCap, List, MessageCircle, Plus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Avatar } from '@/components/avatar';
import { Expandable } from '@/components/expandable';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs } from '@/components/ui/tabs';
import { useNow } from '@/hooks/use-now';
import { useTrainings, type TrainingSummary } from '@/hooks/use-trainings';
import { cn } from '@/lib/cn';
import { describeError } from '@/lib/errors';
import { monthName, weekdaysShort } from '@/lib/i18n';
import { formatMinutes } from '@/lib/pirep';
import { DualTimeText, useTimePrefs } from '@/lib/time-context';
import {
  dateKeyIn,
  monthGrid,
  registrationStatus,
  shiftMonth,
  trainingCategories,
  trainingLevels,
  trainingPhase,
  trainingResults,
} from '@/lib/training';


type View = 'calendar' | 'list';
type ListFilter = 'upcoming' | 'mine' | 'past';

const phaseBadge = {
  upcoming: null,
  live: { label: 'En curso', tone: 'info' },
  ended: { label: 'Terminado', tone: 'neutral' },
  cancelled: { label: 'Cancelado', tone: 'danger' },
} as const;

export function TrainingStatusBadge({ training }: { training: TrainingSummary }) {
  const reg = training.my_registration;
  if (!reg) return null;
  if (reg.result) return <Badge tone={trainingResults[reg.result].tone}>{trainingResults[reg.result].label}</Badge>;
  const s = registrationStatus[reg.status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function CategoryBadge({ category }: { category: TrainingSummary['category'] }) {
  const c = trainingCategories[category];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-0.5 text-xs">
      <span className="size-2 rounded-full" style={{ background: c.color }} aria-hidden />
      {c.label}
    </span>
  );
}

function TrainingCard({ training, now }: { training: TrainingSummary; now: number }) {
  const phase = trainingPhase(training, now);
  const badge = phaseBadge[phase];
  const minutes = Math.round((Date.parse(training.ends_at) - Date.parse(training.starts_at)) / 60_000);
  return (
    <li>
      <Link
        to={`/training/${training.id}`}
        className={cn(
          'block rounded-lg border border-line bg-surface p-4 transition-colors hover:border-accent/60',
          phase === 'cancelled' && 'opacity-70',
        )}
        style={{ boxShadow: `inset 3px 0 0 ${trainingCategories[training.category].color}` }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted">{training.folio}</span>
          <CategoryBadge category={training.category} />
          <Badge tone="neutral">{trainingLevels[training.level]}</Badge>
          {badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : null}
          <span className="ml-auto">
            <TrainingStatusBadge training={training} />
          </span>
        </div>
        <p className={cn('mt-2 font-display text-lg font-semibold leading-tight', phase === 'cancelled' && 'line-through')}>{training.title}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
          <DualTimeText value={training.starts_at} withDate inline />
          <span className="text-muted">{formatMinutes(minutes)}</span>
          {training.instructor?.display_name ? (
            <span className="inline-flex items-center gap-1.5">
              <Avatar name={training.instructor.display_name} url={training.instructor.avatar_url} size="xs" />
              {training.instructor.display_name}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1 text-muted">
            <Users className="size-4" aria-hidden />
            {training.approved}
            {training.capacity ? `/${training.capacity}` : ''} confirmados
            {training.can_manage && training.pending > 0 ? ` · ${training.pending} por revisar` : ''}
          </span>
          {training.discord_url ? (
            <span className="inline-flex items-center gap-1 text-muted">
              <MessageCircle className="size-4" aria-hidden />
              {training.discord_channel ?? 'Discord'}
            </span>
          ) : null}
          {training.aircraft_type ? <span className="font-mono text-muted">{training.aircraft_type.icao_code}</span> : null}
        </div>
      </Link>
    </li>
  );
}

function MonthCalendar({ trainings, year, month, timeZone }: { trainings: TrainingSummary[]; year: number; month: number; timeZone: string }) {
  const { dual } = useTimePrefs();
  const weeks = monthGrid(year, month);
  const today = dateKeyIn(new Date(), timeZone);
  const byDay = useMemo(() => {
    const map = new Map<string, TrainingSummary[]>();
    for (const t of trainings) {
      const key = dateKeyIn(t.starts_at, timeZone);
      map.set(key, [...(map.get(key) ?? []), t]);
    }
    return map;
  }, [trainings, timeZone]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] table-fixed border-collapse text-sm" aria-label={`${monthName(month - 1)} ${year}`}>
        <thead>
          <tr>
            {weekdaysShort().map((d) => (
              <th key={d} scope="col" className="pb-2 text-left text-xs font-medium text-muted">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]!.key}>
              {week.map((d) => {
                const items = byDay.get(d.key) ?? [];
                return (
                  <td
                    key={d.key}
                    className={cn('h-28 border border-line p-1 align-top', !d.inMonth && 'bg-bg/60 text-muted', d.key === today && 'bg-accent/10')}
                  >
                    <span className={cn('inline-flex size-6 items-center justify-center rounded-full text-xs', d.key === today && 'bg-accent font-semibold text-accent-ink')}>
                      {d.day}
                    </span>
                    <ul className="mt-0.5 space-y-1">
                      {items.map((t) => {
                        const c = trainingCategories[t.category];
                        return (
                          <li key={t.id}>
                            <Link
                              to={`/training/${t.id}`}
                              title={`${t.folio} · ${t.title} · ${dual(t.starts_at).primary}${dual(t.starts_at).secondary ? ` (${dual(t.starts_at).secondary})` : ''}`}
                              className={cn(
                                'block truncate rounded px-1.5 py-0.5 text-xs leading-snug hover:brightness-110',
                                t.status === 'cancelled' && 'line-through opacity-60',
                              )}
                              style={{ background: `color-mix(in srgb, ${c.color} 22%, transparent)`, boxShadow: `inset 2px 0 0 ${c.color}` }}
                            >
                              <span className="font-mono">{dual(t.starts_at).primary}</span> {t.title}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TrainingPage() {
  const now = useNow(60_000);
  const { primary, timeZone, localLabel } = useTimePrefs();
  const [params, setParams] = useSearchParams();
  const view: View = params.get('vista') === 'lista' ? 'list' : 'calendar';
  const [filter, setFilter] = useState<ListFilter>('upcoming');
  const current = new Date(now);
  const [ym, setYm] = useState({ year: current.getUTCFullYear(), month: current.getUTCMonth() + 1 });
  const trainings = useTrainings();
  const data = trainings.data;
  // El día del calendario sigue a la hora principal elegida (Zulu o local).
  const calendarZone = primary === 'local' ? timeZone : 'UTC';

  const all = data?.trainings ?? [];
  const list = useMemo(() => {
    const rows = all.filter((t) => {
      const phase = trainingPhase(t, now);
      if (filter === 'mine') return Boolean(t.my_registration && t.my_registration.status !== 'withdrawn') || t.can_manage;
      if (filter === 'past') return phase === 'ended' || phase === 'cancelled';
      return phase === 'upcoming' || phase === 'live';
    });
    return filter === 'past' ? rows.reverse() : rows;
  }, [all, filter, now]);

  const setView = (v: View) => {
    const next = new URLSearchParams(params);
    if (v === 'list') next.set('vista', 'lista');
    else next.delete('vista');
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Training"
        description="Entrenamientos de operaciones de vuelo, aeronaves, procedimientos, navegación, ATC, meteorología y teoría. Cualquier piloto de cualquier aerolínea se inscribe; quien lo organiza confirma la participación."
        actions={
          data?.can_create ? (
            <Link to="/training/new" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-accent-ink hover:brightness-110">
              <Plus className="size-4" aria-hidden />
              Programar entrenamiento
            </Link>
          ) : null
        }
      />

      {data && !data.can_join ? (
        <Alert>Para inscribirte a un entrenamiento necesitas ser miembro activo de alguna aerolínea. Solicita ingreso desde el Dashboard.</Alert>
      ) : null}
      {trainings.isError ? <Alert tone="danger">{describeError(trainings.error)}</Alert> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-md border border-line p-0.5" role="group" aria-label="Vista">
          <button
            type="button"
            aria-pressed={view === 'calendar'}
            onClick={() => setView('calendar')}
            className={cn('inline-flex h-8 items-center gap-1.5 rounded px-3 text-sm', view === 'calendar' ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink')}
          >
            <CalendarDays className="size-4" aria-hidden />
            Calendario
          </button>
          <button
            type="button"
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
            className={cn('inline-flex h-8 items-center gap-1.5 rounded px-3 text-sm', view === 'list' ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink')}
          >
            <List className="size-4" aria-hidden />
            Lista
          </button>
        </div>
        <p className="text-sm text-muted">
          Horas en Zulu y en tu hora local ({localLabel}). Un clic en el reloj de arriba cambia cuál va primero; el calendario usa{' '}
          {primary === 'local' ? 'tu hora local' : 'la fecha Zulu'}.
        </p>
      </div>

      {trainings.isPending ? (
        <Skeleton className="h-96" />
      ) : view === 'calendar' ? (
        <Expandable id="calendario-de-entrenamientos" title="Calendario de entrenamientos">
          <Panel
            title={`${monthName(ym.month - 1).charAt(0).toUpperCase()}${monthName(ym.month - 1).slice(1)} ${ym.year}`}
            description={`${all.filter((t) => dateKeyIn(t.starts_at, calendarZone).startsWith(`${ym.year}-${String(ym.month).padStart(2, '0')}`)).length} entrenamientos este mes`}
            actions={
              <div className="mr-10 flex items-center gap-1">
                <button type="button" className="inline-flex size-8 items-center justify-center rounded-md border border-line hover:bg-surface-2" onClick={() => setYm((v) => shiftMonth(v.year, v.month, -1))} aria-label="Mes anterior">
                  <ChevronLeft className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  className="h-8 rounded-md border border-line px-3 text-sm hover:bg-surface-2"
                  onClick={() => setYm({ year: new Date().getUTCFullYear(), month: new Date().getUTCMonth() + 1 })}
                >
                  Hoy
                </button>
                <button type="button" className="inline-flex size-8 items-center justify-center rounded-md border border-line hover:bg-surface-2" onClick={() => setYm((v) => shiftMonth(v.year, v.month, 1))} aria-label="Mes siguiente">
                  <ChevronRight className="size-4" aria-hidden />
                </button>
              </div>
            }
          >
            <MonthCalendar trainings={all} year={ym.year} month={ym.month} timeZone={calendarZone} />
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Categorías">
              {Object.entries(trainingCategories).map(([k, c]) => (
                <li key={k} className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: c.color }} aria-hidden />
                  {c.label}
                </li>
              ))}
            </ul>
          </Panel>
        </Expandable>
      ) : null}

      <section aria-labelledby="training-list-title" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="training-list-title" className="inline-flex items-center gap-2 font-display text-xl font-semibold">
            <GraduationCap className="size-5 text-accent" aria-hidden />
            {filter === 'upcoming' ? 'Próximos entrenamientos' : filter === 'mine' ? 'Mis entrenamientos' : 'Entrenamientos anteriores'}
          </h2>
          <Tabs<ListFilter>
            label="Filtrar entrenamientos"
            value={filter}
            onChange={setFilter}
            items={[
              { value: 'upcoming', label: 'Próximos' },
              { value: 'mine', label: 'Mis inscripciones' },
              { value: 'past', label: 'Anteriores' },
            ]}
          />
        </div>
        {trainings.isPending ? null : list.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
            {filter === 'upcoming' ? 'No hay entrenamientos programados.' : filter === 'mine' ? 'Todavía no te inscribes a ningún entrenamiento.' : 'Sin entrenamientos anteriores.'}
          </p>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {list.map((t) => (
              <TrainingCard key={t.id} training={t} now={now} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
