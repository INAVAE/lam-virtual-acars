import { Flag, Plus, Route as RouteIcon, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AirlineLogo } from '@/components/airline-logo';
import { TourBadge } from '@/components/tour-badge';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonClasses } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs } from '@/components/ui/tabs';
import { useTours } from '@/hooks/use-tours';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { describeError } from '@/lib/errors';
import { formatNumber } from '@/lib/format';
import { enrollmentStatusLabels, enrollmentStatusTone, tourStatusLabels, tourStatusTone, tourWindow, type TourSummary } from '@/lib/tours';

type View = 'available' | 'mine' | 'manage' | 'past';

function dateRange(t: TourSummary): string | null {
  if (!t.starts_on && !t.ends_on) return null;
  if (t.starts_on && t.ends_on) return `${t.starts_on} → ${t.ends_on}`;
  return t.starts_on ? `Desde ${t.starts_on}` : `Hasta ${t.ends_on}`;
}

function TourCard({ tour }: { tour: TourSummary }) {
  const mine = tour.my_enrollment;
  const timing = tourWindow(tour);
  const range = dateRange(tour);
  return (
    <li>
      <Link
        to={`/tours/${tour.id}`}
        className="group flex h-full flex-col overflow-hidden rounded-lg border border-line bg-surface transition-colors hover:border-muted"
      >
        <span className="h-1.5" style={{ background: tour.color }} aria-hidden />
        <span className="flex flex-1 flex-col gap-3 p-4">
          <span className="flex items-start gap-3">
            <TourBadge code={tour.code} color={tour.color} badgePath={tour.badge_path} />
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-xs font-semibold" style={{ color: tour.color }}>
                {tour.code}
              </span>
              <span className="block font-display text-lg font-semibold leading-tight group-hover:underline">{tour.name}</span>
              <span className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                <AirlineLogo
                  airline={{ name: tour.airline.name, icao_code: tour.airline.icao, logo_path: tour.airline.logo_path, brand_primary_color: tour.airline.color }}
                  size="sm"
                />
                {tour.airline.name}
                {tour.creator ? ` · por ${tour.creator.name}` : ''}
              </span>
            </span>
          </span>
          {tour.description ? <span className="line-clamp-2 text-sm text-muted">{tour.description}</span> : null}
          <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-1.5">
              <RouteIcon className="size-4 text-muted" aria-hidden />
              {tour.legs_count} legs · {formatNumber(tour.distance_nm)} NM
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-4 text-muted" aria-hidden />
              {tour.participants} inscritos · {tour.finishers} terminaron
            </span>
          </span>
          <span className="flex flex-wrap gap-1.5 text-xs">
            {tour.aircraft_types.length > 0 ? (
              tour.aircraft_types.map((t) => (
                <span key={t} className="rounded border border-line px-1.5 py-0.5 font-mono">
                  {t}
                </span>
              ))
            ) : (
              <span className="text-muted">Cualquier aeronave</span>
            )}
          </span>
          <span className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
            {tour.status !== 'published' ? <Badge tone={tourStatusTone[tour.status]}>{tourStatusLabels[tour.status]}</Badge> : null}
            {tour.status === 'published' && timing !== 'open' ? <Badge tone="neutral">{timing === 'upcoming' ? 'Por empezar' : 'Terminado'}</Badge> : null}
            {mine ? (
              <Badge tone={enrollmentStatusTone[mine.status]}>
                {enrollmentStatusLabels[mine.status]}
                {mine.status === 'approved' || mine.status === 'completed' ? ` · ${mine.legs_flown}/${tour.legs_count}` : ''}
              </Badge>
            ) : null}
            {tour.pending_enrollments ? <Badge tone="warn">{tour.pending_enrollments} por aprobar</Badge> : null}
            {tour.ordered_legs ? null : <Badge tone="neutral">Cualquier orden</Badge>}
            {range ? <span className="ml-auto text-xs text-muted">{range}</span> : null}
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * Tours de todas las aerolíneas. Cualquier piloto se inscribe y vuela cada leg
 * con la flota de su aerolínea; el PIREP cuenta como un vuelo normal.
 */
export function ToursPage() {
  const tours = useTours();
  const { user } = useAuth();
  const [view, setView] = useState<View>('available');

  const groups = useMemo(() => {
    const all = tours.data ?? [];
    const active = (t: TourSummary) => t.my_enrollment && ['pending', 'approved', 'completed'].includes(t.my_enrollment.status);
    return {
      available: all.filter((t) => t.status === 'published' && tourWindow(t) !== 'ended'),
      mine: all.filter((t) => active(t) || (t.creator?.id === user?.id && t.status !== 'closed')),
      manage: all.filter((t) => t.can_approve || (t.pending_enrollments ?? 0) > 0 || (t.can_edit && ['draft', 'submitted', 'rejected'].includes(t.status))),
      past: all.filter((t) => t.status === 'closed' || (t.status === 'published' && tourWindow(t) === 'ended')),
    };
  }, [tours.data, user?.id]);

  const items: { value: View; label: string; count?: number }[] = [
    { value: 'available', label: 'Disponibles', count: groups.available.length },
    { value: 'mine', label: 'Mis tours', count: groups.mine.length },
  ];
  if (groups.manage.length > 0) items.push({ value: 'manage', label: 'Por atender', count: groups.manage.length });
  items.push({ value: 'past', label: 'Terminados', count: groups.past.length });
  const list = groups[view];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tours"
        description="Recorridos de varios legs a cualquier parte del mundo. Inscríbete con tu aerolínea, vuela cada leg con su flota y gana la insignia al terminarlo con todos los PIREP aceptados."
        actions={
          <Link to="/tours/new" className={buttonClasses('primary')}>
            <Plus className="size-4" aria-hidden />
            Crear tour
          </Link>
        }
      />
      {tours.isError ? <Alert tone="danger">{describeError(tours.error)}</Alert> : null}
      <Tabs label="Tours" value={view} onChange={setView} items={items} />
      {tours.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      ) : list.length === 0 ? (
        <div className={cn('rounded-lg border border-dashed border-line px-4 py-12 text-center')}>
          <Flag className="mx-auto size-8 text-muted" aria-hidden />
          <p className="mt-2 font-display text-lg font-semibold">
            {view === 'available' ? 'No hay tours abiertos' : view === 'mine' ? 'Todavía no participas en ningún tour' : view === 'manage' ? 'Nada por atender' : 'Sin tours terminados'}
          </p>
          <p className="mt-1 text-sm text-muted">
            {view === 'available' ? 'Crea el primero: define sus legs, los tipos de aeronave y la insignia.' : 'Los tours en los que te inscribas o que crees aparecen aquí.'}
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((t) => (
            <TourCard key={t.id} tour={t} />
          ))}
        </ul>
      )}
    </div>
  );
}
