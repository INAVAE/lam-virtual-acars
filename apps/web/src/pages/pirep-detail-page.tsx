import type { PirepFuel, PirepMetrics } from '@lam/shared-types';
import { ArrowLeft, Check, Plane, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { AirlineLogo } from '@/components/airline-logo';
import { FlightAnalysisPanel } from '@/components/flight-analysis-panel';
import type { MapAirport } from '@/components/flight-map';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  useCommentPirep,
  usePirep,
  usePirepTrack,
  useReviewPirep,
  type FlightEvent,
  type PirepDetail,
} from '@/hooks/use-pireps';
import { useAuth } from '@/lib/auth';
import { useAirlineScope } from '@/lib/airline-scope';
import { formatZuluDateTime } from '@/lib/booking';
import { describeError } from '@/lib/errors';
import { formatLocalDateTime, formatNumber, formatPilotNumber } from '@/lib/format';
import { useAirlinePermissions } from '@/lib/permissions';
import { phaseLabel } from '@/lib/phases';
import {
  findingDetail,
  formatMinutes,
  formatVs,
  landingRating,
  metricNumber,
  parseFindings,
  parseMetrics,
  pirepStatusLabels,
  pirepStatusTone,
  scoreTone,
} from '@/lib/pirep';

function Fact({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className={mono ? 'mt-0.5 font-mono text-[15px]' : 'mt-0.5 text-[15px]'}>{children}</dd>
    </div>
  );
}

function zulu(iso: string | null): string {
  return iso ? formatZuluDateTime(iso) : '—';
}

function num(value: number | null, suffix: string, digits = 0): string {
  return value === null ? '—' : `${value.toFixed(digits)}${suffix}`;
}

// -----------------------------------------------------------------------------
// Bitácora de eventos
// -----------------------------------------------------------------------------
const eventLabels: Record<string, string> = {
  phase_change: 'Fase',
  block_off: 'Calzos fuera',
  takeoff: 'Despegue',
  touchdown: 'Contacto con pista',
  block_on: 'Calzos puestos',
  engine_start: 'Motor encendido',
  engine_shutdown: 'Motor apagado',
  sim_paused: 'Pausa',
  sim_resumed: 'Fin de pausa',
  slew: 'Slew',
  crash: 'Choque',
  overspeed: 'Sobrevelocidad',
  stall: 'Pérdida',
  aircraft_changed: 'Cambio de aeronave',
  connection_lost: 'Conexión perdida',
  connection_restored: 'Conexión recuperada',
  note: 'Nota',
};

function eventDetail(e: FlightEvent): string {
  const d = (e.data ?? {}) as Record<string, unknown>;
  switch (e.type) {
    case 'phase_change':
      return `${phaseLabel(String(d.to ?? e.phase))}${d.reason ? ` (${String(d.reason).replaceAll('_', ' ')})` : ''}`;
    case 'block_off':
    case 'block_on':
      return typeof d.fuel_kg === 'number' ? `${formatNumber(d.fuel_kg)} kg de combustible` : '';
    case 'takeoff':
      return [typeof d.ias_kt === 'number' ? `${d.ias_kt} kt` : '', typeof d.flaps_deg === 'number' ? `flaps ${d.flaps_deg}°` : '']
        .filter(Boolean)
        .join(' · ');
    case 'touchdown':
      return [typeof d.vs_fpm === 'number' ? formatVs(d.vs_fpm) : '', typeof d.g_force === 'number' ? `${d.g_force} G` : '']
        .filter(Boolean)
        .join(' · ');
    case 'engine_start':
    case 'engine_shutdown':
      return typeof d.running === 'number' ? `${d.running} de ${String(d.count ?? '?')} encendidos` : '';
    case 'note':
      return d.kind === 'adapter' ? `Adaptador ${String(d.adapter ?? '')}${d.sdk ? ' con SDK' : ''}` : String(d.kind ?? '');
    case 'aircraft_changed':
      return String(d.title ?? '');
    default:
      return '';
  }
}

function EventsPanel({ events, loading }: { events: FlightEvent[]; loading: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? events : events.filter((e) => e.type !== 'note');
  return (
    <Panel
      title="Bitácora del vuelo"
      actions={
        events.some((e) => e.type === 'note') ? (
          <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Ocultar notas' : 'Mostrar notas'}
          </Button>
        ) : null
      }
    >
      {loading ? (
        <Skeleton className="h-40" />
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted">Sin eventos registrados.</p>
      ) : (
        <ol className="space-y-1.5 text-sm">
          {visible.map((e) => (
            <li key={e.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
              <span className="font-mono text-muted">{new Date(e.occurred_at).toISOString().slice(11, 19)}Z</span>
              <span>
                <span className="font-medium">{eventLabels[e.type] ?? e.type}</span>
                {eventDetail(e) ? <span className="text-muted"> · {eventDetail(e)}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

// -----------------------------------------------------------------------------
// Revisión y comentarios
// -----------------------------------------------------------------------------
function CommentsPanel({ pirep, isOwner, canReview }: { pirep: PirepDetail; isOwner: boolean; canReview: boolean }) {
  const comment = useCommentPirep();
  const review = useReviewPirep();
  const [pilotText, setPilotText] = useState(pirep.pilot_comment ?? '');
  const [reviewText, setReviewText] = useState('');
  const pending = pirep.status === 'pending';

  useEffect(() => setPilotText(pirep.pilot_comment ?? ''), [pirep.pilot_comment]);

  async function saveComment() {
    try {
      await comment.mutateAsync({ id: pirep.id, comment: pilotText });
      toast.success('Comentario guardado');
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  async function decide(decision: 'accepted' | 'rejected') {
    try {
      await review.mutateAsync({ id: pirep.id, decision, comment: reviewText });
      toast.success(decision === 'accepted' ? 'PIREP aceptado: horas y ciclo sumados' : 'PIREP rechazado');
      setReviewText('');
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  return (
    <Panel title="Revisión">
      <div className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Comentario del piloto</p>
          {isOwner && pending ? (
            <div className="mt-1 space-y-2">
              <Textarea
                aria-label="Tu comentario para el revisor"
                placeholder="Explica cualquier cosa fuera de lo normal: desvío, motor y al aire, problemas del simulador…"
                maxLength={2000}
                value={pilotText}
                onChange={(e) => setPilotText(e.target.value)}
              />
              <Button size="sm" variant="secondary" onClick={saveComment} loading={comment.isPending} disabled={pilotText === (pirep.pilot_comment ?? '')}>
                Guardar comentario
              </Button>
            </div>
          ) : (
            <p className="mt-1 whitespace-pre-wrap text-[15px]">{pirep.pilot_comment || <span className="text-muted">Sin comentario</span>}</p>
          )}
        </div>

        {pirep.status !== 'pending' ? (
          <div className="border-t border-line pt-4">
            <p className="text-xs uppercase tracking-wide text-muted">Decisión</p>
            <p className="mt-1">
              <Badge tone={pirepStatusTone[pirep.status]}>{pirepStatusLabels[pirep.status]}</Badge>{' '}
              <span className="text-sm text-muted">
                {pirep.auto_approved ? 'automáticamente' : `por ${pirep.reviewer?.display_name ?? 'staff'}`}
                {pirep.reviewed_at ? ` · ${formatLocalDateTime(pirep.reviewed_at)}` : ''}
              </span>
            </p>
            {pirep.review_comment ? <p className="mt-2 whitespace-pre-wrap text-[15px]">{pirep.review_comment}</p> : null}
          </div>
        ) : canReview ? (
          <div className="space-y-2 border-t border-line pt-4">
            <p className="text-xs uppercase tracking-wide text-muted">Tu decisión</p>
            <Textarea
              aria-label="Comentario para el piloto"
              placeholder="Comentario para el piloto (obligatorio para rechazar)"
              maxLength={2000}
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => decide('accepted')} loading={review.isPending && review.variables?.decision === 'accepted'} disabled={review.isPending}>
                <Check className="size-4" aria-hidden />
                Aceptar
              </Button>
              <Button
                variant="danger"
                onClick={() => decide('rejected')}
                loading={review.isPending && review.variables?.decision === 'rejected'}
                disabled={review.isPending || reviewText.trim() === ''}
              >
                <X className="size-4" aria-hidden />
                Rechazar
              </Button>
            </div>
            <p className="text-xs text-muted">Aceptar suma {formatMinutes(pirep.block_minutes)} h de block y un ciclo a la aeronave y al piloto.</p>
          </div>
        ) : (
          <p className="border-t border-line pt-4 text-sm text-muted">Pendiente de revisión por el jefe de operaciones.</p>
        )}
      </div>
    </Panel>
  );
}

// -----------------------------------------------------------------------------
function LandingFacts({ pirep, metrics }: { pirep: PirepDetail; metrics: PirepMetrics }) {
  const td = metrics.touchdown;
  const to = metrics.takeoff;
  const rating = landingRating(pirep.landing_vs_fpm);
  const gear = td?.gear_down;
  return (
    <Panel title="Despegue y aterrizaje">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Velocidad vertical en la toma</p>
            <p className="font-mono text-3xl font-semibold">{formatVs(pirep.landing_vs_fpm)}</p>
          </div>
          {rating ? <Badge tone={rating.tone === 'neutral' ? 'neutral' : rating.tone}>{rating.label}</Badge> : null}
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Fact label="Fuerza G" mono>
            {num(metricNumber(td, 'g_force'), ' G', 2)}
          </Fact>
          <Fact label="Cabeceo" mono>
            {num(metricNumber(td, 'pitch_deg'), '°', 1)}
          </Fact>
          <Fact label="Alabeo" mono>
            {num(metricNumber(td, 'bank_deg'), '°', 1)}
          </Fact>
          <Fact label="Rebotes" mono>
            {pirep.landing_bounces ?? '—'}
          </Fact>
          <Fact label="IAS en la toma" mono>
            {num(metricNumber(td, 'ias_kt'), ' kt')}
          </Fact>
          <Fact label="Flaps al aterrizar" mono>
            {num(metricNumber(td, 'flaps_deg'), '°')}
          </Fact>
          <Fact label="Tren">{gear === true ? 'Abajo' : gear === false ? 'Arriba' : '—'}</Fact>
          <Fact label="Fuente de VS">{td?.vs_source ? String(td.vs_source).replaceAll('_', ' ') : '—'}</Fact>
          <Fact label="IAS al despegar" mono>
            {num(metricNumber(to, 'ias_kt'), ' kt')}
          </Fact>
          <Fact label="Cabeceo al despegar" mono>
            {num(metricNumber(to, 'pitch_deg'), '°', 1)}
          </Fact>
          <Fact label="Flaps al despegar" mono>
            {num(metricNumber(to, 'flaps_deg'), '°')}
          </Fact>
          <Fact label="Rodaje máx." mono>
            {metrics.max_taxi_gs_kt !== undefined ? `${metrics.max_taxi_gs_kt} kt` : '—'}
          </Fact>
        </dl>
      </div>
    </Panel>
  );
}

// -----------------------------------------------------------------------------
// Combustible
// -----------------------------------------------------------------------------
const STAGES: { key: keyof NonNullable<PirepFuel['stages']>; label: string }[] = [
  { key: 'taxi_out', label: 'Rodaje de salida' },
  { key: 'climb', label: 'Despegue y ascenso' },
  { key: 'cruise', label: 'Crucero' },
  { key: 'descent', label: 'Descenso y aproximación' },
  { key: 'taxi_in', label: 'Rodaje de llegada' },
];

function kg(value: number | undefined | null): string {
  return value === undefined || value === null ? '—' : `${formatNumber(Math.round(value))} kg`;
}

function Delta({ real, plan, lowerIsBetter }: { real: number | undefined; plan: number | undefined; lowerIsBetter: boolean }) {
  if (real === undefined || plan === undefined || plan === 0) return <span className="text-muted">—</span>;
  const diff = real - plan;
  const pct = Math.round((diff / plan) * 100);
  const good = lowerIsBetter ? diff <= 0 : diff >= 0;
  return (
    <span className={good ? 'text-ok-ink' : 'text-warn-ink'}>
      {diff > 0 ? '+' : diff < 0 ? '−' : ''}
      {formatNumber(Math.abs(Math.round(diff)))} kg ({pct > 0 ? '+' : ''}
      {pct}%)
    </span>
  );
}

function FuelPanel({ fuel }: { fuel: PirepFuel }) {
  const plan = fuel.plan;
  const stages = STAGES.filter((s) => fuel.stages?.[s.key]);
  const belowReserve = plan?.reserve_kg !== undefined && fuel.landing_kg !== undefined && fuel.landing_kg < plan.reserve_kg;
  return (
    <Panel title="Combustible" description="Niveles medidos por LAM ACARS y comparación con el plan de SimBrief.">
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Fact label="Calzos fuera" mono>
            {kg(fuel.block_off_kg)}
          </Fact>
          <Fact label="Despegue" mono>
            {kg(fuel.takeoff_kg)}
          </Fact>
          <Fact label="Aterrizaje" mono>
            <span className={belowReserve ? 'text-danger-ink' : undefined}>{kg(fuel.landing_kg)}</span>
          </Fact>
          <Fact label="Calzos puestos" mono>
            {kg(fuel.block_on_kg)}
          </Fact>
          <Fact label="Rodaje de salida" mono>
            {kg(fuel.taxi_out_kg)}
          </Fact>
          <Fact label="En viaje" mono>
            {kg(fuel.trip_kg)}
          </Fact>
          <Fact label="Rodaje de llegada" mono>
            {kg(fuel.taxi_in_kg)}
          </Fact>
          <Fact label="Total usado" mono>
            {kg(fuel.used_kg)}
          </Fact>
        </dl>

        {stages.length > 0 ? (
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Consumo por etapa</p>
            <table className="mt-1 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1 font-normal">Etapa</th>
                  <th className="py-1 text-right font-normal">Consumo</th>
                  <th className="py-1 text-right font-normal">Tiempo</th>
                  <th className="py-1 text-right font-normal">Flujo</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {stages.map((s) => {
                  const v = fuel.stages![s.key]!;
                  return (
                    <tr key={s.key} className="border-t border-line">
                      <td className="py-1.5 font-sans">{s.label}</td>
                      <td className="py-1.5 text-right">{kg(v.kg)}</td>
                      <td className="py-1.5 text-right">{formatMinutes(Math.round(v.minutes))}</td>
                      <td className="py-1.5 text-right">{v.kg_per_hour !== undefined ? `${formatNumber(v.kg_per_hour)} kg/h` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">El consumo por etapa llega con la traza del conector 0.1.16 o posterior.</p>
        )}

        {plan ? (
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Plan de SimBrief contra real</p>
            <table className="mt-1 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1 font-normal" />
                  <th className="py-1 text-right font-normal">Plan</th>
                  <th className="py-1 text-right font-normal">Real</th>
                  <th className="py-1 text-right font-normal">Diferencia</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                <tr className="border-t border-line">
                  <td className="py-1.5 font-sans">Combustible de bloque</td>
                  <td className="py-1.5 text-right">{kg(plan.block_kg)}</td>
                  <td className="py-1.5 text-right">{kg(fuel.block_off_kg)}</td>
                  <td className="py-1.5 text-right">
                    <Delta real={fuel.block_off_kg} plan={plan.block_kg} lowerIsBetter={false} />
                  </td>
                </tr>
                <tr className="border-t border-line">
                  <td className="py-1.5 font-sans">Consumo en viaje</td>
                  <td className="py-1.5 text-right">{kg(plan.trip_kg)}</td>
                  <td className="py-1.5 text-right">{kg(fuel.trip_kg)}</td>
                  <td className="py-1.5 text-right">
                    <Delta real={fuel.trip_kg} plan={plan.trip_kg} lowerIsBetter />
                  </td>
                </tr>
                <tr className="border-t border-line">
                  <td className="py-1.5 font-sans">Al aterrizar (plan aprox.)</td>
                  <td className="py-1.5 text-right">{kg(plan.landing_kg)}</td>
                  <td className="py-1.5 text-right">{kg(fuel.landing_kg)}</td>
                  <td className="py-1.5 text-right">
                    <Delta real={fuel.landing_kg} plan={plan.landing_kg} lowerIsBetter={false} />
                  </td>
                </tr>
                <tr className="border-t border-line">
                  <td className="py-1.5 font-sans">Reserva final</td>
                  <td className="py-1.5 text-right">{kg(plan.reserve_kg)}</td>
                  <td className="py-1.5 text-right" colSpan={2}>
                    {fuel.landing_kg === undefined ? (
                      <span className="text-muted">sin dato al aterrizar</span>
                    ) : belowReserve ? (
                      <span className="text-danger-ink">aterrizó bajo la reserva</span>
                    ) : (
                      <span className="text-ok-ink">por encima de la reserva</span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
            {plan.units === 'lb' ? <p className="mt-1 text-xs text-muted">El plan estaba en libras; se convirtió a kg.</p> : null}
          </div>
        ) : (
          <p className="text-sm text-muted">Sin plan de SimBrief para comparar.</p>
        )}
        {fuel.refueled_kg ? <Alert>Se detectó una carga de combustible de {kg(fuel.refueled_kg)} durante la sesión.</Alert> : null}
      </div>
    </Panel>
  );
}

function FindingsPanel({ pirep }: { pirep: PirepDetail }) {
  const findings = parseFindings(pirep.findings);
  return (
    <Panel title="Puntaje" description="100 puntos menos la penalización de cada regla de la aerolínea que se cumplió.">
      <div className="flex items-center gap-4">
        <p className="font-display text-5xl font-semibold tabular-nums">{pirep.score}</p>
        <Badge tone={scoreTone(pirep.score)}>{pirep.score >= 90 ? 'Excelente' : pirep.score >= 75 ? 'Bueno' : pirep.score >= 50 ? 'Regular' : 'Deficiente'}</Badge>
      </div>
      {findings.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Sin faltas: el vuelo cumplió todas las reglas.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-md border border-line">
          {findings.map((f) => (
            <li key={f.code} className="flex items-start justify-between gap-3 px-3 py-2">
              <div>
                <p className="flex items-center gap-1.5 font-medium">
                  {f.critical ? <TriangleAlert className="size-4 text-warn-ink" aria-label="Falta grave" /> : null}
                  {f.label}
                </p>
                {findingDetail(f) ? <p className="text-sm text-muted">{findingDetail(f)}</p> : null}
              </div>
              <span className="whitespace-nowrap font-mono text-sm tabular-nums">{f.penalty > 0 ? `−${f.penalty}` : 'info'}</span>
            </li>
          ))}
        </ul>
      )}
      {pirep.has_critical ? (
        <p className="mt-3 text-sm text-warn-ink">Tiene faltas graves: requiere revisión manual aunque la aerolínea apruebe automáticamente.</p>
      ) : null}
    </Panel>
  );
}

export function PirepDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { isOrgAdmin } = useAirlineScope();
  const pirep = usePirep(id);
  const track = usePirepTrack(pirep.data?.flight_id, pirep.data?.session_id);
  const permissions = useAirlinePermissions(pirep.data?.airline_id);

  if (pirep.isPending) return <Skeleton className="h-96" />;
  if (pirep.isError) return <Alert tone="danger">{describeError(pirep.error)}</Alert>;
  const p = pirep.data;
  if (!p) return <Alert>No encontramos este PIREP o no tienes acceso a él.</Alert>;

  const metrics = parseMetrics(p.metrics);
  const isOwner = p.user_id === user?.id;
  const canReview = permissions.canStaff && (!isOwner || isOrgAdmin);
  const airports: MapAirport[] = [];
  if (p.origin) airports.push({ icao: p.origin.icao_code, name: p.origin.name, latitude: p.origin.latitude, longitude: p.origin.longitude, role: 'origin' });
  if (p.destination)
    airports.push({ icao: p.destination.icao_code, name: p.destination.name, latitude: p.destination.latitude, longitude: p.destination.longitude, role: 'destination' });
  if (p.diverted && p.arrival)
    airports.push({ icao: p.arrival.icao_code, name: p.arrival.name, latitude: p.arrival.latitude, longitude: p.arrival.longitude, role: 'arrival' });
  const fuelOff = metrics.fuel_block_off_kg;
  const fuelOn = metrics.fuel_block_on_kg;

  return (
    <div className="space-y-6">
      <Link to="/pireps" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        PIREP
      </Link>

      <header className="flex flex-wrap items-center gap-4">
        {p.airline ? <AirlineLogo airline={p.airline} size="md" /> : null}
        <div className="min-w-0 flex-1">
          <h1 className="font-mono text-3xl font-semibold leading-tight tracking-wide">{p.callsign}</h1>
          <p className="text-muted">
            {p.airline?.name} · vuelo{' '}
            <span className="font-mono">
              {p.airline?.icao_code}
              {p.flight_number}
            </span>{' '}
            · {p.pilot?.display_name} <span className="font-mono">{p.pilot ? formatPilotNumber(p.pilot.pilot_number) : ''}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={pirepStatusTone[p.status]} className="px-2 py-1 text-sm">
            {pirepStatusLabels[p.status]}
          </Badge>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted">Puntaje</p>
            <p className="font-display text-3xl font-semibold leading-none tabular-nums">{p.score}</p>
          </div>
        </div>
      </header>

      {p.diverted ? (
        <Alert tone="danger">
          Desvío: el vuelo terminó en {p.arrival ? `${p.arrival.icao_code} (${p.arrival.city ?? p.arrival.name})` : 'un punto sin aeropuerto cercano'} en lugar
          de {p.destination?.icao_code}. La aeronave quedó donde aterrizó.
        </Alert>
      ) : null}

      <section aria-label="Resumen del vuelo" className="rounded-lg border border-line bg-surface p-4">
        <div className="flex items-center gap-3">
          <div>
            <p className="font-mono text-3xl font-semibold leading-none">{p.origin?.icao_code}</p>
            <p className="mt-1 text-sm text-muted">{p.origin?.city ?? p.origin?.name}</p>
          </div>
          <div className="flex flex-1 items-center gap-1 text-muted" aria-hidden>
            <span className="h-px flex-1 bg-line" />
            <Plane className="size-4" />
            <span className="h-px flex-1 bg-line" />
          </div>
          <div className="text-right">
            <p className="font-mono text-3xl font-semibold leading-none">{p.destination?.icao_code}</p>
            <p className="mt-1 text-sm text-muted">{p.destination?.city ?? p.destination?.name}</p>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Fact label="Block" mono>
            {formatMinutes(p.block_minutes)}
            {metrics.block_estimated ? <span className="ml-1 text-xs text-muted">(estimado)</span> : null}
          </Fact>
          <Fact label="En vuelo" mono>
            {formatMinutes(p.flight_minutes)}
          </Fact>
          <Fact label="Distancia" mono>
            {p.distance_nm !== null ? `${formatNumber(p.distance_nm)} NM` : '—'}
            {p.planned_distance_nm ? <span className="ml-1 text-xs text-muted">plan {formatNumber(p.planned_distance_nm)}</span> : null}
          </Fact>
          <Fact label="Altitud máxima" mono>
            {p.max_altitude_ft !== null ? `${formatNumber(p.max_altitude_ft)} ft` : '—'}
          </Fact>
          <Fact label="Calzos fuera" mono>
            {zulu(p.block_off_at)}
          </Fact>
          <Fact label="Despegue" mono>
            {zulu(p.takeoff_at)}
          </Fact>
          <Fact label="Aterrizaje" mono>
            {zulu(p.landing_at)}
          </Fact>
          <Fact label="Calzos puestos" mono>
            {zulu(p.block_on_at)}
          </Fact>
          <Fact label="Combustible usado" mono>
            {p.fuel_used_kg !== null ? `${formatNumber(p.fuel_used_kg)} kg` : '—'}
            {fuelOff !== undefined && fuelOn !== undefined ? (
              <span className="block text-xs text-muted">
                {formatNumber(fuelOff)} → {formatNumber(fuelOn)} kg
              </span>
            ) : null}
          </Fact>
          <Fact label="Aeronave" mono>
            {p.type?.icao_code} · {p.aircraft_registration}
          </Fact>
          <Fact label="En el simulador">
            {metrics.sim_aircraft_title ?? '—'}
            {metrics.sim_aircraft_icao ? <span className="ml-1 font-mono text-xs text-muted">{metrics.sim_aircraft_icao}</span> : null}
          </Fact>
          <Fact label="LAM ACARS" mono>
            {metrics.client_version ?? '—'}
          </Fact>
        </dl>
      </section>

      <FlightAnalysisPanel
        points={track.data?.points ?? []}
        events={track.data?.events ?? []}
        airports={airports}
        loading={track.isPending}
        reserveKg={metrics.fuel?.plan?.reserve_kg ?? null}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <LandingFacts pirep={p} metrics={metrics} />
          {metrics.fuel ? <FuelPanel fuel={metrics.fuel} /> : null}
        </div>
        <div className="space-y-6">
          <FindingsPanel pirep={p} />
          <CommentsPanel pirep={p} isOwner={isOwner} canReview={canReview} />
          <EventsPanel events={track.data?.events ?? []} loading={track.isPending} />
        </div>
      </div>
      {track.isError ? <Alert tone="danger">{describeError(track.error)}</Alert> : null}
    </div>
  );
}
