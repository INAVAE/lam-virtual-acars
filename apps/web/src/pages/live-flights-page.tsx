import type { LiveFlight } from '@lam/shared-types';
import { CloudRain, CloudSun, LocateFixed, Maximize, Radar, RadioTower, Route, Search, Tag, TriangleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { AirlineLogo } from '@/components/airline-logo';
import { FlightProfileChart } from '@/components/flight-profile-chart';
import { LiveMap, planeColor } from '@/components/live-map';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { useLiveFlights, useLiveTraces } from '@/hooks/use-live-flights';
import { useFirData, useFlightRoutes, useIvaoAtc, useRadarFrame } from '@/hooks/use-map-layers';
import { useNow } from '@/hooks/use-now';
import { useWeather } from '@/hooks/use-weather';
import { aircraftSvg, MAP_CATEGORY_LABELS, mapCategory } from '@/lib/aircraft-icons';
import { useAirlineScope } from '@/lib/airline-scope';
import { cn } from '@/lib/cn';
import { describeError } from '@/lib/errors';
import {
  apuIntervals,
  cumulativeDistance,
  eventMarkers,
  formatWind,
  formatWindComponents,
  fuelSeries,
  phaseColor,
  phaseSpans,
  shearMarkers,
  windComponents,
  windShearEvents,
} from '@/lib/flight-analysis';
import { formatNumber, formatPilotNumber } from '@/lib/format';
import {
  ageSeconds,
  alertText,
  eteMinutes,
  flightProgress,
  formatAge,
  MAX_SELECTED,
  parseSelection,
  STALE_SECONDS,
  toggleSelection,
  worstAlert,
  type LiveTrace,
} from '@/lib/live';
import {
  atcFacility,
  atisText,
  facilityColors,
  facilityLabels,
  firFor,
  formatFrequency,
  groupAtcs,
  onlineFor,
  type AtcStation,
  type RouteFix,
} from '@/lib/map-layers';
import { phaseLabel } from '@/lib/phases';
import { formatMinutes } from '@/lib/pirep';
import { useTheme } from '@/lib/theme';
import { useTimePrefs } from '@/lib/time-context';

const ALERT_RANK = { danger: 3, warn: 2, info: 1 } as const;
const STORAGE_KEY = 'lam.liveSelection';
const LAYERS_KEY = 'lam.liveLayers';

interface MapLayers {
  labels: boolean;
  routes: boolean;
  radar: boolean;
  metar: boolean;
  ivao: boolean;
}

const DEFAULT_LAYERS: MapLayers = { labels: true, routes: true, radar: false, metar: false, ivao: true };

function readStoredLayers(): MapLayers {
  try {
    const v = JSON.parse(window.localStorage.getItem(LAYERS_KEY) ?? 'null') as Partial<MapLayers> | null;
    if (v && typeof v === 'object') {
      return {
        labels: typeof v.labels === 'boolean' ? v.labels : DEFAULT_LAYERS.labels,
        routes: typeof v.routes === 'boolean' ? v.routes : DEFAULT_LAYERS.routes,
        radar: typeof v.radar === 'boolean' ? v.radar : DEFAULT_LAYERS.radar,
        metar: typeof v.metar === 'boolean' ? v.metar : DEFAULT_LAYERS.metar,
        ivao: typeof v.ivao === 'boolean' ? v.ivao : DEFAULT_LAYERS.ivao,
      };
    }
  } catch {
    // Valor dañado o sin almacenamiento: capas por omisión.
  }
  return DEFAULT_LAYERS;
}

const LAYER_ITEMS: { key: keyof MapLayers; label: string; icon: typeof Tag; hint: string }[] = [
  { key: 'labels', label: 'Etiquetas', icon: Tag, hint: 'Logo de la aerolínea y callsign de cada avión' },
  { key: 'routes', label: 'Ruta del plan', icon: Route, hint: 'Puntos del plan de SimBrief de los vuelos elegidos' },
  { key: 'radar', label: 'Radar', icon: CloudRain, hint: 'Precipitación de RainViewer (últimos 10 minutos)' },
  { key: 'metar', label: 'METAR', icon: CloudSun, hint: 'Categoría de vuelo en origen y destino' },
  { key: 'ivao', label: 'Control IVAO', icon: RadioTower, hint: 'Controladores conectados a IVAO y su zona' },
];

function LayerToggles({ layers, onChange }: { layers: MapLayers; onChange: (next: MapLayers) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Capas del mapa">
      {LAYER_ITEMS.map(({ key, label, icon: Icon, hint }) => (
        <button
          key={key}
          type="button"
          title={hint}
          aria-pressed={layers[key]}
          onClick={() => onChange({ ...layers, [key]: !layers[key] })}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors',
            layers[key] ? 'border-accent bg-accent/15 text-ink' : 'border-line bg-surface text-muted hover:text-ink',
          )}
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}

/** Controladores de una estación de IVAO: posición, frecuencia, tiempo en línea y ATIS. Sin datos personales. */
function AtcPanel({ station, firName, now, onClose }: { station: AtcStation; firName: string | null; now: number; onClose: () => void }) {
  return (
    <section aria-label={`Control de IVAO en ${station.code}`} className="rounded-lg border border-line bg-surface p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Control activo en IVAO</p>
          <p className="font-display text-xl font-semibold">
            {station.code}
            {firName ? <span className="ml-2 text-base font-normal text-muted">{firName}</span> : null}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded p-1 text-muted hover:text-ink" aria-label="Cerrar">
          <X className="size-4" aria-hidden />
        </button>
      </header>
      <ul className="mt-3 grid gap-3 md:grid-cols-2">
        {station.atcs.map((a) => {
          const facility = atcFacility(a);
          const atis = atisText(a.atis);
          return (
            <li key={a.callsign} className="rounded-md border border-line bg-bg p-3">
              <p className="flex flex-wrap items-center gap-2">
                <span className="rounded px-1.5 py-0.5 font-mono text-xs font-semibold text-white" style={{ background: facilityColors[facility] }}>
                  {facility === 'OTHER' ? 'ATC' : facility}
                </span>
                <span className="font-mono font-semibold">{a.callsign}</span>
                <span className="text-sm text-muted">{facilityLabels[facility]}</span>
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div>
                  <dt className="text-xs text-muted">Frecuencia</dt>
                  <dd className="font-mono">{formatFrequency(a.frequency)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">En línea</dt>
                  <dd className="font-mono">{onlineFor(a.online_since, now)}</dd>
                </div>
              </dl>
              {atis.length > 0 ? (
                <div className="mt-2">
                  <p className="text-xs text-muted">ATIS{a.atis_revision ? ` (información ${a.atis_revision})` : ''}</p>
                  <p className="mt-0.5 font-mono text-xs leading-relaxed break-words">{atis.join(' ')}</p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function readStoredSelection(): string[] {
  try {
    return parseSelection(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

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

/** Figura del avión con el color que lleva en el mapa (fase, evento o tour). */
function PlaneGlyph({ flight }: { flight: LiveFlight }) {
  return (
    <span
      className="inline-grid size-8 shrink-0 place-items-center"
      title={MAP_CATEGORY_LABELS[mapCategory(flight.map_category)]}
      // SVG propio generado en aircraft-icons.ts; el color sale de una lista fija o de un hex validado en la base.
      dangerouslySetInnerHTML={{ __html: aircraftSvg(flight.map_category, planeColor(flight)) }}
    />
  );
}

/** Etiqueta del evento o del tour que vuela el avión. */
function ProgramTag({ flight, now }: { flight: LiveFlight; now: number }) {
  if (flight.event) {
    const ev = flight.event;
    const total = Math.round((Date.parse(ev.ends_at) - Date.parse(ev.starts_at)) / 60_000);
    const left = Math.max(0, Math.round((Date.parse(ev.ends_at) - now) / 60_000));
    return (
      <span className="inline-flex flex-wrap items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs" style={{ borderColor: ev.color, color: ev.color }}>
        <strong>Evento {ev.folio}</strong>
        <span>· {ev.name}</span>
        <span className="text-muted">
          · dura {formatMinutes(total)} · {left > 0 ? `termina en ${formatMinutes(left)}` : 'terminado'}
        </span>
      </span>
    );
  }
  if (flight.tour) {
    const t = flight.tour;
    return (
      <span className="inline-flex flex-wrap items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs" style={{ borderColor: t.color, color: t.color }}>
        <strong>Tour {t.code}</strong>
        <span>· {t.name}</span>
        <strong>
          · Leg {t.leg}/{t.legs}
        </strong>
      </span>
    );
  }
  return null;
}

/**
 * Distancia recorrida y por volar, y tiempo en curso, por volar y total estimado
 * (en curso + por volar; sin estimación, el del plan). Mismos datos que el detalle.
 */
function FlightProgressFacts({ flight, now }: { flight: LiveFlight; now: number }) {
  const remaining = flight.remaining_nm;
  const flown = remaining !== null ? Math.max(0, flight.route_nm - remaining) : null;
  const elapsed = Math.max(0, Math.round((now - Date.parse(flight.started_at)) / 60_000));
  const ete = eteMinutes(flight);
  const total = ete !== null ? elapsed + ete : flight.planned_minutes;
  return (
    <span className="mt-1.5 grid grid-cols-3 gap-x-2 gap-y-0.5 font-mono text-xs">
      <span className="text-muted">Recorrido</span>
      <span className="text-muted">Por volar</span>
      <span className="text-muted">Total</span>
      <span>{flown !== null ? `${formatNumber(flown)} NM` : '—'}</span>
      <span>{remaining !== null ? `${formatNumber(remaining)} NM` : '—'}</span>
      <span>{`${formatNumber(flight.route_nm)} NM`}</span>
      <span>{formatMinutes(elapsed)}</span>
      <span>{ete !== null ? formatMinutes(ete) : '—'}</span>
      <span title={ete !== null ? 'En curso más el tiempo estimado al destino' : 'Tiempo del plan'}>
        {formatMinutes(total)}
      </span>
    </span>
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
          <PlaneGlyph flight={flight} />
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
              {flight.airline.icao ? `${flight.airline.icao} · ` : ''}
              {flight.pilot.name} · {flight.aircraft_type}
            </span>
          </span>
        </span>
        {flight.event || flight.tour ? (
          <span className="mt-1.5 block">
            <ProgramTag flight={flight} now={now} />
          </span>
        ) : null}
        <span className="mt-2 flex items-center justify-between font-mono text-sm">
          <span>{flight.origin.icao}</span>
          <span className="mx-2 flex-1">
            <Progress value={flightProgress(flight)} color={phaseColor(flight.phase)} />
          </span>
          <span>{flight.destination.icao}</span>
        </span>
        <FlightProgressFacts flight={flight} now={now} />
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

/** Ruta del plan de SimBrief importado en My Flights (texto de la ruta, como en el OFP). */
function FlightPlanRoute({ flightId }: { flightId: string }) {
  const query = useFlightRoutes([flightId], true)[0];
  const route = query?.data?.route?.trim();
  if (query?.isPending) return null;
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">Ruta del plan (SimBrief)</p>
      {route ? (
        <p className="mt-1 break-words font-mono text-sm leading-relaxed">{route}</p>
      ) : (
        <p className="mt-1 text-sm text-muted">Sin plan de SimBrief importado.</p>
      )}
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
  const wind = p ? windComponents(p.wind_dir_deg, p.wind_kt, p.heading_deg) : null;
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
          {flight.event || flight.tour ? (
            <p className="mt-1">
              <ProgramTag flight={flight} now={now} />
            </p>
          ) : null}
        </div>
        <Button size="sm" variant={follow ? 'primary' : 'secondary'} onClick={onFollow} aria-pressed={follow}>
          <LocateFixed className="size-4" aria-hidden />
          {follow ? 'Siguiendo' : 'Seguir'}
        </Button>
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
          {wind ? <span className="block font-sans text-xs text-muted">{formatWindComponents(wind)}</span> : null}
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
          <span className="block font-sans text-xs text-muted">{MAP_CATEGORY_LABELS[mapCategory(flight.map_category)]}</span>
        </Datum>
        <Datum label="Plan">{`${formatNumber(flight.planned_distance_nm)} NM · ${formatMinutes(flight.planned_minutes)}`}</Datum>
        <Datum label="Última señal">
          <span className={contact >= STALE_SECONDS ? 'text-warn-ink' : undefined}>{formatAge(contact)}</span>
        </Datum>
      </dl>
      <FlightPlanRoute flightId={flight.flight_id} />
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

/** Perfil del vuelo en curso (altitud, velocidad, viento y combustible), igual que en el PIREP. */
function LiveProfile({ trace }: { trace: LiveTrace }) {
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const { points, events } = trace;
  const times = useMemo(() => points.map((p) => Date.parse(p.sampled_at)), [points]);
  const distances = useMemo(() => cumulativeDistance(points), [points]);
  const spans = useMemo(() => phaseSpans(points), [points]);
  const shear = useMemo(() => windShearEvents(points, times), [points, times]);
  const markers = useMemo(() => [...eventMarkers(events), ...shearMarkers(points, shear)].sort((a, b) => a.time - b.time), [events, points, shear]);
  const fuel = useMemo(() => fuelSeries(points, times, events), [points, times, events]);
  const apu = useMemo(() => apuIntervals(events, times[times.length - 1] ?? 0), [events, times]);
  if (points.length < 2) {
    return <p className="text-sm text-muted">La traza aparece en cuanto el conector envía su primer lote de puntos (cerca de un minuto).</p>;
  }
  const safe = (i: number | null) => (i !== null && i < points.length ? i : null);
  return (
    <FlightProfileChart
      points={points}
      times={times}
      distances={distances}
      spans={spans}
      markers={markers}
      fuel={fuel}
      reserveKg={null}
      apu={apu}
      shear={shear}
      activeIndex={safe(pinned) ?? safe(hover)}
      pinned={safe(pinned) !== null}
      onHover={setHover}
      onSelect={(i) => setPinned((cur) => (i === null || cur === i ? null : i))}
      onPin={setPinned}
    />
  );
}

/**
 * Vuelos en curso de las aerolíneas del piloto, en un mapa que se actualiza cada
 * 10 s. Un clic en un avión lo agrega a la selección: su trayectoria volada queda
 * visible con sus fases y la ruta que le falta en rojo. Se pueden elegir varios.
 */
export function LiveFlightsPage() {
  const { selected: airline, ready } = useAirlineScope();
  const airlineId = airline?.id ?? null;
  const live = useLiveFlights(airlineId);
  const now = useNow(1000);
  const { theme } = useTheme();
  const { dual } = useTimePrefs();
  const [params, setParams] = useSearchParams();
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    const fromUrl = parseSelection(params.get('flights') ?? params.get('flight'));
    return fromUrl.length > 0 ? fromUrl : readStoredSelection();
  });
  const [focusedId, setFocusedId] = useState<string | null>(() => selectedIds[selectedIds.length - 1] ?? null);
  const [follow, setFollow] = useState(() => params.get('flight') !== null);
  const [fitNonce, setFitNonce] = useState(0);
  const [query, setQuery] = useState('');
  const [layers, setLayers] = useState<MapLayers>(readStoredLayers);
  const [stationKey, setStationKey] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(LAYERS_KEY, JSON.stringify(layers));
    } catch {
      // Sin almacenamiento: las capas duran lo que la pestaña.
    }
  }, [layers]);

  const flights = useMemo(() => sortFlights(live.data ?? []), [live.data]);
  // Las trazas se piden solo para los elegidos que siguen en curso.
  const activeSelection = useMemo(() => {
    if (!live.data) return selectedIds;
    const ids = new Set(live.data.map((f) => f.flight_id));
    return selectedIds.filter((id) => ids.has(id));
  }, [live.data, selectedIds]);
  const traceQueries = useLiveTraces(activeSelection);
  // El registro solo cambia cuando llega una traza nueva, para no redibujar el mapa cada segundo.
  const traceKey = activeSelection.map((id, i) => `${id}:${traceQueries[i]?.dataUpdatedAt ?? 0}`).join('|');
  const traces = useMemo(() => {
    const out: Record<string, LiveTrace | undefined> = {};
    activeSelection.forEach((id, i) => {
      out[id] = traceQueries[i]?.data;
    });
    return out;
    // traceKey resume las trazas recibidas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traceKey]);

  // Ruta del plan de SimBrief de los elegidos.
  const routeQueries = useFlightRoutes(activeSelection, layers.routes);
  const routeKey = activeSelection.map((id, i) => `${id}:${routeQueries[i]?.dataUpdatedAt ?? 0}`).join('|');
  const routes = useMemo(() => {
    const out: Record<string, RouteFix[] | undefined> = {};
    activeSelection.forEach((id, i) => {
      out[id] = routeQueries[i]?.data?.fixes;
    });
    return out;
    // routeKey resume las rutas recibidas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  // METAR de origen y destino (los elegidos primero; la función acepta 10 aeropuertos).
  const metarIcaos = useMemo(() => {
    const ordered = [...flights].sort((a, b) => Number(selectedIds.includes(b.flight_id)) - Number(selectedIds.includes(a.flight_id)));
    return [...new Set(ordered.flatMap((f) => [f.origin.icao, f.destination.icao]))].slice(0, 10);
  }, [flights, selectedIds]);
  const weather = useWeather(layers.metar ? metarIcaos : []);

  // Control activo de IVAO.
  const atc = useIvaoAtc(layers.ivao);
  const stations = useMemo(() => groupAtcs(atc.data?.atcs ?? []), [atc.data]);
  const fir = useFirData(layers.ivao && stations.some((st) => st.kind === 'center'));
  const ivaoLayer = useMemo(
    () => (layers.ivao ? { stations, fir: fir.data ?? null } : null),
    [layers.ivao, stations, fir.data],
  );
  const station = stationKey ? (stations.find((st) => `${st.kind}:${st.code}` === stationKey) ?? null) : null;

  const radar = useRadarFrame(layers.radar);

  const focused = flights.find((f) => f.flight_id === focusedId) ?? null;
  const focusedTrace = focusedId ? traces[focusedId] : undefined;

  // El enlace del Operations Center abre un vuelo concreto (?flight=…) y lo suma a la selección.
  useEffect(() => {
    const [id] = parseSelection(params.get('flight'));
    if (!id) return;
    setSelectedIds((cur) => (cur.includes(id) ? cur : toggleSelection(cur, id)));
    setFocusedId(id);
    setFollow(true);
    // Solo cuando cambia la URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('flight')]);

  // La selección se recuerda en el navegador y queda en la URL para compartirla.
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, selectedIds.join(','));
    } catch {
      // Sin almacenamiento disponible: la selección dura lo que la pestaña.
    }
    setParams(selectedIds.length > 0 ? { flights: selectedIds.join(',') } : {}, { replace: true });
    // setParams cambia de identidad con cada navegación.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds]);

  const visible = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return flights;
    return flights.filter((f) =>
      [f.callsign, f.origin.icao, f.destination.icao, f.aircraft_type, f.aircraft_registration, f.pilot.name.toUpperCase(), f.airline.icao ?? '', f.event?.folio ?? '', f.event?.name.toUpperCase() ?? '', f.tour?.code ?? '', f.tour?.name.toUpperCase() ?? ''].some((v) =>
        v.includes(q),
      ),
    );
  }, [flights, query]);

  const airborne = flights.filter((f) => f.position && !f.position.on_ground).length;
  const updated = live.dataUpdatedAt ? ageSeconds(new Date(live.dataUpdatedAt).toISOString(), now) : null;
  const timeText = useCallback(
    (value: string) => {
      const t = dual(value, { seconds: true });
      return t.secondary ? `${t.primary} · ${t.secondary}` : t.primary;
    },
    [dual],
  );

  function toggle(id: string) {
    const removing = selectedIds.includes(id);
    const next = toggleSelection(selectedIds, id);
    setSelectedIds(next);
    if (removing) {
      if (focusedId === id) setFocusedId(next[next.length - 1] ?? null);
      if (next.length === 0) setFollow(false);
    } else {
      setFocusedId(id);
      setFollow(true);
    }
  }

  function clearSelection() {
    setSelectedIds([]);
    setFocusedId(null);
    setFollow(false);
  }

  const chips = selectedIds.map((id) => flights.find((f) => f.flight_id === id)).filter((f): f is LiveFlight => f !== undefined);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vuelos en vivo"
        description={`Vuelos en curso de ${airline ? airline.name : 'todas las aerolíneas'}. Clic en un avión para ver su trayectoria y, en rojo, lo que le falta hasta su destino; puedes elegir hasta ${MAX_SELECTED}. Se actualiza cada 10 s.`}
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
              selectedIds={activeSelection}
              focusedId={focusedId}
              onToggle={toggle}
              traces={traces}
              now={now}
              follow={follow}
              onUserMove={() => setFollow(false)}
              fitNonce={fitNonce}
              theme={theme}
              height="clamp(380px, 64vh, 680px)"
              timeText={timeText}
              labels={layers.labels}
              routes={routes}
              showRoutes={layers.routes}
              radar={layers.radar ? (radar.data ?? null) : null}
              metars={layers.metar ? (weather.data?.byIcao ?? null) : null}
              ivao={ivaoLayer}
              onStationSelect={setStationKey}
            />
          )}
          <div className="pointer-events-none absolute left-14 right-3 top-3 z-[1] flex flex-wrap items-start gap-2">
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
            {chips.length > 0 ? (
              <ul className="pointer-events-auto flex flex-wrap gap-1.5" aria-label="Vuelos elegidos">
                {chips.map((f) => (
                  <li key={f.flight_id}>
                    <span
                      className={cn(
                        'inline-flex h-8 items-center gap-1 rounded-md border bg-surface/95 pl-2 pr-1 text-sm shadow',
                        f.flight_id === focusedId ? 'border-accent' : 'border-line',
                      )}
                    >
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 font-mono font-semibold"
                        onClick={() => {
                          setFocusedId(f.flight_id);
                          setFollow(true);
                        }}
                        aria-pressed={f.flight_id === focusedId}
                        title="Ver su detalle y seguirlo"
                      >
                        <span className="size-2 rounded-full" style={{ background: planeColor(f) }} aria-hidden />
                        {f.callsign}
                      </button>
                      <button type="button" onClick={() => toggle(f.flight_id)} aria-label={`Quitar ${f.callsign} de la selección`} className="rounded p-1 text-muted hover:text-ink">
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </span>
                  </li>
                ))}
                {chips.length > 1 ? (
                  <li>
                    <Button size="sm" variant="secondary" onClick={clearSelection}>
                      Limpiar
                    </Button>
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>
        </div>

        <aside aria-label="Lista de vuelos en curso" className="flex min-w-0 flex-col gap-3">
          <label className="relative block">
            <span className="sr-only">Buscar vuelo</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Callsign, piloto, aeropuerto, evento, tour…" className="pl-8" />
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
            <ul className="flex max-h-[min(64vh,680px)] flex-col gap-2 overflow-y-auto pr-1">
              {visible.map((f) => (
                <FlightCard key={f.flight_id} flight={f} now={now} selected={selectedIds.includes(f.flight_id)} onSelect={() => toggle(f.flight_id)} />
              ))}
            </ul>
          )}
        </aside>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <LayerToggles layers={layers} onChange={setLayers} />
        <p className="text-xs text-muted" role="status">
          {layers.ivao
            ? atc.isError
              ? 'Control IVAO: sin datos por ahora'
              : !atc.data || atc.data.fetched_at === null || atc.data.stale
                ? 'Control IVAO: actualizando (hasta un minuto)…'
                : `Control IVAO: ${atc.data.atcs.length} ${atc.data.atcs.length === 1 ? 'posición' : 'posiciones'}`
            : null}
          {layers.radar && radar.isError ? ' · Radar no disponible' : null}
        </p>
      </div>

      {station ? (
        <AtcPanel
          station={station}
          firName={station.kind === 'center' ? (firFor(station.code, fir.data?.index)?.name ?? null) : null}
          now={now}
          onClose={() => setStationKey(null)}
        />
      ) : null}

      {focused ? (
        <>
          <FlightDetail flight={focused} now={now} follow={follow} onFollow={() => setFollow((v) => !v)} />
          <Panel title={`Perfil de ${focused.callsign}`} description="Altitud, velocidades, viento y combustible del vuelo hasta ahora. Se completa con cada lote del conector.">
            {focusedTrace ? <LiveProfile key={focused.flight_id} trace={focusedTrace} /> : <Skeleton className="h-64" />}
          </Panel>
        </>
      ) : flights.length > 0 ? (
        <p className="text-sm text-muted">Elige uno o varios aviones en el mapa o en la lista para ver su trayectoria, la ruta que les falta y sus datos.</p>
      ) : null}

      <p className="text-xs text-muted">
        Solo para simulación. Control: IVAO, Whazzup público (se muestran la posición, la frecuencia y el ATIS, sin datos personales de los controladores). Límites de FIR:{' '}
        <a href="https://github.com/vatsimnetwork/vatspy-data-project" className="underline" target="_blank" rel="noopener noreferrer">
          VATSpy Data Project
        </a>
        , licencia{' '}
        <a href="https://creativecommons.org/licenses/by-sa/4.0/" className="underline" target="_blank" rel="noopener noreferrer">
          CC BY-SA 4.0
        </a>
        . Radar:{' '}
        <a href="https://www.rainviewer.com/" className="underline" target="_blank" rel="noopener noreferrer">
          RainViewer
        </a>
        , uso personal y educativo. METAR y TAF: NOAA Aviation Weather Center.
      </p>
    </div>
  );
}
