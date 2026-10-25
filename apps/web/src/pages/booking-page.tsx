import type { RouteAircraftOption } from '@lam/shared-types';
import { ArrowRight, CalendarPlus, MapPin } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/confirm-button';
import { ScopeRequired } from '@/components/scope-required';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, fieldAria } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyRow, Table, Td, Th } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { useAirlineSettings } from '@/hooks/use-airline-admin';
import {
  useAirlineActiveFlights,
  useBookFlight,
  useCancelBooking,
  useMyFlights,
  useRouteAircraftOptions,
} from '@/hooks/use-bookings';
import { useAircraftTypes } from '@/hooks/use-fleet';
import type { Airline } from '@/hooks/use-lam-data';
import { useMyRatings } from '@/hooks/use-ratings';
import { useRoutes, type RouteFilters, type RouteRow } from '@/hooks/use-routes';
import {
  CALLSIGN_PATTERN,
  blockReasonLabel,
  flightStatusLabels,
  flightStatusTone,
  formatTimeLeft,
  formatZuluDateTime,
  normalizeCallsign,
} from '@/lib/booking';
import { cn } from '@/lib/cn';
import { describeError } from '@/lib/errors';
import { aircraftStatusLabels, formatNumber, formatPilotNumber, operationTypeLabel } from '@/lib/format';
import { useAirlinePermissions } from '@/lib/permissions';
import { formatDays, formatDuration, formatUtcTime } from '@/lib/schedule';

const PAGE_SIZE = 25;

// -----------------------------------------------------------------------------
// Ventana de reserva: aeronave compatible y callsign del piloto
// -----------------------------------------------------------------------------
function AircraftOption({
  option,
  checked,
  onSelect,
}: {
  option: RouteAircraftOption;
  checked: boolean;
  onSelect: () => void;
}) {
  const reason = blockReasonLabel(option.block_reason);
  const blocked = Boolean(reason);
  const id = `ac-${option.aircraft_id}`;
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex items-center gap-3 rounded-md border px-3 py-2.5',
        blocked ? 'cursor-not-allowed border-line opacity-60' : 'cursor-pointer border-line hover:border-muted',
        checked && 'border-accent bg-accent/5',
      )}
    >
      <input
        id={id}
        type="radio"
        name="aircraft"
        className="size-4 shrink-0 accent-[var(--accent)]"
        checked={checked}
        disabled={blocked}
        onChange={onSelect}
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono font-medium">{option.registration}</span>
          <span className="font-mono text-sm text-muted">{option.type_icao}</span>
          <span className="text-sm text-muted">{option.type_model}</span>
          {option.fleet_number ? <span className="text-xs text-muted">#{option.fleet_number}</span> : null}
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
          <MapPin className="size-3" aria-hidden />
          {option.location_icao ? <span className="font-mono">{option.location_icao}</span> : 'Ubicación sin registrar'}
          <span aria-hidden>·</span>
          {aircraftStatusLabels[option.status]}
        </span>
      </span>
      {reason ? <Badge tone="warn">{reason}</Badge> : <Badge tone="ok">Disponible</Badge>}
    </label>
  );
}

function BookingDialog({ airline, route, onClose }: { airline: Airline; route: RouteRow; onClose: () => void }) {
  const navigate = useNavigate();
  const options = useRouteAircraftOptions(route.id);
  const book = useBookFlight();
  const [chosenId, setAircraftId] = useState<string | null>(null);
  const [callsign, setCallsign] = useState('');
  const [touched, setTouched] = useState(false);
  const code = airline.icao_code ?? '';

  const available = useMemo(() => (options.data ?? []).filter((o) => !o.block_reason), [options.data]);
  // Con una sola aeronave posible, queda elegida.
  const aircraftId = chosenId ?? (available.length === 1 ? (available[0]?.aircraft_id ?? null) : null);

  const normalized = normalizeCallsign(callsign);
  const callsignError = touched && !CALLSIGN_PATTERN.test(normalized) ? 'De 3 a 10 letras o números, sin espacios' : undefined;
  const callsignHint = `El que usarás en la red${airline.network !== 'OFFLINE' ? ` (${airline.network})` : ''}. Lo eliges tú en cada vuelo.`;

  async function submit() {
    setTouched(true);
    if (!aircraftId || !CALLSIGN_PATTERN.test(normalized)) return;
    try {
      await book.mutateAsync({ routeId: route.id, aircraftId, callsign: normalized });
      toast.success(`Vuelo ${normalized} reservado`);
      onClose();
      void navigate('/my-flights');
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={`Reservar ${code}${route.flight_number}`}
      description={`${route.origin?.icao_code} a ${route.destination?.icao_code} · ${formatNumber(route.distance_nm)} NM · ${formatDuration(route.estimated_minutes)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={book.isPending} disabled={!aircraftId} onClick={submit}>
            Reservar
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 rounded-md border border-line bg-bg p-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-muted">Salida</p>
            <p className="font-mono">{formatUtcTime(route.departure_time_utc) ?? 'Libre'}</p>
          </div>
          <div>
            <p className="text-muted">Días</p>
            <p>{formatDays(route.days_of_week)}</p>
          </div>
          <div>
            <p className="text-muted">Operación</p>
            <p>{operationTypeLabel(route.operation_type)}</p>
          </div>
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Aeronave</legend>
          {options.isError ? <Alert tone="danger">{describeError(options.error)}</Alert> : null}
          {options.isPending ? (
            <Skeleton className="h-32" />
          ) : options.data && options.data.length > 0 ? (
            <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {options.data.map((o) => (
                <AircraftOption key={o.aircraft_id} option={o} checked={aircraftId === o.aircraft_id} onSelect={() => setAircraftId(o.aircraft_id)} />
              ))}
            </div>
          ) : (
            <Alert>La aerolínea no tiene aeronaves registradas.</Alert>
          )}
          {options.data && options.data.length > 0 && available.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Ninguna aeronave cumple las reglas para esta ruta en este momento.</p>
          ) : null}
          {touched && !aircraftId ? <p className="mt-1 text-sm text-danger-ink">Elige una aeronave disponible</p> : null}
        </fieldset>

        <Field id="bk-callsign" label="Callsign" error={callsignError} hint={callsignHint}>
          <Input
            className="font-mono uppercase"
            maxLength={12}
            autoComplete="off"
            placeholder={`${code}${route.flight_number}`}
            value={callsign}
            onChange={(e) => setCallsign(e.target.value)}
            onBlur={() => setTouched(true)}
            {...fieldAria('bk-callsign', callsignError, callsignHint)}
          />
        </Field>

        {airline.flight_plan_remarks ? (
          <p className="text-sm text-muted">
            En el plan de vuelo agrega <span className="font-mono text-ink">RMK/{airline.flight_plan_remarks}</span>.
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Resumen de políticas y estado del piloto
// -----------------------------------------------------------------------------
function PolicyStrip({ airline, activeCount }: { airline: Airline; activeCount: number }) {
  const settings = useAirlineSettings(airline.id);
  const ratings = useMyRatings(airline.id);
  const types = useAircraftTypes();
  const s = settings.data;

  const ratingCodes = useMemo(() => {
    const byId = new Map((types.data ?? []).map((t) => [t.id, t.icao_code]));
    return (ratings.data ?? [])
      .map((r) => byId.get(r.aircraft_type_id))
      .filter((c): c is string => Boolean(c))
      .sort();
  }, [ratings.data, types.data]);

  if (settings.isPending) return <Skeleton className="h-20" />;
  if (!s) return null;

  const facts = [
    { label: 'Tus reservas activas', value: `${activeCount} de ${s.max_active_bookings}` },
    { label: 'Vencimiento', value: `${s.booking_expiry_hours} h` },
    {
      label: 'Habilitaciones',
      value: s.require_type_rating ? (ratingCodes.length > 0 ? ratingCodes.join(' ') : 'Ninguna') : 'No se exigen',
      mono: s.require_type_rating && ratingCodes.length > 0,
    },
    { label: 'Aeronave en el origen', value: s.require_aircraft_at_origin ? 'Obligatoria' : 'No se exige' },
  ];

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 divide-line rounded-lg border border-line bg-surface sm:grid-cols-4 sm:divide-x">
        {facts.map((f) => (
          <div key={f.label} className="px-4 py-3">
            <dt className="text-sm text-muted">{f.label}</dt>
            <dd className={cn('mt-0.5 text-[15px] font-medium', f.mono && 'font-mono')}>{f.value}</dd>
          </div>
        ))}
      </dl>
      {s.require_type_rating && ratings.data && ratings.data.length === 0 ? (
        <Alert>
          Todavía no tienes habilitaciones de tipo en {airline.name}. Pide al administrador o al jefe de operaciones que te habilite en las
          aeronaves que vas a volar.
        </Alert>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Rutas disponibles
// -----------------------------------------------------------------------------
function RouteSearch({ airline, canBook, atLimit }: { airline: Airline; canBook: boolean; atLimit: boolean }) {
  const types = useAircraftTypes();
  const [filters, setFilters] = useState<RouteFilters>({
    origin: '',
    destination: '',
    aircraftTypeId: null,
    status: 'active',
    page: 0,
    pageSize: PAGE_SIZE,
  });
  const [draft, setDraft] = useState({ origin: '', destination: '' });
  const [booking, setBooking] = useState<RouteRow | null>(null);
  const routes = useRoutes(airline.id, filters);
  const code = airline.icao_code ?? '';

  useEffect(() => {
    const id = window.setTimeout(
      () => setFilters((f) => ({ ...f, origin: draft.origin, destination: draft.destination, page: 0 })),
      350,
    );
    return () => window.clearTimeout(id);
  }, [draft]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:max-w-2xl sm:grid-cols-3">
        <div>
          <label htmlFor="bf-origin" className="mb-1 block text-sm text-muted">
            Origen
          </label>
          <Input
            id="bf-origin"
            className="font-mono uppercase"
            placeholder="MMMX"
            maxLength={4}
            value={draft.origin}
            onChange={(e) => setDraft((d) => ({ ...d, origin: e.target.value }))}
          />
        </div>
        <div>
          <label htmlFor="bf-destination" className="mb-1 block text-sm text-muted">
            Destino
          </label>
          <Input
            id="bf-destination"
            className="font-mono uppercase"
            placeholder="MMUN"
            maxLength={4}
            value={draft.destination}
            onChange={(e) => setDraft((d) => ({ ...d, destination: e.target.value }))}
          />
        </div>
        <div>
          <label htmlFor="bf-type" className="mb-1 block text-sm text-muted">
            Aeronave
          </label>
          <Select
            id="bf-type"
            value={filters.aircraftTypeId ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, aircraftTypeId: e.target.value ? Number(e.target.value) : null, page: 0 }))}
          >
            <option value="">Todas</option>
            {(types.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.icao_code}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {atLimit && canBook ? (
        <Alert>
          Alcanzaste el máximo de reservas activas. Vuela o cancela una en <Link to="/my-flights" className="underline">My Flights</Link> para reservar otra.
        </Alert>
      ) : null}
      {routes.isError ? <Alert tone="danger">{describeError(routes.error)}</Alert> : null}

      {routes.isPending ? (
        <Skeleton className="h-80" />
      ) : (
        <>
          <Table minWidth="60rem">
            <thead>
              <tr>
                <Th>Vuelo</Th>
                <Th>Ruta</Th>
                <Th className="text-right">Distancia</Th>
                <Th className="text-right">Duración</Th>
                <Th>Salida</Th>
                <Th>Días</Th>
                <Th>Aeronaves</Th>
                <Th className="text-right">
                  <span className="sr-only">Acción</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {routes.data?.rows.length === 0 ? (
                <EmptyRow colSpan={8}>
                  {filters.origin || filters.destination || filters.aircraftTypeId
                    ? 'Ninguna ruta activa coincide con la búsqueda.'
                    : `${airline.name} todavía no publica rutas activas.`}
                </EmptyRow>
              ) : (
                routes.data?.rows.map((r) => (
                  <tr key={r.id}>
                    <Td>
                      <p className="font-mono font-medium">
                        {code}
                        {r.flight_number}
                      </p>
                      <p className="text-xs text-muted">{operationTypeLabel(r.operation_type)}</p>
                    </Td>
                    <Td>
                      <span className="flex items-center gap-2 font-mono">
                        <span title={r.origin?.name}>{r.origin?.icao_code}</span>
                        <ArrowRight className="size-3.5 text-muted" aria-label="a" />
                        <span title={r.destination?.name}>{r.destination?.icao_code}</span>
                      </span>
                      <span className="block text-xs text-muted">
                        {r.origin?.city ?? r.origin?.name} a {r.destination?.city ?? r.destination?.name}
                      </span>
                    </Td>
                    <Td className="text-right tabular-nums">{formatNumber(r.distance_nm)} NM</Td>
                    <Td className="text-right tabular-nums">{formatDuration(r.estimated_minutes)}</Td>
                    <Td className="font-mono">{formatUtcTime(r.departure_time_utc) ?? <span className="font-sans text-muted">Libre</span>}</Td>
                    <Td>{formatDays(r.days_of_week)}</Td>
                    <Td className="font-mono text-xs">
                      {r.route_aircraft_types.length > 0
                        ? r.route_aircraft_types.map((t) => t.aircraft_types?.icao_code).filter(Boolean).join(' ')
                        : <span className="font-sans text-muted">Cualquiera</span>}
                    </Td>
                    <Td className="text-right">
                      <Button size="sm" onClick={() => setBooking(r)} disabled={!canBook || atLimit}>
                        <CalendarPlus className="size-4" aria-hidden />
                        Reservar
                      </Button>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
          <Pagination
            page={filters.page}
            pageSize={PAGE_SIZE}
            total={routes.data?.total ?? null}
            onPageChange={(page) => setFilters((f) => ({ ...f, page }))}
          />
        </>
      )}

      {booking ? <BookingDialog airline={airline} route={booking} onClose={() => setBooking(null)} /> : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Reservas de la aerolínea (staff)
// -----------------------------------------------------------------------------
function AirlineBookings({ airline }: { airline: Airline }) {
  const flights = useAirlineActiveFlights(airline.id, true);
  const cancel = useCancelBooking();

  if (flights.isError) return <Alert tone="danger">{describeError(flights.error)}</Alert>;
  if (flights.isPending) return <Skeleton className="h-48" />;

  return (
    <Table minWidth="56rem">
      <thead>
        <tr>
          <Th>Callsign</Th>
          <Th>Piloto</Th>
          <Th>Ruta</Th>
          <Th>Aeronave</Th>
          <Th>Salida</Th>
          <Th>Estado</Th>
          <Th className="text-right">Acciones</Th>
        </tr>
      </thead>
      <tbody>
        {flights.data.length === 0 ? (
          <EmptyRow colSpan={7}>No hay reservas activas en {airline.name}.</EmptyRow>
        ) : (
          flights.data.map((f) => (
            <tr key={f.id}>
              <Td>
                <p className="font-mono font-medium">{f.callsign}</p>
                <p className="font-mono text-xs text-muted">
                  {f.airline_icao}
                  {f.flight_number}
                </p>
              </Td>
              <Td>
                <p>{f.pilot?.display_name ?? 'Piloto'}</p>
                {f.pilot ? <p className="font-mono text-xs text-muted">{formatPilotNumber(f.pilot.pilot_number)}</p> : null}
              </Td>
              <Td className="font-mono">
                {f.origin?.icao_code} <ArrowRight className="inline size-3.5 text-muted" aria-label="a" /> {f.destination?.icao_code}
              </Td>
              <Td className="font-mono">
                {f.aircraft_registration} <span className="text-muted">{f.type?.icao_code}</span>
              </Td>
              <Td className="font-mono">{f.scheduled_departure_at ? formatZuluDateTime(f.scheduled_departure_at) : '—'}</Td>
              <Td>
                <Badge tone={flightStatusTone[f.status]}>{flightStatusLabels[f.status]}</Badge>
                {f.status === 'scheduled' && f.booking ? (
                  <p className="mt-1 text-xs text-muted">Vence en {formatTimeLeft(f.booking.expires_at)}</p>
                ) : null}
              </Td>
              <Td className="text-right">
                {f.status === 'scheduled' && f.booking ? (
                  <ConfirmButton
                    size="sm"
                    variant="ghost"
                    title={`Cancelar ${f.callsign}`}
                    message="La reserva se cancela y la aeronave queda disponible para otros pilotos."
                    confirmLabel="Cancelar reserva"
                    onConfirm={async () => {
                      try {
                        await cancel.mutateAsync(f.booking!.id);
                        toast.success('Reserva cancelada');
                      } catch (error) {
                        toast.error(describeError(error));
                        throw error;
                      }
                    }}
                  >
                    Cancelar
                  </ConfirmButton>
                ) : (
                  <span className="text-sm text-muted">Sin acciones</span>
                )}
              </Td>
            </tr>
          ))
        )}
      </tbody>
    </Table>
  );
}

// -----------------------------------------------------------------------------
function BookingView({ airline }: { airline: Airline }) {
  const permissions = useAirlinePermissions(airline.id);
  const settings = useAirlineSettings(airline.id);
  const upcoming = useMyFlights('upcoming', airline.id);
  const [tab, setTab] = useState<'routes' | 'airline'>('routes');

  const activeCount = (upcoming.data ?? []).filter((f) => f.booking?.status === 'active').length;
  const atLimit = settings.data ? activeCount >= settings.data.max_active_bookings : false;

  return (
    <div className="space-y-5">
      {!permissions.hasMembership ? (
        <Alert>
          {permissions.isOrgAdmin
            ? `Como superadministrador ves las rutas, pero para reservar necesitas una membresía activa en ${airline.name}.`
            : `Para reservar necesitas una membresía activa en ${airline.name}.`}
        </Alert>
      ) : (
        <PolicyStrip airline={airline} activeCount={activeCount} />
      )}

      {permissions.canStaff ? (
        <Tabs
          label="Reservas"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'routes', label: 'Rutas' },
            { value: 'airline', label: 'Reservas de la aerolínea' },
          ]}
        />
      ) : null}

      {tab === 'routes' || !permissions.canStaff ? (
        <RouteSearch airline={airline} canBook={permissions.hasMembership} atLimit={atLimit} />
      ) : (
        <AirlineBookings airline={airline} />
      )}
    </div>
  );
}

export function BookingPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Flight Booking"
        description="Elige una ruta de la aerolínea seleccionada, una aeronave compatible y tu callsign. La base de datos valida cada reserva."
      />
      <ScopeRequired>{(airline) => <BookingView airline={airline} />}</ScopeRequired>
    </div>
  );
}
