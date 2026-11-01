import { CalendarClock, Plus, Trophy, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AirlineLogo } from '@/components/airline-logo';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonClasses } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs } from '@/components/ui/tabs';
import { useEvents } from '@/hooks/use-events';
import { useNow } from '@/hooks/use-now';
import { useAuth } from '@/lib/auth';
import { describeError } from '@/lib/errors';
import {
  criterionLabels,
  eventMinutes,
  eventStatusLabels,
  eventStatusTone,
  eventTiming,
  registrationStatusLabels,
  routeText,
  timingText,
  scenarioLabels,
  type EventSummary,
} from '@/lib/events';
import { formatMinutes } from '@/lib/pirep';
import { useTimePrefs } from '@/lib/time-context';
import { enrollmentStatusTone } from '@/lib/tours';

type View = 'upcoming' | 'mine' | 'manage' | 'past';

function EventCard({ event, now }: { event: EventSummary; now: number }) {
  const { dual } = useTimePrefs();
  const timing = eventTiming(event, now);
  const mine = event.my_registration;
  const start = dual(event.starts_at, { withDate: true });
  return (
    <li>
      <Link to={`/events/${event.id}`} className="group flex h-full flex-col overflow-hidden rounded-lg border border-line bg-surface transition-colors hover:border-muted">
        <span className="h-1.5" style={{ background: event.color }} aria-hidden />
        <span className="flex flex-1 flex-col gap-3 p-4">
          <span className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block font-mono text-xs font-semibold" style={{ color: event.color }}>
                {event.folio}
              </span>
              <span className="block font-display text-lg font-semibold leading-tight group-hover:underline">{event.name}</span>
              <span className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                <AirlineLogo
                  airline={{ name: event.airline.name, icao_code: event.airline.icao, logo_path: event.airline.logo_path, brand_primary_color: event.airline.color }}
                  size="sm"
                />
                {event.airline.name}
                {event.creator ? ` · por ${event.creator.name}` : ''}
              </span>
            </span>
            <Badge tone={timing === 'live' ? 'ok' : timing === 'ended' ? 'neutral' : 'info'}>{timing === 'live' ? 'En curso' : timing === 'ended' ? 'Terminado' : 'Próximo'}</Badge>
          </span>
          <span className="font-mono text-base font-semibold">{routeText(event)}</span>
          <span className="text-xs text-muted">{scenarioLabels[event.scenario]}</span>
          <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="size-4 text-muted" aria-hidden />
              {start.primary} · {formatMinutes(eventMinutes(event))} h
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-4 text-muted" aria-hidden />
              {event.participants} registrados
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Trophy className="size-4 text-muted" aria-hidden />
              {criterionLabels[event.prize_criterion]}
            </span>
          </span>
          <span className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
            {event.status !== 'published' ? <Badge tone={eventStatusTone[event.status]}>{eventStatusLabels[event.status]}</Badge> : null}
            {mine ? <Badge tone={enrollmentStatusTone[mine.status]}>{registrationStatusLabels[mine.status]}</Badge> : null}
            {event.pending_registrations ? <Badge tone="warn">{event.pending_registrations} por aprobar</Badge> : null}
            {event.status === 'published' ? <span className="ml-auto text-xs text-muted">{timingText(event, now)}</span> : null}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** Eventos de todas las aerolíneas: fly-ins, fly-outs y rutas compartidas con ranking y premio. */
export function EventsPage() {
  const events = useEvents();
  const { user } = useAuth();
  const now = useNow(30_000);
  const [view, setView] = useState<View>('upcoming');

  const groups = useMemo(() => {
    const all = events.data ?? [];
    const active = (e: EventSummary) => e.my_registration && ['pending', 'approved'].includes(e.my_registration.status);
    return {
      upcoming: all.filter((e) => e.status === 'published' && eventTiming(e, now) !== 'ended'),
      mine: all.filter((e) => active(e) || (e.creator?.id === user?.id && e.status !== 'cancelled' && eventTiming(e, now) !== 'ended')),
      manage: all.filter((e) => e.can_approve || (e.pending_registrations ?? 0) > 0 || (e.can_edit && ['draft', 'submitted', 'rejected'].includes(e.status))),
      past: all.filter((e) => e.status === 'cancelled' || (e.status === 'published' && eventTiming(e, now) === 'ended')),
    };
  }, [events.data, now, user?.id]);

  const items: { value: View; label: string; count?: number }[] = [
    { value: 'upcoming', label: 'Próximos y en curso', count: groups.upcoming.length },
    { value: 'mine', label: 'Mis eventos', count: groups.mine.length },
  ];
  if (groups.manage.length > 0) items.push({ value: 'manage', label: 'Por atender', count: groups.manage.length });
  items.push({ value: 'past', label: 'Pasados', count: groups.past.length });
  const list = groups[view];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Eventos"
        description="Vuelos en grupo entre pilotos de varias aerolíneas. Regístrate, vuela con la flota de tu aerolínea en el horario del evento y compite en el ranking por el premio."
        actions={
          <Link to="/events/new" className={buttonClasses('primary')}>
            <Plus className="size-4" aria-hidden />
            Crear evento
          </Link>
        }
      />
      {events.isError ? <Alert tone="danger">{describeError(events.error)}</Alert> : null}
      <Tabs label="Eventos" value={view} onChange={setView} items={items} />
      {events.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-4 py-12 text-center">
          <CalendarClock className="mx-auto size-8 text-muted" aria-hidden />
          <p className="mt-2 font-display text-lg font-semibold">
            {view === 'upcoming' ? 'No hay eventos programados' : view === 'mine' ? 'Todavía no participas en ningún evento' : view === 'manage' ? 'Nada por atender' : 'Sin eventos pasados'}
          </p>
          <p className="mt-1 text-sm text-muted">Crea uno: elige el escenario, el horario y cómo se decide el premio.</p>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((e) => (
            <EventCard key={e.id} event={e} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
}
