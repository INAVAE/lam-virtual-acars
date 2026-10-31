import type { LiveFlight, OpsDeparture, OpsFleetItem, OpsPirepQueueItem, PilotPerformance } from '@lam/shared-types';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Map as MapIcon, MessageSquare, Minus, TriangleAlert } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonClasses } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyRow, Table, Td, Th } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { useLiveFlights } from '@/hooks/use-live-flights';
import { useNow } from '@/hooks/use-now';
import { useOperationsOverview, usePilotPerformance } from '@/hooks/use-stats-ops';
import { useAirlineScope } from '@/lib/airline-scope';
import { cn } from '@/lib/cn';
import { describeError } from '@/lib/errors';
import { phaseColor } from '@/lib/flight-analysis';
import { aircraftStatusLabels, formatNumber, formatPilotNumber } from '@/lib/format';
import { ageSeconds, alertText, flightProgress, formatAge, STALE_SECONDS, worstAlert } from '@/lib/live';
import { useAirlinePermissions } from '@/lib/permissions';
import { phaseLabel } from '@/lib/phases';
import { formatHours, formatMinutes, formatVs, scoreTone } from '@/lib/pirep';
import { daysSince, scoreTrend } from '@/lib/statistics';
import { useTimePrefs } from '@/lib/time-context';

type Tab = 'live' | 'departures' | 'pireps' | 'fleet' | 'pilots';

function Kpi({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: 'warn' | 'danger'; hint?: string }) {
  return (
    <div className={cn('rounded-lg border bg-surface px-4 py-3', tone === 'danger' ? 'border-danger/50' : tone === 'warn' ? 'border-warn/50' : 'border-line')}>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className={cn('mt-1 font-display text-2xl font-semibold tabular-nums', tone === 'danger' ? 'text-danger-ink' : tone === 'warn' ? 'text-warn-ink' : undefined)}>{value}</p>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function Time({ value }: { value: string | null }) {
  const { dual } = useTimePrefs();
  if (!value) return <span className="text-muted">—</span>;
  const t = dual(value, { withDate: true });
  return (
    <span className="font-mono text-xs">
      {t.primary}
      {t.secondary ? <span className="block text-muted">{t.secondary}</span> : null}
    </span>
  );
}

function Pilot({ name, number }: { name: string; number: number }) {
  return (
    <>
      <span className="font-medium">{name}</span>
      <span className="block font-mono text-xs text-muted">{formatPilotNumber(number)}</span>
    </>
  );
}

// -----------------------------------------------------------------------------
// Vuelos activos
// -----------------------------------------------------------------------------
function LiveTable({ flights, now }: { flights: LiveFlight[]; now: number }) {
  const sorted = useMemo(() => {
    const rank = { danger: 3, warn: 2, info: 1 } as const;
    return [...flights].sort((a, b) => (rank[worstAlert(b.alerts)?.level ?? 'info'] ?? 0) - (rank[worstAlert(a.alerts)?.level ?? 'info'] ?? 0) || (b.alerts?.length ?? 0) - (a.alerts?.length ?? 0));
  }, [flights]);
  return (
    <Table minWidth="64rem">
      <thead>
        <tr>
          <Th>Vuelo</Th>
          <Th>Piloto</Th>
          <Th>Ruta</Th>
          <Th>Fase</Th>
          <Th className="text-right">Altitud · GS</Th>
          <Th className="text-right">En curso</Th>
          <Th>Señal</Th>
          <Th>Alertas</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {sorted.length === 0 ? (
          <EmptyRow colSpan={9}>No hay vuelos en curso.</EmptyRow>
        ) : (
          sorted.map((f) => {
            const contact = ageSeconds(f.last_contact_at, now);
            return (
              <tr key={f.flight_id}>
                <Td>
                  <span className="font-mono font-semibold">{f.callsign}</span>
                  <span className="block text-xs text-muted">
                    {f.aircraft_type} · {f.aircraft_registration}
                  </span>
                </Td>
                <Td>
                  <Pilot name={f.pilot.name} number={f.pilot.number} />
                </Td>
                <Td>
                  <span className="font-mono">
                    {f.origin.icao} → {f.destination.icao}
                  </span>
                  <span className="mt-1 block h-1 w-28 overflow-hidden rounded-full bg-surface-2">
                    <span className="block h-full" style={{ width: `${Math.round(flightProgress(f) * 100)}%`, background: phaseColor(f.phase) }} />
                  </span>
                </Td>
                <Td>
                  <span className="inline-flex items-center gap-1.5 text-sm">
                    <span className="size-2 rounded-full" style={{ background: phaseColor(f.phase) }} aria-hidden />
                    {phaseLabel(f.phase)}
                  </span>
                </Td>
                <Td className="text-right font-mono text-sm tabular-nums">
                  {f.position ? `${formatNumber(f.position.altitude_ft)} ft · ${f.position.gs_kt ?? '—'} kt` : '—'}
                </Td>
                <Td className="text-right font-mono tabular-nums">{formatMinutes(Math.round((now - Date.parse(f.started_at)) / 60_000))}</Td>
                <Td className={cn('text-sm', contact >= STALE_SECONDS && 'text-warn-ink')}>{formatAge(contact)}</Td>
                <Td>
                  {f.alerts && f.alerts.length > 0 ? (
                    <span className="flex max-w-80 flex-wrap gap-1">
                      {f.alerts.map((a, i) => (
                        <Badge key={`${a.code}-${i}`} tone={a.level === 'danger' ? 'danger' : a.level === 'warn' ? 'warn' : 'neutral'}>
                          {alertText(a)}
                        </Badge>
                      ))}
                    </span>
                  ) : (
                    <span className="text-sm text-ok-ink">Sin novedad</span>
                  )}
                </Td>
                <Td>
                  <Link to={`/live?flight=${f.flight_id}`} className={buttonClasses('ghost', 'sm')} aria-label={`Ver ${f.callsign} en el mapa`}>
                    <MapIcon className="size-4" aria-hidden />
                    Mapa
                  </Link>
                </Td>
              </tr>
            );
          })
        )}
      </tbody>
    </Table>
  );
}

// -----------------------------------------------------------------------------
// Salidas y reservas
// -----------------------------------------------------------------------------
const DEPARTURE_STATE: Record<OpsDeparture['state'], { label: string; tone: 'danger' | 'warn' | 'ok' }> = {
  late: { label: 'Atrasado', tone: 'danger' },
  expiring: { label: 'Reserva por vencer', tone: 'warn' },
  on_time: { label: 'En tiempo', tone: 'ok' },
};

function DeparturesTable({ rows }: { rows: OpsDeparture[] }) {
  return (
    <Table minWidth="60rem">
      <thead>
        <tr>
          <Th>Estado</Th>
          <Th>Vuelo</Th>
          <Th>Piloto</Th>
          <Th>Ruta</Th>
          <Th>Salida programada</Th>
          <Th>La reserva vence</Th>
          <Th>OFP</Th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow colSpan={7}>No hay vuelos reservados pendientes de salir.</EmptyRow>
        ) : (
          rows.map((d) => (
            <tr key={d.flight_id}>
              <Td>
                <Badge tone={DEPARTURE_STATE[d.state].tone}>{DEPARTURE_STATE[d.state].label}</Badge>
              </Td>
              <Td>
                <span className="font-mono font-semibold">{d.callsign}</span>
                <span className="block text-xs text-muted">
                  {d.aircraft_type} · {d.aircraft_registration} · {d.network}
                </span>
              </Td>
              <Td>
                <Pilot name={d.pilot.name} number={d.pilot.number} />
              </Td>
              <Td className="font-mono">
                {d.origin} → {d.destination}
              </Td>
              <Td>
                <Time value={d.scheduled_departure_at} />
              </Td>
              <Td>
                <Time value={d.booking_expires_at} />
              </Td>
              <Td>{d.has_ofp ? <Badge tone="ok">Cargado</Badge> : <Badge tone="warn">Falta</Badge>}</Td>
            </tr>
          ))
        )}
      </tbody>
    </Table>
  );
}

// -----------------------------------------------------------------------------
// Cola de PIREP
// -----------------------------------------------------------------------------
function PirepQueue({ rows, now }: { rows: OpsPirepQueueItem[]; now: number }) {
  return (
    <Table minWidth="58rem">
      <thead>
        <tr>
          <Th>Espera</Th>
          <Th>Vuelo</Th>
          <Th>Piloto</Th>
          <Th>Ruta</Th>
          <Th className="text-right">Puntaje</Th>
          <Th>Faltas graves</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow colSpan={7}>No hay PIREP por revisar.</EmptyRow>
        ) : (
          rows.map((p) => {
            const hours = Math.floor(ageSeconds(p.created_at, now) / 3600);
            return (
              <tr key={p.id}>
                <Td className={cn('text-sm', hours >= 48 ? 'text-danger-ink' : hours >= 24 ? 'text-warn-ink' : undefined)}>
                  {formatAge(ageSeconds(p.created_at, now))}
                </Td>
                <Td>
                  <span className="font-mono font-semibold">{p.callsign}</span>
                  <span className="block text-xs text-muted">
                    {formatMinutes(p.block_minutes)} block · {formatVs(p.landing_vs_fpm)}
                  </span>
                </Td>
                <Td>
                  <Pilot name={p.pilot.name} number={p.pilot.number} />
                  {p.pilot_comment ? (
                    <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted">
                      <MessageSquare className="size-3" aria-hidden /> Con comentario
                    </span>
                  ) : null}
                </Td>
                <Td className="font-mono">
                  {p.origin} → {p.diverted && p.arrival ? <span className="text-warn-ink">{p.arrival}</span> : p.destination}
                  {p.diverted ? <span className="block font-sans text-xs text-warn-ink">Desvío (destino {p.destination})</span> : null}
                </Td>
                <Td className="text-right">
                  <Badge tone={scoreTone(p.score)} className="min-w-10 justify-center font-mono text-sm">
                    {p.score}
                  </Badge>
                </Td>
                <Td>
                  {p.critical_labels.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {p.critical_labels.map((l) => (
                        <Badge key={l} tone="warn">
                          <TriangleAlert className="size-3" aria-hidden />
                          {l}
                        </Badge>
                      ))}
                    </span>
                  ) : (
                    <span className="text-sm text-muted">—</span>
                  )}
                </Td>
                <Td>
                  <Link to={`/pireps/${p.id}`} className={buttonClasses('secondary', 'sm')}>
                    Revisar
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </Td>
              </tr>
            );
          })
        )}
      </tbody>
    </Table>
  );
}

// -----------------------------------------------------------------------------
// Flota
// -----------------------------------------------------------------------------
function FleetTable({ rows }: { rows: OpsFleetItem[] }) {
  const [filter, setFilter] = useState<'all' | 'in_use' | 'away'>('all');
  const visible = rows.filter((a) => (filter === 'in_use' ? a.usage !== null : filter === 'away' ? a.away_from_base : true));
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-muted">
        Mostrar
        <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="w-auto">
          <option value="all">Toda la flota ({rows.length})</option>
          <option value="in_use">En uso ({rows.filter((a) => a.usage !== null).length})</option>
          <option value="away">Fuera de base ({rows.filter((a) => a.away_from_base).length})</option>
        </Select>
      </label>
      <Table minWidth="60rem">
        <thead>
          <tr>
            <Th>Matrícula</Th>
            <Th>Tipo</Th>
            <Th>Estado</Th>
            <Th>Ubicación</Th>
            <Th>Uso</Th>
            <Th className="text-right">Horas</Th>
            <Th className="text-right">Ciclos</Th>
            <Th>Último vuelo</Th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <EmptyRow colSpan={8}>Sin aeronaves en esta vista.</EmptyRow>
          ) : (
            visible.map((a) => (
              <tr key={a.id}>
                <Td>
                  <span className="font-mono font-semibold">{a.registration}</span>
                  {a.fleet_number ? <span className="block text-xs text-muted">Flota {a.fleet_number}</span> : null}
                </Td>
                <Td className="font-mono">{a.aircraft_type}</Td>
                <Td>
                  <Badge tone={a.status === 'available' ? 'ok' : a.status === 'maintenance' ? 'warn' : 'neutral'}>{aircraftStatusLabels[a.status as keyof typeof aircraftStatusLabels] ?? a.status}</Badge>
                </Td>
                <Td>
                  <span className="font-mono">{a.current_airport ?? '—'}</span>
                  {a.away_from_base ? <span className="block text-xs text-warn-ink">Fuera de base ({a.base_airport})</span> : a.base_airport ? <span className="block text-xs text-muted">Base {a.base_airport}</span> : null}
                </Td>
                <Td>
                  {a.usage === 'flying' ? (
                    <Badge tone="info">Volando · {a.usage_callsign}</Badge>
                  ) : a.usage === 'booked' ? (
                    <Badge>Reservada · {a.usage_callsign ?? 'sin vuelo'}</Badge>
                  ) : (
                    <span className="text-sm text-muted">Libre</span>
                  )}
                  {a.usage_pilot ? <span className="block text-xs text-muted">{a.usage_pilot}</span> : null}
                </Td>
                <Td className="text-right font-mono tabular-nums">{formatHours(a.total_minutes)}</Td>
                <Td className="text-right font-mono tabular-nums">{formatNumber(a.cycles)}</Td>
                <Td>
                  <Time value={a.last_flight_at} />
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Pilotos
// -----------------------------------------------------------------------------
function Trend({ current, previous }: { current: number | null; previous: number | null }) {
  const t = scoreTrend(current, previous);
  if (t === null) return null;
  const Icon = t === 'up' ? ArrowUpRight : t === 'down' ? ArrowDownRight : Minus;
  return (
    <Icon
      className={cn('inline size-4', t === 'up' ? 'text-ok-ink' : t === 'down' ? 'text-danger-ink' : 'text-muted')}
      aria-label={`Periodo anterior: ${previous?.toFixed(1)}`}
    />
  );
}

function PilotsTable({ airlineId, now }: { airlineId: string | null; now: number }) {
  const [days, setDays] = useState(90);
  const perf = usePilotPerformance(airlineId, days);
  const pilots: PilotPerformance[] = perf.data?.pilots ?? [];
  const inactive = pilots.filter((p) => (daysSince(p.last_flight_at, now) ?? Infinity) > 30).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-muted">
          Periodo
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-auto">
            <option value={30}>30 días</option>
            <option value={90}>90 días</option>
            <option value={180}>180 días</option>
            <option value={365}>1 año</option>
          </Select>
        </label>
        {pilots.length > 0 ? (
          <p className="text-sm text-muted">
            {pilots.length} pilotos · <span className={inactive > 0 ? 'text-warn-ink' : undefined}>{inactive} sin volar en 30 días</span>
          </p>
        ) : null}
      </div>
      {perf.isError ? <Alert tone="danger">{describeError(perf.error)}</Alert> : null}
      {perf.isPending ? (
        <Skeleton className="h-40" />
      ) : (
        <Table minWidth="68rem">
          <thead>
            <tr>
              <Th>Piloto</Th>
              <Th className="text-right">Vuelos</Th>
              <Th className="text-right">Horas</Th>
              <Th className="text-right">Puntaje</Th>
              <Th className="text-right">Toma prom.</Th>
              <Th className="text-right">Con faltas graves</Th>
              <Th>Faltas frecuentes</Th>
              <Th>Último vuelo</Th>
            </tr>
          </thead>
          <tbody>
            {pilots.length === 0 ? (
              <EmptyRow colSpan={8}>Sin pilotos activos.</EmptyRow>
            ) : (
              pilots.map((p) => {
                const since = daysSince(p.last_flight_at, now);
                return (
                  <tr key={p.user_id}>
                    <Td>
                      <Pilot name={p.name} number={p.number} />
                      {p.airlines.length > 1 ? <span className="text-xs text-muted">{p.airlines.join(' · ')}</span> : null}
                    </Td>
                    <Td className="text-right font-mono tabular-nums">
                      {p.flights}
                      {p.flights > 0 ? (
                        <span className="block text-xs text-muted">
                          {p.accepted} ✓ · {p.pending} … · {p.rejected} ✕
                        </span>
                      ) : null}
                    </Td>
                    <Td className="text-right font-mono tabular-nums">
                      {formatHours(p.block_minutes)}
                      <span className="block text-xs text-muted">{formatHours(p.total_block_minutes)} total</span>
                    </Td>
                    <Td className="text-right">
                      {p.average_score === null ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <Trend current={p.average_score} previous={p.previous_average_score} />
                          <Badge tone={scoreTone(p.average_score)} className="font-mono">
                            {p.average_score.toFixed(1)}
                          </Badge>
                        </span>
                      )}
                    </Td>
                    <Td className="text-right font-mono tabular-nums">{p.average_landing_vs_fpm === null ? '—' : formatVs(p.average_landing_vs_fpm)}</Td>
                    <Td className={cn('text-right font-mono tabular-nums', p.critical_findings > 0 && 'text-warn-ink')}>{p.critical_findings}</Td>
                    <Td className="text-sm">{p.top_findings.length > 0 ? p.top_findings.join(', ') : <span className="text-muted">—</span>}</Td>
                    <Td className={cn('text-sm', since === null || since > 30 ? 'text-warn-ink' : undefined)}>
                      {since === null ? 'Nunca' : since === 0 ? 'Hoy' : `Hace ${since} días`}
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </Table>
      )}
    </div>
  );
}

/**
 * Operations Center: lo que el jefe de operaciones necesita ver de un vistazo.
 * Vuelos activos con alertas (cada 10 s), salidas y reservas, cola de PIREP,
 * flota y rendimiento de los pilotos (cada minuto).
 */
export function OperationsPage() {
  const { selected: airline, isOrgAdmin, ready } = useAirlineScope();
  const perms = useAirlinePermissions(airline?.id);
  const canStaff = isOrgAdmin || perms.canStaff;
  const airlineId = airline?.id ?? null;
  const [tab, setTab] = useState<Tab>('live');
  const now = useNow(5000);
  const live = useLiveFlights(airlineId);
  const ops = useOperationsOverview(airlineId, canStaff);

  if (!ready) return <Skeleton className="h-64" />;
  if (!canStaff) {
    return (
      <div className="space-y-5">
        <PageHeader title="Operations Center" />
        <Alert tone="info">El Operations Center es para el administrador y el jefe de operaciones de la aerolínea.</Alert>
      </div>
    );
  }

  const flights = live.data ?? [];
  const withAlerts = flights.filter((f) => (f.alerts ?? []).some((a) => a.level !== 'info')).length;
  const o = ops.data;
  const late = o?.departures.filter((d) => d.state === 'late').length ?? 0;
  const critical = o?.pirep_queue.filter((p) => p.has_critical).length ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Operations Center"
        description={`${airline ? airline.name : 'Todas las aerolíneas'}. Los vuelos activos se actualizan cada 10 s; lo demás, cada minuto.`}
      />

      {live.isError ? <Alert tone="danger">{describeError(live.error)}</Alert> : null}
      {ops.isError ? <Alert tone="danger">{describeError(ops.error)}</Alert> : null}

      <section aria-label="Resumen" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="En curso" value={flights.length} />
        <Kpi label="Con alertas" value={withAlerts} tone={withAlerts > 0 ? 'warn' : undefined} />
        <Kpi label="Salidas pendientes" value={o ? o.departures.length : '—'} hint={late > 0 ? `${late} atrasadas` : undefined} tone={late > 0 ? 'warn' : undefined} />
        <Kpi label="PIREP por revisar" value={o ? o.pirep_queue.length : '—'} hint={critical > 0 ? `${critical} con faltas graves` : undefined} tone={critical > 0 ? 'warn' : undefined} />
        <Kpi label="Completados 24 h" value={o ? o.counts.flights_completed_24h : '—'} />
        <Kpi label="Reservas vencidas 24 h" value={o ? o.counts.bookings_expired_24h : '—'} />
      </section>

      <Tabs<Tab>
        label="Módulos del Operations Center"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'live', label: 'Vuelos activos', count: flights.length },
          { value: 'departures', label: 'Salidas y reservas', count: o?.departures.length },
          { value: 'pireps', label: 'PIREP por revisar', count: o?.pirep_queue.length },
          { value: 'fleet', label: 'Flota', count: o?.fleet.length },
          { value: 'pilots', label: 'Pilotos' },
        ]}
      />

      <div role="tabpanel">
        {tab === 'live' ? (
          live.isPending ? <Skeleton className="h-40" /> : <LiveTable flights={flights} now={now} />
        ) : tab === 'pilots' ? (
          <PilotsTable airlineId={airlineId} now={now} />
        ) : !o ? (
          <Skeleton className="h-40" />
        ) : tab === 'departures' ? (
          <DeparturesTable rows={o.departures} />
        ) : tab === 'pireps' ? (
          <PirepQueue rows={o.pirep_queue} now={now} />
        ) : (
          <FleetTable rows={o.fleet} />
        )}
      </div>
    </div>
  );
}
