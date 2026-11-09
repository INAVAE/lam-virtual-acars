import type { RouteAircraftOption } from '@lam/shared-types';
import { OPERATION_TYPES } from '@lam/shared-types';
import { ArrowRight, CalendarPlus, CloudDownload, ExternalLink, MapPin, MapPinPlus, PlaneTakeoff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { AirportPicker } from '@/components/airport-picker';
import { ConfirmButton } from '@/components/confirm-button';
import { WeatherStrip } from '@/components/weather';
import { ScopeRequired } from '@/components/scope-required';
import { TourLegBadge, TourLegNotice } from '@/components/tour-leg-notice';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClasses } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
  useBookDirectFlight,
  useBookFlight,
  useCancelBooking,
  useDirectAircraftOptions,
  useImportOfp,
  useMyFlights,
  useRouteAircraftOptions,
} from '@/hooks/use-bookings';
import { useAircraftTypes } from '@/hooks/use-fleet';
import { useWeather } from '@/hooks/use-weather';
import { useProfile, type Airline } from '@/hooks/use-lam-data';
import { useMyRatings } from '@/hooks/use-ratings';
import { useMyTourLegs } from '@/hooks/use-tours';
import {
  useDeleteRoute,
  useRegisterRoute,
  useRouteTypeUsage,
  useRoutes,
  useRoutesBetween,
  type RouteFilters,
  type RouteRow,
} from '@/hooks/use-routes';
import { useAuth } from '@/lib/auth';
import {
  CALLSIGN_PATTERN,
  blockReasonLabel,
  flightStatusLabels,
  flightStatusTone,
  formatTimeLeft,
  normalizeCallsign,
  simbriefDispatchUrl,
} from '@/lib/booking';
import { cn } from '@/lib/cn';
import { describeError } from '@/lib/errors';
import { aircraftStatusLabels, formatNumber, formatPilotNumber, operationTypeLabel, operationTypeLabels } from '@/lib/format';
import { useAirlinePermissions } from '@/lib/permissions';
import { formatTypeUsage, isPendingRoute } from '@/lib/routes';
import { formatDays, formatDuration } from '@/lib/schedule';
import { matchingTourLegs } from '@/lib/tours';
import { DualTimeText, ScheduleTimeText } from '@/lib/time-context';
import { OfpSummary } from '@/pages/my-flights-page';

const PAGE_SIZE = 25;

// -----------------------------------------------------------------------------
// Ventana de reserva: aeronave compatible y callsign del piloto
// -----------------------------------------------------------------------------
function AircraftOption({
  option,
  checked,
  controlled,
  onSelect,
}: {
  option: RouteAircraftOption;
  checked: boolean;
  /** La aerolínea controla la disponibilidad: se muestran ubicación y estado. */
  controlled: boolean;
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
        {controlled ? (
          <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
            <MapPin className="size-3" aria-hidden />
            {option.location_icao ? <span className="font-mono">{option.location_icao}</span> : 'Ubicación sin registrar'}
            <span aria-hidden>·</span>
            {aircraftStatusLabels[option.status]}
          </span>
        ) : null}
      </span>
      {reason ? <Badge tone="warn">{reason}</Badge> : controlled ? <Badge tone="ok">Disponible</Badge> : null}
    </label>
  );
}

function BookingDialog({ airline, route, onClose }: { airline: Airline; route: RouteRow; onClose: () => void }) {
  const navigate = useNavigate();
  const options = useRouteAircraftOptions(route.id);
  const settings = useAirlineSettings(airline.id);
  const controlled = settings.data?.control_fleet_availability ?? true;
  const routeIcaos = [route.origin?.icao_code, route.destination?.icao_code].filter((c): c is string => Boolean(c));
  const weather = useWeather(routeIcaos);
  const book = useBookFlight();
  const tourLegs = matchingTourLegs(useMyTourLegs().data, route.origin?.icao_code, route.destination?.icao_code);
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
        <TourLegNotice legs={tourLegs} />
        {isPendingRoute(route) ? (
          <Alert>
            Ruta pendiente{route.registrant ? `, registrada por ${route.registrant.display_name}` : ''}. Queda activa en {airline.name} con el
            primer PIREP aceptado que llegue a {route.destination?.icao_code}.
          </Alert>
        ) : null}
        <div className="grid gap-3 rounded-md border border-line bg-bg p-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-muted">Salida</p>
            <p>{route.departure_time_utc ? <ScheduleTimeText value={route.departure_time_utc} /> : 'Libre'}</p>
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

        {routeIcaos.length > 0 ? (
          <section aria-label="Clima actual" className="space-y-2">
            <p className="text-sm font-medium">Clima actual</p>
            {routeIcaos.map((icao) => (
              <WeatherStrip key={icao} icao={icao} report={weather.data?.byIcao.get(icao)} loading={weather.isPending} />
            ))}
          </section>
        ) : null}

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Aeronave</legend>
          {options.isError ? <Alert tone="danger">{describeError(options.error)}</Alert> : null}
          {options.isPending ? (
            <Skeleton className="h-32" />
          ) : options.data && options.data.length > 0 ? (
            <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {options.data.map((o) => (
                <AircraftOption
                  key={o.aircraft_id}
                  option={o}
                  checked={aircraftId === o.aircraft_id}
                  controlled={controlled}
                  onSelect={() => setAircraftId(o.aircraft_id)}
                />
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
    {
      label: 'Flota',
      value: s.control_fleet_availability
        ? s.require_aircraft_at_origin
          ? 'Disponible y en el origen'
          : 'Solo aeronaves disponibles'
        : 'Libre',
    },
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
// Registrar ruta (piloto): nace pendiente y se activa con el primer vuelo efectivo
// -----------------------------------------------------------------------------
const FLIGHT_NUMBER_PATTERN = /^[0-9]{1,4}[A-Z]?$/;

function RegisterRouteDialog({
  airline,
  onClose,
  onRegistered,
}: {
  airline: Airline;
  onClose: () => void;
  onRegistered: (route: RouteRow) => void;
}) {
  const register = useRegisterRoute();
  const code = airline.icao_code ?? '';
  const [number, setNumber] = useState('');
  const [originId, setOriginId] = useState<number | null>(null);
  const [destinationId, setDestinationId] = useState<number | null>(null);
  const [operation, setOperation] = useState<string>(airline.operation_type === 'cargo' ? 'cargo' : 'passenger');
  const [minutes, setMinutes] = useState('');
  const [touched, setTouched] = useState(false);
  const existing = useRoutesBetween(airline.id, originId, destinationId);

  const flightNumber = number.replace(/\s+/g, '').toUpperCase();
  const minutesValue = minutes.trim() === '' ? null : Number(minutes);
  const errors = {
    number: FLIGHT_NUMBER_PATTERN.test(flightNumber) ? undefined : 'De 1 a 4 dígitos y una letra opcional, por ejemplo 2201 o 2201A',
    origin: originId === null ? 'Elige el origen' : undefined,
    destination:
      destinationId === null ? 'Elige el destino' : destinationId === originId ? 'El destino debe ser distinto del origen' : undefined,
    minutes:
      minutesValue === null || (Number.isInteger(minutesValue) && minutesValue >= 10 && minutesValue <= 1440)
        ? undefined
        : 'Entre 10 y 1440 minutos',
  };
  const valid = !errors.number && !errors.origin && !errors.destination && !errors.minutes;
  const show = (e: string | undefined) => (touched ? e : undefined);
  const numberHint = `El mismo número que usarás en SimBrief; se mostrará como ${code || 'ICAO'}${flightNumber || '2201'}.`;
  const minutesHint = 'Opcional. Vacío: se estima con la distancia (430 kt más 30 minutos).';

  async function submit() {
    setTouched(true);
    if (!valid) return;
    try {
      const route = await register.mutateAsync({
        airlineId: airline.id,
        flightNumber,
        originId: originId!,
        destinationId: destinationId!,
        operationType: operation,
        estimatedMinutes: minutesValue,
      });
      toast.success(`Ruta ${code}${route.flight_number} registrada. Queda pendiente hasta su primer vuelo aceptado.`);
      onRegistered(route);
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title="Registrar ruta"
      description={`La ruta queda pendiente y cualquier piloto la puede reservar. Se activa en ${airline.name} con el primer PIREP aceptado que llegue a su destino.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={register.isPending} onClick={submit}>
            Registrar ruta
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="rr-number" label="Número de vuelo" error={show(errors.number)} hint={numberHint}>
          <Input
            className="font-mono uppercase"
            maxLength={6}
            autoComplete="off"
            placeholder="2201"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            {...fieldAria('rr-number', show(errors.number), numberHint)}
          />
        </Field>
        <Field id="rr-operation" label="Tipo de operación">
          <Select id="rr-operation" value={operation} onChange={(e) => setOperation(e.target.value)}>
            {OPERATION_TYPES.map((o) => (
              <option key={o} value={o}>
                {operationTypeLabels[o]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="rr-origin" label="Origen" error={show(errors.origin)}>
          <AirportPicker id="rr-origin" value={originId} onChange={setOriginId} invalid={Boolean(show(errors.origin))} />
        </Field>
        <Field id="rr-destination" label="Destino" error={show(errors.destination)}>
          <AirportPicker id="rr-destination" value={destinationId} onChange={setDestinationId} invalid={Boolean(show(errors.destination))} />
        </Field>
        <Field id="rr-minutes" label="Duración estimada (minutos)" error={show(errors.minutes)} hint={minutesHint}>
          <Input
            type="number"
            inputMode="numeric"
            min={10}
            max={1440}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            {...fieldAria('rr-minutes', show(errors.minutes), minutesHint)}
          />
        </Field>
        {existing.data && existing.data.length > 0 ? (
          <div className="sm:col-span-2">
            <Alert>
              {code} ya tiene {existing.data.length === 1 ? 'una ruta' : `${existing.data.length} rutas`} entre estos aeropuertos:{' '}
              <span className="font-mono">
                {existing.data
                  .map((r) => `${code}${r.flight_number}${!r.is_active ? ' (inactiva)' : isPendingRoute(r) ? ' (pendiente)' : ''}`)
                  .join(', ')}
              </span>
              . Puedes reservarla en la lista o registrar tu propio número de vuelo.
            </Alert>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Vuelo directo: sin ruta registrada. Paso 1, la reserva; paso 2, el plan de
// SimBrief (crear e importar) sin salir de la ventana.
// -----------------------------------------------------------------------------
function DirectFlightDialog({
  airline,
  canRegisterRoute,
  onClose,
}: {
  airline: Airline;
  /** La aerolínea deja registrar rutas: se ofrece guardar la de este vuelo. */
  canRegisterRoute: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const code = airline.icao_code ?? '';
  const settings = useAirlineSettings(airline.id);
  const controlled = settings.data?.control_fleet_availability ?? true;
  const book = useBookDirectFlight();
  const myTourLegs = useMyTourLegs();
  const profile = useProfile();
  const hasSimbriefUser = Boolean(profile.data?.simbrief_username?.trim());

  const [number, setNumber] = useState('');
  const [originId, setOriginId] = useState<number | null>(null);
  const [destinationId, setDestinationId] = useState<number | null>(null);
  const [operation, setOperation] = useState<string>(airline.operation_type === 'cargo' ? 'cargo' : 'passenger');
  const [chosenId, setAircraftId] = useState<string | null>(null);
  const [callsign, setCallsign] = useState('');
  const [registerRoute, setRegisterRoute] = useState(false);
  const [touched, setTouched] = useState(false);
  const [bookedId, setBookedId] = useState<string | null>(null);

  const options = useDirectAircraftOptions(airline.id, originId);
  const existing = useRoutesBetween(airline.id, originId, destinationId);
  const available = useMemo(() => (options.data ?? []).filter((o) => !o.block_reason), [options.data]);
  const aircraftId = chosenId && available.some((o) => o.aircraft_id === chosenId) ? chosenId : available.length === 1 ? (available[0]?.aircraft_id ?? null) : null;

  const flightNumber = number.replace(/\s+/g, '').toUpperCase();
  const normalized = normalizeCallsign(callsign);
  const errors = {
    number: FLIGHT_NUMBER_PATTERN.test(flightNumber) ? undefined : 'De 1 a 4 dígitos y una letra opcional, por ejemplo 2201 o 2201A',
    origin: originId === null ? 'Elige el origen' : undefined,
    destination:
      destinationId === null ? 'Elige el destino' : destinationId === originId ? 'El destino debe ser distinto del origen' : undefined,
    aircraft: aircraftId ? undefined : 'Elige una aeronave disponible',
    callsign: CALLSIGN_PATTERN.test(normalized) ? undefined : 'De 3 a 10 letras o números, sin espacios',
  };
  const valid = Object.values(errors).every((e) => !e);
  const show = (e: string | undefined) => (touched ? e : undefined);
  const numberHint = `El mismo número que pondrás en SimBrief; se mostrará como ${code || 'ICAO'}${flightNumber || '2201'}.`;
  const callsignHint = `El que usarás en la red${airline.network !== 'OFFLINE' ? ` (${airline.network})` : ''}. Lo eliges tú en cada vuelo.`;

  // Paso 2: el vuelo reservado, con su plan si ya se importó.
  const upcoming = useMyFlights('upcoming', airline.id);
  const flight = bookedId ? (upcoming.data ?? []).find((f) => f.id === bookedId) : undefined;
  const importOfp = useImportOfp();

  async function submit() {
    setTouched(true);
    if (!valid) return;
    try {
      const result = await book.mutateAsync({
        airlineId: airline.id,
        flightNumber,
        originId: originId!,
        destinationId: destinationId!,
        aircraftId: aircraftId!,
        callsign: normalized,
        registerRoute: canRegisterRoute && registerRoute,
        operationType: operation,
      });
      toast.success(
        result.route_registered
          ? `Vuelo ${normalized} reservado y ruta ${code}${flightNumber} registrada (pendiente hasta su primer vuelo aceptado)`
          : `Vuelo directo ${normalized} reservado`,
      );
      setBookedId(result.flight_id);
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  async function runImport() {
    if (!bookedId) return;
    try {
      await importOfp.mutateAsync(bookedId);
      toast.success('Plan de SimBrief importado');
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  if (bookedId) {
    const ofp = flight?.ofp ?? null;
    const dispatchUrl = flight
      ? simbriefDispatchUrl({
          airlineIcao: flight.airline_icao,
          flightNumber: flight.flight_number,
          callsign: flight.callsign,
          aircraftIcao: flight.type?.icao_code ?? '',
          registration: flight.aircraft_registration,
          origin: flight.origin?.icao_code ?? '',
          destination: flight.destination?.icao_code ?? '',
          remarks: flight.flight_plan_remarks,
          departure: flight.scheduled_departure_at,
        })
      : null;
    return (
      <Dialog
        open
        size="lg"
        onClose={onClose}
        title={`Plan de vuelo de ${normalized}`}
        description="Reserva hecha. Crea el plan en SimBrief con los datos del vuelo e impórtalo aquí para dejarlo listo para LAM ACARS."
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Cerrar
            </Button>
            <Button
              onClick={() => {
                onClose();
                void navigate('/my-flights');
              }}
            >
              Ir a My Flights
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {!flight ? <Skeleton className="h-24" /> : null}
          {flight ? (
            <ol className="space-y-4">
              <li className="space-y-2">
                <p className="text-sm font-medium">1. Genera el plan en SimBrief</p>
                <p className="text-sm text-muted">
                  Se abre SimBrief Dispatch con aerolínea, número de vuelo, callsign, aeronave, matrícula, origen y destino ya puestos.
                </p>
                {dispatchUrl ? (
                  <a href={dispatchUrl} target="_blank" rel="noreferrer noopener" className={buttonClasses('secondary', 'sm')}>
                    <ExternalLink className="size-4" aria-hidden />
                    Crear en SimBrief
                  </a>
                ) : null}
              </li>
              <li className="space-y-2">
                <p className="text-sm font-medium">2. Impórtalo para terminar la reserva</p>
                {!hasSimbriefUser ? (
                  <Alert>
                    Para importar tu plan, guarda tu usuario de SimBrief en <Link to="/settings" className="underline">Settings</Link>.
                  </Alert>
                ) : null}
                <Button size="sm" onClick={runImport} loading={importOfp.isPending} disabled={!hasSimbriefUser}>
                  <CloudDownload className="size-4" aria-hidden />
                  {ofp ? 'Volver a importar' : 'Importar de SimBrief'}
                </Button>
                {ofp ? <OfpSummary ofp={ofp} /> : null}
                {ofp ? <p className="text-sm font-medium text-ok-ink">Listo para iniciar en LAM ACARS.</p> : null}
              </li>
            </ol>
          ) : null}
          <p className="text-sm text-muted">
            Si lo dejas para después, el vuelo queda en My Flights con los mismos botones. La reserva vence si no inicias el vuelo a tiempo.
          </p>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title="Reservar un nuevo vuelo directo"
      description={`Elige origen, destino y número de vuelo sin buscar una ruta de ${airline.name}. Después generas el plan en SimBrief y lo importas.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={book.isPending} onClick={submit}>
            Reservar vuelo directo
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="df-origin" label="Origen" error={show(errors.origin)}>
            <AirportPicker id="df-origin" value={originId} onChange={setOriginId} invalid={Boolean(show(errors.origin))} />
          </Field>
          <Field id="df-destination" label="Destino" error={show(errors.destination)}>
            <AirportPicker id="df-destination" value={destinationId} onChange={setDestinationId} invalid={Boolean(show(errors.destination))} />
          </Field>
          <TourLegNotice legs={matchingTourLegs(myTourLegs.data, originId, destinationId)} className="sm:col-span-2" />
          <Field id="df-number" label="Número de vuelo" error={show(errors.number)} hint={numberHint}>
            <Input
              className="font-mono uppercase"
              maxLength={6}
              autoComplete="off"
              placeholder="2201"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              {...fieldAria('df-number', show(errors.number), numberHint)}
            />
          </Field>
          <Field id="df-operation" label="Tipo de operación">
            <Select id="df-operation" value={operation} onChange={(e) => setOperation(e.target.value)}>
              {OPERATION_TYPES.map((o) => (
                <option key={o} value={o}>
                  {operationTypeLabels[o]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {existing.data && existing.data.length > 0 ? (
          <Alert>
            {code} ya tiene {existing.data.length === 1 ? 'una ruta' : `${existing.data.length} rutas`} entre estos aeropuertos:{' '}
            <span className="font-mono">{existing.data.map((r) => `${code}${r.flight_number}`).join(', ')}</span>. Puedes reservarla en la lista o
            seguir con tu vuelo directo.
          </Alert>
        ) : null}

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Aeronave</legend>
          {options.isError ? <Alert tone="danger">{describeError(options.error)}</Alert> : null}
          {options.isPending ? (
            <Skeleton className="h-32" />
          ) : options.data && options.data.length > 0 ? (
            <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
              {options.data.map((o) => (
                <AircraftOption
                  key={o.aircraft_id}
                  option={o}
                  checked={aircraftId === o.aircraft_id}
                  controlled={controlled}
                  onSelect={() => setAircraftId(o.aircraft_id)}
                />
              ))}
            </div>
          ) : (
            <Alert>La aerolínea no tiene aeronaves registradas.</Alert>
          )}
          {show(errors.aircraft) && options.data && options.data.length > 0 ? (
            <p className="mt-1 text-sm text-danger-ink">{errors.aircraft}</p>
          ) : null}
        </fieldset>

        <Field id="df-callsign" label="Callsign" error={show(errors.callsign)} hint={callsignHint}>
          <Input
            className="font-mono uppercase"
            maxLength={12}
            autoComplete="off"
            placeholder={`${code}${flightNumber || '2201'}`}
            value={callsign}
            onChange={(e) => setCallsign(e.target.value)}
            {...fieldAria('df-callsign', show(errors.callsign), callsignHint)}
          />
        </Field>

        {canRegisterRoute ? (
          <Checkbox
            id="df-register"
            label="Registrar la ruta de este vuelo"
            hint={`Se agrega a las rutas de ${airline.name} como pendiente para que cualquier piloto la reserve después; se activa con el primer PIREP aceptado que llegue al destino. Sin marcar, el vuelo se hace solo esta vez.`}
            checked={registerRoute}
            onChange={(e) => setRegisterRoute(e.target.checked)}
          />
        ) : null}

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
// Rutas disponibles
// -----------------------------------------------------------------------------
function RouteSearch({ airline, canBook, atLimit }: { airline: Airline; canBook: boolean; atLimit: boolean }) {
  const types = useAircraftTypes();
  const settings = useAirlineSettings(airline.id);
  const usage = useRouteTypeUsage(airline.id);
  const remove = useDeleteRoute();
  const myTourLegs = useMyTourLegs();
  const { user } = useAuth();
  const [registering, setRegistering] = useState(false);
  const [directing, setDirecting] = useState(false);
  const { canManage } = useAirlinePermissions(airline.id);
  const canRegister = canBook && (settings.data?.pilots_register_routes ?? false);
  const canDirect = canBook && ((settings.data?.allow_direct_flights ?? false) || canManage);
  const [filters, setFilters] = useState<RouteFilters>({
    origin: '',
    destination: '',
    aircraftTypeId: null,
    status: 'bookable',
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid flex-1 grid-cols-2 gap-2 sm:max-w-3xl sm:grid-cols-4">
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
          <div>
            <label htmlFor="bf-status" className="mb-1 block text-sm text-muted">
              Estado
            </label>
            <Select
              id="bf-status"
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as RouteFilters['status'], page: 0 }))}
            >
              <option value="bookable">Todas</option>
              <option value="active">Activas</option>
              <option value="pending">Pendientes</option>
            </Select>
          </div>
        </div>
        {canRegister || canDirect ? (
          <div className="flex flex-wrap gap-2">
            {canRegister ? (
              <Button variant="secondary" onClick={() => setRegistering(true)}>
                <MapPinPlus className="size-4" aria-hidden />
                Registrar ruta
              </Button>
            ) : null}
            {canDirect ? (
              <Button variant="secondary" disabled={atLimit} title={atLimit ? 'Alcanzaste el máximo de reservas activas' : undefined} onClick={() => setDirecting(true)}>
                <PlaneTakeoff className="size-4" aria-hidden />
                Reservar un nuevo vuelo directo
              </Button>
            ) : null}
          </div>
        ) : null}
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
                  {filters.origin || filters.destination || filters.aircraftTypeId || filters.status !== 'bookable'
                    ? 'Ninguna ruta coincide con la búsqueda.'
                    : canRegister
                      ? `${airline.name} todavía no tiene rutas. Registra la que quieras volar.`
                      : `${airline.name} todavía no publica rutas activas.`}
                </EmptyRow>
              ) : (
                routes.data?.rows.map((r) => {
                  const pending = isPendingRoute(r);
                  const flown = formatTypeUsage(usage.data?.get(r.id));
                  return (
                  <tr key={r.id}>
                    <Td>
                      <p className="flex flex-wrap items-center gap-1.5 font-mono font-medium">
                        {code}
                        {r.flight_number}
                        {pending ? <Badge tone="info">Pendiente</Badge> : null}
                      </p>
                      <TourLegBadge legs={matchingTourLegs(myTourLegs.data, r.origin?.icao_code, r.destination?.icao_code)} />
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
                    <Td className="whitespace-nowrap">{r.departure_time_utc ? <ScheduleTimeText value={r.departure_time_utc} inline={false} /> : <span className="text-muted">Libre</span>}</Td>
                    <Td>{formatDays(r.days_of_week)}</Td>
                    <Td className="text-xs">
                      <p className="font-mono">
                        {r.route_aircraft_types.length > 0
                          ? r.route_aircraft_types.map((t) => t.aircraft_types?.icao_code).filter(Boolean).join(' ')
                          : <span className="font-sans text-muted">Cualquiera</span>}
                      </p>
                      {flown ? (
                        <p className="mt-0.5 text-muted">
                          Volada con <span className="font-mono text-ink">{flown}</span>
                        </p>
                      ) : null}
                    </Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {pending && r.registered_by === user?.id ? (
                          <ConfirmButton
                            size="sm"
                            variant="ghost"
                            title={`Quitar ${code}${r.flight_number}`}
                            message="La ruta pendiente que registraste deja de existir. Solo se puede quitar mientras no tenga reservas activas."
                            confirmLabel="Quitar ruta"
                            onConfirm={async () => {
                              try {
                                await remove.mutateAsync({ id: r.id, airlineId: airline.id });
                                toast.success('Ruta quitada');
                              } catch (error) {
                                toast.error(describeError(error));
                                throw error;
                              }
                            }}
                          >
                            Quitar
                          </ConfirmButton>
                        ) : null}
                        <Button size="sm" onClick={() => setBooking(r)} disabled={!canBook || atLimit}>
                          <CalendarPlus className="size-4" aria-hidden />
                          Reservar
                        </Button>
                      </div>
                    </Td>
                  </tr>
                  );
                })
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
      {directing ? (
        <DirectFlightDialog
          airline={airline}
          canRegisterRoute={canRegister}
          onClose={() => setDirecting(false)}
        />
      ) : null}
      {registering ? (
        <RegisterRouteDialog
          airline={airline}
          onClose={() => setRegistering(false)}
          onRegistered={(route) => {
            setRegistering(false);
            if (!atLimit) setBooking(route);
          }}
        />
      ) : null}
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
              <Td className="whitespace-nowrap">{f.scheduled_departure_at ? <DualTimeText value={f.scheduled_departure_at} withDate /> : '—'}</Td>
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
