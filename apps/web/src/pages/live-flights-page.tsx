import type { LiveFlight } from '@lam/shared-types';
import { LocateFixed, Maximize, Radar, Search, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { AirlineLogo } from '@/components/airline-logo';
import { LiveMap } from '@/components/live-map';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useLiveFlights, useLiveTrack } from '@/hooks/use-live-flights';
import { useNow } from '@/hooks/use-now';
import { useAirlineScope } from '@/lib/airline-scope';
import { cn } from '@/lib/cn';
import { describeError } from '@/lib/errors';
import { formatWind, formatWindComponents, phaseColor, windComponents } from '@/lib/flight-analysis';
import { formatNumber, formatPilotNumber } from '@/lib/format';
import { ageSeconds, alertText, eteMinutes, flightProgress, formatAge, STALE_SECONDS, worstAlert } from '@/lib/live';
import { phaseLabel } from '@/lib/phases';
import { formatMinutes } from '@/lib/pirep';
import { useTheme } from '@/lib/theme';
import { useTimePrefs } from '@/lib/time-context';

const ALERT_RANK = { danger: 3, warn: 2, info: 1 } as const;

function sortFlights(flights: readonly LiveFlight[]): LiveFlight[] {
  return [...flights].sort((a, b) => {
    if (a.is_mine !== b.is_mine) return a.is_mine ? -1 : 1;
    const wa = worstAlert(a.alerts);
    const wb = worstAlert(b.alerts);
    const ra = wa ? ALERT_RANK[wa.level] : 0;
    const rb = wb ? ALERT_RANK[wb.level] : 0;
    if (ra !== rb) return rb - ra;
    return a.callsign.localeCompare(b.callsign);
  });
}

function PhasePill({ phase }: { phase: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span className="size-2 rounded-full" style={{ background: phaseColor(phase) }} aria-hidden />
      {phaseLabel(phase)}
    </span>
  );
}

function Progress({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Avance del vuelo">
      <div className="h-full rounded-full" style={{ width: `${Math.round(value * 100)}%`, background: color }} />
    </div>
  );
}

function FlightCard({ flight, selected, now, onSelect }: { flight: LiveFlight; selected: boolean; now: number; onSelect: () => void }) {
  const p = flight.position;
  const stale = ageSeconds(flight.last_contact_at, now) >= STALE_SECONDS;
  const worst = worstAlert(flight.alerts);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          'w-full rounded-md border px-3 py-2.5 text-left transition-colors',
          selected ? 'border-accent bg-accent/10' : 'border-line bg-bg hover:border-muted',
          stale && 'opacity-70',
        )}
      >
        <span className="flex items-center gap-2">
          <AirlineLogo airline={{ name: flight.airline.name, icao_code: flight.airline.icao, logo_path: flight.airline.logo_path, brand_primary_color: flight.airline.color }} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="font-mono text-[15px] font-semibold">{flight.callsign}</span>
              {flight.is_mine ? <Badge tone="info">Tu vuelo</Badge> : null}
              {worst ? (
                <TriangleAlert
                  className={cn('ml-auto size-4', worst.level === 'danger' ? 'text-danger-ink' : worst.level === 'warn' ? 'text-warn-ink' : 'text-muted')}
                  aria-label={alertText(worst)}
                />
              ) : null}
            </span>
            <span className="block truncate text-xs text-muted">
              {flight.pilot.name} · {flight.aircraft_type}
            </span>
          </span>
        </span>
        <span className="mt-2 flex items-center justify-between font-mono text-sm">
          <span>{flight.origin.icao}</span>
          <span className="mx-2 flex-1">
            <Progress value={flightProgress(flight)} color={phaseColor(flight.phase)} />
          </span>
          <span>{flight.destination.icao}</span>
        </span>
        <span className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted">
          <PhasePill phase={flight.phase} />
          <span className="font-mono">
            {p ? (p.on_ground ? `${p.gs_kt ?? 0} kt` : `${formatNumber(p.altitude_ft)} ft · ${p.gs_kt ?? '—'} kt`) : 'sin posición'}
          </span>
        </span>
        {stale ? <span className="mt-1 block text-xs text-warn-ink">Sin señal {formatAge(ageSeconds(flight.last_contact_at, now))}</span> : null}
      </button>
    </li>
  );
}

function Datum({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="font-mono text-sm">{children}</dd>
    </div>
  );
}

function FlightDetail({ flight, now, follow, onFollow }: { flight: LiveFlight; now: number; follow: boolean; onFollow: () => void }) {
  const { dual } = useTimePrefs();
  const p = flight.position;
  const ete = eteMinutes(flight);
  const eta = ete !== null ? now + ete * 60_000 : null;
  const elapsed = Math.round((now - Date.parse(flight.started_at)) / 60_000);
  const contact = ageSeconds(flight.last_contact_at, now);
  return (
    <section aria-label={`Detalle del vuelo ${flight.callsign}`} className="rounded-lg border border-line bg-surface p-4">
      <header className="flex flex-wrap items-start gap-3">
        <AirlineLogo airline={{ name: flight.airline.name, icao_code: flight.airline.icao, logo_path: flight.airline.logo_path, brand_primary_color: flight.airline.color }} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-display text-2xl font-semibold">{flight.callsign}</span>
            <Badge>{flight.network}</Badge>
            {flight.is_mine ? <Badge tone="info">Tu vuelo</Badge> : null}
          </p>
          <p className="text-sm text-muted">
            {flight.airline.name} {flight.flight_number} · {flight.pilot.name} ({formatPilotNumber(flight.pilot.number)})
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant={follow ? 'primary' : 'secondary'} onClick={onFollow} aria-pressed={follow}>
            <LocateFixed className="size-4" aria-hidden />
            {follow ? 'Siguiendo' : 'Seguir'}
          </Button>
        </div>
      </header>

      <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <div>
          <p className="font-mono text-lg font-semibold">{flight.origin.icao}</p>
          <p className="max-w-[10rem] truncate text-xs text-muted">{flight.origin.city ?? flight.origin.name}</p>
        </div>
        <div>
          <Progress value={flightProgress(flight)} color={phaseColor(flight.phase)} />
          <p className="mt-1 text-center text-xs text-muted">
            {flight.remaining_nm !== null ? `${formatNumber(flight.remaining_nm)} NM por volar de ${formatNumber(flight.route_nm)} NM` : `${formatNumber(flight.route_nm)} NM en directo`}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg font-semibold">{flight.destination.icao}</p>
          <p className="max-w-[10rem] truncate text-xs text-muted">{flight.destination.city ?? flight.destination.name}</p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 lg:grid-cols-6">
        <Datum label="Fase">
          <PhasePill phase={flight.phase} />
        </Datum>
        <Datum label="Altitud">{p ? `${formatNumber(p.altitude_ft)} ft` : '—'}</Datum>
        <Datum label="IAS / GS">{p ? `${p.ias_kt ?? '—'} / ${p.gs_kt ?? '—'} kt` : '—'}</Datum>
        <Datum label="VS">{p?.vs_fpm != null ? `${p.vs_fpm > 0 ? '+' : ''}${formatNumber(p.vs_fpm)} fpm` : '—'}</Datum>
        <Datum label="Rumbo">{p?.heading_deg != null ? `${String(Math.round(p.heading_deg)).padStart(3, '0')}°` : '—'}</Datum>
        <Datum label="Viento">
          {formatWind(p?.wind_dir_deg, p?.wind_kt)}
          {p && windComponents(p.wind_dir_deg, p.wind_kt, p.heading_deg) ? (
            <span className="block font-sans text-xs text-muted">{formatWindComponents(windComponents(p.wind_dir_deg, p.wind_kt, p.heading_deg))}</span>
          ) : null}
        </Datum>
        <Datum label="En curso">{formatMinutes(elapsed)}</Datum>
        <Datum label="Tiempo al destino">{ete !== null ? formatMinutes(ete) : '—'}</Datum>
        <Datum label="Llegada estimada">
          {eta !== null ? (
            <>
              {dual(eta).primary}
              {dual(eta).secondary ? <span className="block text-xs text-muted">{dual(eta).secondary}</span> : null}
            </>
          ) : (
            '—'
          )}
        </Datum>
        <Datum label="Aeronave">
          {flight.aircraft_type} · {flight.aircraft_registration}
        </Datum>
        <Datum label="Plan">{`${formatNumber(flight.planned_distance_nm)} NM · ${formatMinutes(flight.planned_minutes)}`}</Datum>
        <Datum label="Inicio">
          {dual(flight.started_at).primary}
          {dual(flight.started_at).secondary ? <span className="block text-xs text-muted">{dual(flight.started_at).secondary}</span> : null}
        </Datum>
        <Datum label="Última señal">
          <span className={contact >= STALE_SECONDS ? 'text-warn-ink' : undefined}>{formatAge(contact)}</span>
        </Datum>
      </dl>
      {flight.sim_aircraft_title ? <p className="mt-3 text-xs text-muted">Simulador: {flight.sim_aircraft_title}</p> : null}

      {flight.alerts && flight.alerts.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Alertas de operación">
          {flight.alerts.map((a, i) => (
            <li key={`${a.code}-${i}`}>
              <Badge tone={a.level === 'danger' ? 'danger' : a.level === 'warn' ? 'warn' : 'neutral'}>
                {alertText(a)}
                {a.at ? <span className="font-normal opacity-80"> · {dual(a.at).primary}</span> : null}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Vuelos en curso de las aerolíneas del piloto, en un mapa que se actualiza cada
 * 10 s. Cada piloto ve los vuelos de su aerolínea; el staff ve además las alertas.
 */
export function LiveFlightsPage() {
  const { selected: airline, ready } = useAirlineScope();
  const airlineId = airline?.id ?? null;
  const live = useLiveFlights(airlineId);
  const now = useNow(1000);
  const { theme } = useTheme();
  const [params, setParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(() => params.get('flight'));
  const [follow, setFollow] = useState(() => params.get('flight') !== null);
  const [fitNonce, setFitNonce] = useState(0);
  const [query, setQuery] = useState('');

  const flights = useMemo(() => sortFlights(live.data ?? []), [live.data]);
  const selected = flights.find((f) => f.flight_id === selectedId) ?? null;
  const track = useLiveTrack(selected?.flight_id ?? null);

  const visible = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return flights;
    return flights.filter((f) =>
      [f.callsign, f.origin.icao, f.destination.icao, f.aircraft_type, f.aircraft_registration, f.pilot.name.toUpperCase(), f.airline.icao ?? ''].some((v) => v.includes(q)),
    );
  }, [flights, query]);

  const airborne = flights.filter((f) => f.position && !f.position.on_ground).length;
  const updated = live.dataUpdatedAt ? ageSeconds(new Date(live.dataUpdatedAt).toISOString(), now) : null;

  // El enlace del Operations Center abre un vuelo concreto (?flight=…).
  useEffect(() => {
    const id = params.get('flight');
    if (id && id !== selectedId) {
      setSelectedId(id);
      setFollow(true);
    }
    // Solo cuando cambia la URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  function select(id: string | null) {
    setSelectedId(id);
    setFollow(id !== null);
    setParams(id ? { flight: id } : {}, { replace: true });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vuelos en vivo"
        description={`Vuelos en curso de ${airline ? airline.name : 'todas las aerolíneas'}. El mapa se actualiza cada 10 s; entre lecturas, la posición de cada avión se estima con su rumbo y velocidad.`}
        actions={
          <span className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm" role="status">
            <span className={cn('size-2 rounded-full', live.isError ? 'bg-danger' : 'animate-pulse bg-ok')} aria-hidden />
            {live.isError ? 'Sin conexión' : updated === null ? 'Conectando…' : `Actualizado ${formatAge(updated)}`}
          </span>
        }
      />

      {live.isError ? <Alert tone="danger">{describeError(live.error)}</Alert> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="relative min-w-0">
          {!ready ? (
            <Skeleton className="h-[560px]" />
          ) : (
            <LiveMap
              flights={flights}
              selectedId={selectedId}
              onSelect={select}
              track={track.data ?? []}
              now={now}
              follow={follow}
              onUserMove={() => setFollow(false)}
              fitNonce={fitNonce}
              theme={theme}
              height="clamp(360px, 62vh, 640px)"
            />
          )}
          <div className="pointer-events-none absolute left-14 top-3 z-[1] flex gap-2">
            <span className="pointer-events-auto rounded-md border border-line bg-surface/95 px-2.5 py-1 text-sm shadow">
              <Radar className="mr-1.5 inline size-4 text-cyan" aria-hidden />
              <strong className="tabular-nums">{flights.length}</strong> en curso · <strong className="tabular-nums">{airborne}</strong> en el aire
            </span>
            {flights.length > 0 ? (
              <Button
                size="sm"
                variant="secondary"
                className="pointer-events-auto"
                onClick={() => {
                  setFollow(false);
                  setFitNonce((n) => n + 1);
                }}
              >
                <Maximize className="size-4" aria-hidden />
                Ver todos
              </Button>
            ) : null}
          </div>
        </div>

        <aside aria-label="Lista de vuelos en curso" className="flex min-w-0 flex-col gap-3">
          <label className="relative block">
            <span className="sr-only">Buscar vuelo</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Callsign, piloto, aeropuerto…" className="pl-8" />
          </label>
          {live.isPending ? (
            <Skeleton className="h-40" />
          ) : flights.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line px-4 py-10 text-center">
              <p className="font-display text-lg font-semibold">No hay vuelos en curso</p>
              <p className="mt-1 text-sm text-muted">Cuando un piloto inicie un vuelo en LAM ACARS aparecerá aquí.</p>
            </div>
          ) : visible.length === 0 ? (
            <p className="text-sm text-muted">Ningún vuelo coincide con la búsqueda.</p>
          ) : (
            <ul className="flex max-h-[min(62vh,640px)] flex-col gap-2 overflow-y-auto pr-1">
              {visible.map((f) => (
                <FlightCard key={f.flight_id} flight={f} now={now} selected={f.flight_id === selectedId} onSelect={() => select(f.flight_id === selectedId ? null : f.flight_id)} />
              ))}
            </ul>
          )}
        </aside>
      </div>

      {selected ? (
        <FlightDetail
          flight={selected}
          now={now}
          follow={follow}
          onFollow={() => setFollow((v) => !v)}
        />
      ) : flights.length > 0 ? (
        <p className="text-sm text-muted">Elige un vuelo en el mapa o en la lista para ver su ruta, la traza volada y sus datos.</p>
      ) : null}
    </div>
  );
}
