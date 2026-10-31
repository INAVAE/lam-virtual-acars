import { ArrowRight, CalendarPlus, CloudDownload, ExternalLink, FileText, Plane } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { AirlineLogo } from '@/components/airline-logo';
import { ConfirmButton } from '@/components/confirm-button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClasses } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyRow, Table, Td, Th } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { useCancelBooking, useImportOfp, useMyFlights, type FlightView, type MyFlight } from '@/hooks/use-bookings';
import { useProfile } from '@/hooks/use-lam-data';
import { useAirlineScope } from '@/lib/airline-scope';
import {
  bookingStatusLabels,
  flightStatusLabels,
  flightStatusTone,
  formatTimeLeft,
  mismatchLabels,
  parseMismatches,
  simbriefDispatchUrl,
} from '@/lib/booking';
import { describeError } from '@/lib/errors';
import { formatLocalDateTime, formatNumber, operationTypeLabel } from '@/lib/format';
import { phaseLabel } from '@/lib/phases';
import { DualTimeText } from '@/lib/time-context';
import { pirepStatusLabels, pirepStatusTone } from '@/lib/pirep';
import { formatDuration } from '@/lib/schedule';

type Ofp = NonNullable<MyFlight['ofp']>;

function Fact({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className={mono ? 'mt-0.5 font-mono text-[15px]' : 'mt-0.5 text-[15px]'}>{children}</dd>
    </div>
  );
}

function fuel(value: number | null, units: string | null): string {
  if (value === null) return '—';
  return `${formatNumber(Math.round(value))} ${units === 'lb' ? 'lb' : 'kg'}`;
}

// -----------------------------------------------------------------------------
// Plan de SimBrief
// -----------------------------------------------------------------------------
function OfpSummary({ ofp }: { ofp: Ofp }) {
  const mismatches = parseMismatches(ofp.mismatches);
  const high = mismatches.filter((m) => m.severity === 'high');
  const low = mismatches.filter((m) => m.severity === 'low');

  return (
    <div className="space-y-3">
      {high.length > 0 ? (
        <Alert tone="danger">
          <p className="font-medium">El plan no coincide con la reserva</p>
          <ul className="mt-1 space-y-0.5">
            {high.map((m) => (
              <li key={m.field}>
                {mismatchLabels[m.field]}: reservado <span className="font-mono">{m.expected ?? '—'}</span>, en SimBrief{' '}
                <span className="font-mono">{m.actual ?? '—'}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-muted">Genera de nuevo el plan en SimBrief con los datos de la reserva e impórtalo otra vez.</p>
        </Alert>
      ) : null}
      {low.length > 0 ? (
        <Alert>
          <ul className="space-y-0.5">
            {low.map((m) => (
              <li key={m.field}>
                {mismatchLabels[m.field]}: esperado <span className="font-mono">{m.expected ?? '—'}</span>, en SimBrief{' '}
                <span className="font-mono">{m.actual ?? '—'}</span>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {mismatches.length === 0 ? <Alert tone="ok">El plan de SimBrief coincide con la reserva.</Alert> : null}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Fact label="Nivel inicial" mono>
          {ofp.cruise_altitude_ft ? `FL${String(Math.round(ofp.cruise_altitude_ft / 100)).padStart(3, '0')}` : '—'}
        </Fact>
        <Fact label="Tiempo en ruta">{ofp.est_enroute_minutes !== null ? formatDuration(ofp.est_enroute_minutes) : '—'}</Fact>
        <Fact label="Combustible de bloque" mono>
          {fuel(ofp.block_fuel, ofp.fuel_units)}
        </Fact>
        <Fact label="Alterno" mono>
          {ofp.alternate_icao ?? '—'}
        </Fact>
        <Fact label="ZFW" mono>
          {fuel(ofp.zfw, ofp.fuel_units)}
        </Fact>
        <Fact label="TOW" mono>
          {fuel(ofp.tow, ofp.fuel_units)}
        </Fact>
        <Fact label="Pasajeros" mono>
          {ofp.pax_count ?? '—'}
        </Fact>
        <Fact label="Importado">{formatLocalDateTime(ofp.fetched_at)}</Fact>
      </dl>
      {ofp.route ? (
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Ruta</p>
          <p className="mt-0.5 break-words rounded-md border border-line bg-bg px-3 py-2 font-mono text-sm">{ofp.route}</p>
        </div>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Estado ACARS de un vuelo en curso
// -----------------------------------------------------------------------------
const SIGNAL_LOST_MS = 2 * 60_000;

function AcarsStatus({ flight }: { flight: MyFlight }) {
  const session = flight.session;
  const live = flight.live;
  if (!session) return null;
  const lastContact = new Date(session.last_contact_at).getTime();
  const lost = Date.now() - lastContact > SIGNAL_LOST_MS;

  return (
    <section aria-label="ACARS" className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line bg-bg/60 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className={lost ? 'size-2.5 rounded-full bg-warn' : 'size-2.5 animate-pulse rounded-full bg-ok'} aria-hidden />
        <span className="font-medium">{lost ? 'Sin señal de ACARS' : 'ACARS en línea'}</span>
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <div>
          <dt className="inline text-muted">Fase </dt>
          <dd className="inline font-medium">{phaseLabel(session.phase)}</dd>
        </div>
        {live ? (
          <>
            <div>
              <dt className="inline text-muted">Altitud </dt>
              <dd className="inline font-mono">{formatNumber(live.altitude_ft)} ft</dd>
            </div>
            <div>
              <dt className="inline text-muted">GS </dt>
              <dd className="inline font-mono">{live.gs_kt ?? '—'} kt</dd>
            </div>
          </>
        ) : null}
        <div>
          <dt className="inline text-muted">Último contacto </dt>
          <dd className="inline">{formatLocalDateTime(session.last_contact_at)}</dd>
        </div>
      </dl>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Tarjeta de un vuelo reservado
// -----------------------------------------------------------------------------
function UpcomingFlight({ flight, hasSimbriefUser }: { flight: MyFlight; hasSimbriefUser: boolean }) {
  const cancel = useCancelBooking();
  const importOfp = useImportOfp();
  const scheduled = flight.status === 'scheduled';
  const booking = flight.booking;
  const ofp = flight.ofp;
  const origin = flight.origin?.icao_code ?? '';
  const destination = flight.destination?.icao_code ?? '';

  const dispatchUrl = simbriefDispatchUrl({
    airlineIcao: flight.airline_icao,
    flightNumber: flight.flight_number,
    callsign: flight.callsign,
    aircraftIcao: flight.type?.icao_code ?? '',
    registration: flight.aircraft_registration,
    origin,
    destination,
    remarks: flight.flight_plan_remarks,
    departure: flight.scheduled_departure_at,
  });

  async function runImport() {
    try {
      await importOfp.mutateAsync(flight.id);
      toast.success('Plan de SimBrief importado');
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  return (
    <article aria-labelledby={`flight-${flight.id}`} className="rounded-lg border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        {flight.airline ? <AirlineLogo airline={{ ...flight.airline, icao_code: flight.airline_icao }} size="sm" /> : null}
        <div className="min-w-0 flex-1">
          <h2 id={`flight-${flight.id}`} className="font-mono text-xl font-semibold leading-tight tracking-wide">
            {flight.callsign}
          </h2>
          <p className="text-sm text-muted">
            {flight.airline?.name} · vuelo{' '}
            <span className="font-mono">
              {flight.airline_icao}
              {flight.flight_number}
            </span>{' '}
            · {operationTypeLabel(flight.operation_type)}
          </p>
        </div>
        <div className="text-right">
          <Badge tone={flightStatusTone[flight.status]}>{flightStatusLabels[flight.status]}</Badge>
          {scheduled && booking ? <p className="mt-1 text-xs text-muted">Vence en {formatTimeLeft(booking.expires_at)}</p> : null}
        </div>
      </header>

      <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div>
              <p className="font-mono text-3xl font-semibold leading-none">{origin}</p>
              <p className="mt-1 text-sm text-muted">{flight.origin?.city ?? flight.origin?.name}</p>
            </div>
            <div className="flex flex-1 items-center gap-1 text-muted" aria-hidden>
              <span className="h-px flex-1 bg-line" />
              <Plane className="size-4" />
              <span className="h-px flex-1 bg-line" />
            </div>
            <div className="text-right">
              <p className="font-mono text-3xl font-semibold leading-none">{destination}</p>
              <p className="mt-1 text-sm text-muted">{flight.destination?.city ?? flight.destination?.name}</p>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact label="Aeronave" mono>
              {flight.type?.icao_code} · {flight.aircraft_registration}
            </Fact>
            <Fact label="Salida programada" mono>
              {flight.scheduled_departure_at ? <DualTimeText value={flight.scheduled_departure_at} withDate /> : 'Libre'}
            </Fact>
            <Fact label="Distancia">{formatNumber(flight.planned_distance_nm)} NM</Fact>
            <Fact label="Duración estimada">{formatDuration(flight.planned_minutes)}</Fact>
            <Fact label="Red">{flight.network === 'OFFLINE' ? 'Fuera de línea' : flight.network}</Fact>
            <Fact label="Observaciones" mono>
              {flight.flight_plan_remarks ? `RMK/${flight.flight_plan_remarks}` : '—'}
            </Fact>
          </dl>
        </div>

        <section aria-label="Plan de vuelo de SimBrief" className="space-y-3 lg:border-l lg:border-line lg:pl-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-base font-semibold">Plan de vuelo (SimBrief)</h3>
            {ofp?.pdf_url ? (
              <a href={ofp.pdf_url} target="_blank" rel="noreferrer noopener" className={buttonClasses('ghost', 'sm')}>
                <FileText className="size-4" aria-hidden />
                OFP en PDF
              </a>
            ) : null}
          </div>
          {!hasSimbriefUser ? (
            <Alert>
              Para importar tu plan, guarda tu usuario de SimBrief en <Link to="/settings" className="underline">Settings</Link>.
            </Alert>
          ) : null}
          {ofp ? (
            <OfpSummary ofp={ofp} />
          ) : (
            <p className="text-sm text-muted">
              Aún no importas un plan para este vuelo. Créalo en SimBrief con los datos de la reserva y luego impórtalo aquí: se compara con
              origen, destino, tipo, matrícula y callsign.
            </p>
          )}
          {scheduled ? (
            <div className="flex flex-wrap gap-2 pt-1">
              <a href={dispatchUrl} target="_blank" rel="noreferrer noopener" className={buttonClasses('secondary', 'sm')}>
                <ExternalLink className="size-4" aria-hidden />
                Crear en SimBrief
              </a>
              <Button size="sm" onClick={runImport} loading={importOfp.isPending} disabled={!hasSimbriefUser}>
                <CloudDownload className="size-4" aria-hidden />
                {ofp ? 'Volver a importar' : 'Importar de SimBrief'}
              </Button>
            </div>
          ) : null}
        </section>
      </div>

      {flight.status === 'in_progress' ? <AcarsStatus flight={flight} /> : null}

      {scheduled && booking ? (
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5">
          <p className="text-sm text-muted">
            Reservado el {formatLocalDateTime(flight.created_at)} ·{' '}
            {ofp ? 'Listo para iniciar en LAM ACARS' : 'Importa el plan de SimBrief para poder iniciar en LAM ACARS'}
          </p>
          <ConfirmButton
            size="sm"
            variant="ghost"
            title={`Cancelar ${flight.callsign}`}
            message="La reserva se cancela y la aeronave queda libre para otros pilotos."
            confirmLabel="Cancelar reserva"
            onConfirm={async () => {
              try {
                await cancel.mutateAsync(booking.id);
                toast.success('Reserva cancelada');
              } catch (error) {
                toast.error(describeError(error));
                throw error;
              }
            }}
          >
            Cancelar reserva
          </ConfirmButton>
        </footer>
      ) : null}
    </article>
  );
}

// -----------------------------------------------------------------------------
function History({ flights }: { flights: MyFlight[] }) {
  return (
    <Table minWidth="60rem">
      <thead>
        <tr>
          <Th>Fecha</Th>
          <Th>Callsign</Th>
          <Th>Ruta</Th>
          <Th>Aeronave</Th>
          <Th className="text-right">Distancia</Th>
          <Th>Estado</Th>
          <Th>PIREP</Th>
        </tr>
      </thead>
      <tbody>
        {flights.length === 0 ? (
          <EmptyRow colSpan={7}>Aún no hay vuelos cerrados. Aquí aparecerán los completados y las reservas canceladas o vencidas.</EmptyRow>
        ) : (
          flights.map((f) => (
            <tr key={f.id}>
              <Td className="whitespace-nowrap">{formatLocalDateTime(f.completed_at ?? f.cancelled_at ?? f.created_at)}</Td>
              <Td>
                <p className="font-mono font-medium">{f.callsign}</p>
                <p className="text-xs text-muted">{f.airline?.name}</p>
              </Td>
              <Td className="font-mono">
                {f.origin?.icao_code} <ArrowRight className="inline size-3.5 text-muted" aria-label="a" /> {f.destination?.icao_code}
              </Td>
              <Td className="font-mono">
                {f.aircraft_registration} <span className="text-muted">{f.type?.icao_code}</span>
              </Td>
              <Td className="text-right tabular-nums">{formatNumber(f.planned_distance_nm)} NM</Td>
              <Td>
                {f.status === 'cancelled' && f.booking?.status === 'expired' ? (
                  <Badge tone="warn">{bookingStatusLabels.expired}</Badge>
                ) : (
                  <Badge tone={flightStatusTone[f.status]}>{flightStatusLabels[f.status]}</Badge>
                )}
              </Td>
              <Td>
                {f.pirep ? (
                  <Link to={`/pireps/${f.pirep.id}`} className="inline-flex items-center gap-1.5 underline-offset-2 hover:underline">
                    <span className="font-mono tabular-nums">{f.pirep.score}</span>
                    <Badge tone={pirepStatusTone[f.pirep.status]}>{pirepStatusLabels[f.pirep.status]}</Badge>
                  </Link>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </Td>
            </tr>
          ))
        )}
      </tbody>
    </Table>
  );
}

export function MyFlightsPage() {
  const { selected } = useAirlineScope();
  const profile = useProfile();
  const [view, setView] = useState<FlightView>('upcoming');
  const flights = useMyFlights(view, selected?.id ?? null);
  const hasSimbriefUser = Boolean(profile.data?.simbrief_username?.trim());

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Flights"
        description={
          selected
            ? `Tus reservas y vuelos en ${selected.name}. Elige la vista consolidada para ver los de todas tus aerolíneas.`
            : 'Tus reservas y vuelos en todas tus aerolíneas.'
        }
      />
      <Tabs
        label="Mis vuelos"
        value={view}
        onChange={setView}
        items={[
          { value: 'upcoming', label: 'Próximos' },
          { value: 'history', label: 'Historial' },
        ]}
      />

      {flights.isError ? <Alert tone="danger">{describeError(flights.error)}</Alert> : null}
      {flights.isPending ? (
        <Skeleton className="h-72" />
      ) : view === 'upcoming' ? (
        flights.data && flights.data.length > 0 ? (
          <div className="space-y-4">
            {flights.data.map((f) => (
              <UpcomingFlight key={f.id} flight={f} hasSimbriefUser={hasSimbriefUser} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-line px-6 py-12 text-center">
            <p className="font-display text-lg font-semibold">Sin vuelos reservados</p>
            <p className="mx-auto mt-1 max-w-md text-muted">Reserva una ruta de tu aerolínea para preparar el plan de vuelo.</p>
            <Link to="/booking" className={buttonClasses('primary', 'md', 'mt-4')}>
              <CalendarPlus className="size-4" aria-hidden />
              Reservar un vuelo
            </Link>
          </div>
        )
      ) : (
        <History flights={flights.data ?? []} />
      )}
    </div>
  );
}
