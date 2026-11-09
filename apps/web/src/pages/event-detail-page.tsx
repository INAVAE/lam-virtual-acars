import { ArrowLeft, Check, Medal, Pencil, Send, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { AirlineLogo } from '@/components/airline-logo';
import { AirportPicker } from '@/components/airport-picker';
import { ConfirmButton } from '@/components/confirm-button';
import { EventMap } from '@/components/event-map';
import { RejectDialog } from '@/components/reject-dialog';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClasses } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, Td, Th } from '@/components/ui/table';
import { useAirlineSettings } from '@/hooks/use-airline-admin';
import {
  useBookEventFlight,
  useCancelEvent,
  useEvent,
  useRegisterEvent,
  useReviewEvent,
  useReviewRegistration,
  useSubmitEvent,
  useWithdrawRegistration,
} from '@/hooks/use-events';
import { useFleet } from '@/hooks/use-fleet';
import { useAirlines, useMyMemberships } from '@/hooks/use-lam-data';
import { useNow } from '@/hooks/use-now';
import { CALLSIGN_PATTERN, normalizeCallsign } from '@/lib/booking';
import { cn } from '@/lib/cn';
import { describeError } from '@/lib/errors';
import {
  BOOKING_OPENS_HOURS,
  bookingOpen,
  criterionLabels,
  criterionValue,
  eventMinutes,
  eventStatusLabels,
  eventStatusTone,
  eventTiming,
  pilotChooses,
  registrationStatusLabels,
  routeText,
  scenarioHints,
  scenarioLabels,
  timingText,
  type EventDetail,
} from '@/lib/events';
import { formatPilotNumber } from '@/lib/format';
import { formatMinutes } from '@/lib/pirep';
import { useTheme } from '@/lib/theme';
import { useTimePrefs } from '@/lib/time-context';
import { enrollmentStatusTone, FLIGHT_NUMBER_PATTERN } from '@/lib/tours';
import { BadgeArt } from '@/components/badge-art';
import { InviteLinkButton } from '@/components/invite-link';
import { podiumMetal } from '@/lib/badge-art';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function BookEventDialog({ event, onClose }: { event: EventDetail; onClose: () => void }) {
  const reg = event.my_registration!;
  const fleet = useFleet(reg.airline_id);
  const settings = useAirlineSettings(reg.airline_id);
  // Con la flota libre, cualquier aeronave de la aerolínea sirve.
  const controlled = settings.data?.control_fleet_availability ?? true;
  const book = useBookEventFlight();
  const chooses = pilotChooses(event.scenario);
  const [aircraftId, setAircraftId] = useState('');
  const [callsign, setCallsign] = useState('');
  const [flightNumber, setFlightNumber] = useState('');
  const [airport, setAirport] = useState<number | null>(reg.proposed_airport_id);
  const [tried, setTried] = useState(false);
  const options = useMemo(
    () => (fleet.data ?? []).filter(
        (a) => (!controlled || a.status === 'available') && (event.aircraft_type_ids.length === 0 || event.aircraft_type_ids.includes(a.aircraft_type_id)),
      ),
    [fleet.data, event.aircraft_type_ids, controlled],
  );
  const cs = normalizeCallsign(callsign);
  const fn = flightNumber.trim().toUpperCase();
  const fixed = chooses === 'origin' ? event.destination : event.origin;
  const airportError = tried && chooses && (!airport || airport === fixed?.id) ? 'Elige un aeropuerto distinto al del evento' : undefined;

  async function submit() {
    setTried(true);
    if (!aircraftId || !CALLSIGN_PATTERN.test(cs) || !FLIGHT_NUMBER_PATTERN.test(fn) || (chooses && (!airport || airport === fixed?.id))) return;
    try {
      await book.mutateAsync({
        registrationId: reg.id,
        aircraftId,
        callsign: cs,
        flightNumber: fn,
        originId: chooses === 'origin' ? airport : null,
        destinationId: chooses === 'destination' ? airport : null,
      });
      toast.success('Vuelo del evento reservado. Lo encuentras en My Flights para despachar e iniciar con LAM ACARS.');
      onClose();
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Reservar vuelo de ${event.folio}`}
      description={`${routeText(event)}. El PIREP cuenta como un vuelo normal de tu aerolínea y entra al ranking si el vuelo empieza dentro del horario del evento.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={book.isPending} onClick={() => void submit()}>
            Reservar vuelo
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {chooses ? (
          <div className="sm:col-span-2">
            <Field id="ev-airport" label={chooses === 'origin' ? 'Tu origen' : 'Tu destino'} error={airportError}>
              <AirportPicker id="ev-airport" value={airport} onChange={setAirport} invalid={Boolean(airportError)} />
            </Field>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <Field id="ev-aircraft" label="Aeronave" error={tried && !aircraftId ? 'Elige una aeronave' : undefined} hint={event.aircraft_types.length > 0 ? `Tipos del evento: ${event.aircraft_types.join(', ')}` : undefined}>
            {fleet.isPending ? (
              <Skeleton className="h-10" />
            ) : options.length === 0 ? (
              <Alert tone="info">No hay aeronaves disponibles de los tipos del evento en tu aerolínea.</Alert>
            ) : (
              <Select id="ev-aircraft" value={aircraftId} onChange={(e) => setAircraftId(e.target.value)}>
                <option value="">Elige una aeronave</option>
                {options.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.registration} · {a.type?.icao_code ?? ''} {a.current?.icao_code ? `· en ${a.current.icao_code}` : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field id="ev-callsign" label="Callsign" error={tried && !CALLSIGN_PATTERN.test(cs) ? 'De 3 a 10 letras o números, sin espacios' : undefined}>
          <Input id="ev-callsign" className="font-mono uppercase" value={callsign} onChange={(e) => setCallsign(e.target.value)} autoComplete="off" />
        </Field>
        <Field id="ev-number" label="Número de vuelo" error={tried && !FLIGHT_NUMBER_PATTERN.test(fn) ? 'De 1 a 4 dígitos y, opcional, una letra' : undefined}>
          <Input id="ev-number" className="font-mono uppercase" inputMode="numeric" value={flightNumber} onChange={(e) => setFlightNumber(e.target.value)} autoComplete="off" />
        </Field>
      </div>
    </Dialog>
  );
}

function RegistrationPanel({ event, now }: { event: EventDetail; now: number }) {
  const memberships = useMyMemberships();
  const airlines = useAirlines();
  const register = useRegisterEvent();
  const withdraw = useWithdrawRegistration();
  const [airlineId, setAirlineId] = useState('');
  const [proposed, setProposed] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [booking, setBooking] = useState(false);
  const mine = event.my_registration;
  const chooses = pilotChooses(event.scenario);
  const allowed = (memberships.data ?? []).filter(
    (m) => m.status === 'active' && (event.airline_ids.length === 0 || event.airline_ids.includes(m.airline_id)),
  );
  const chosen = airlineId || allowed[0]?.airline_id || '';
  const airlineName = (id: string) => airlines.data?.find((a) => a.id === id)?.name ?? '';
  const timing = eventTiming(event, now);

  if (mine && (mine.status === 'pending' || mine.status === 'approved')) {
    const open = bookingOpen(event, now);
    return (
      <Panel
        title="Mi registro"
        description={`Vuelas con la flota de ${airlineName(mine.airline_id) || 'tu aerolínea'}.`}
        actions={
          <ConfirmButton
            size="sm"
            variant="secondary"
            title="Retirarte del evento"
            message="Dejas de participar y sales del ranking. Puedes volver a registrarte mientras el evento no termine."
            confirmLabel="Retirarme"
            onConfirm={async () => {
              try {
                await withdraw.mutateAsync(mine.id);
                toast.success('Te retiraste del evento');
              } catch (error) {
                toast.error(describeError(error));
              }
            }}
          >
            Retirarme
          </ConfirmButton>
        }
      >
        <div className="space-y-3">
          <p>
            <Badge tone={enrollmentStatusTone[mine.status]}>{registrationStatusLabels[mine.status]}</Badge>
          </p>
          {mine.status === 'pending' ? <p className="text-sm text-muted">El creador del evento revisa tu registro.</p> : null}
          {mine.status === 'approved' ? (
            mine.active_flight_id ? (
              <p className="text-sm">
                Tienes un vuelo del evento reservado o en curso.{' '}
                <Link to="/my-flights" className="text-cyan underline-offset-2 hover:underline">
                  Ver en My Flights
                </Link>
              </p>
            ) : open ? (
              <Button onClick={() => setBooking(true)}>Reservar mi vuelo</Button>
            ) : timing === 'ended' ? (
              <p className="text-sm text-muted">El evento terminó.</p>
            ) : (
              <p className="text-sm text-muted">Las reservas abren {BOOKING_OPENS_HOURS} horas antes del inicio.</p>
            )
          ) : null}
          {mine.flights > 0 ? <p className="text-xs text-muted">Vuelos del evento: {mine.flights}. El ranking toma el mejor.</p> : null}
        </div>
        {booking ? <BookEventDialog event={event} onClose={() => setBooking(false)} /> : null}
      </Panel>
    );
  }

  if (event.status !== 'published' || timing === 'ended') return null;
  return (
    <Panel title="Registro" description="Pilotos de cualquier aerolínea participante. El creador del evento aprueba cada registro.">
      {allowed.length === 0 ? (
        <p className="text-sm text-muted">Ninguna de tus aerolíneas participa en este evento.</p>
      ) : (
        <div className="grid gap-3">
          <Field id="ev-reg-airline" label="Volar con">
            <Select id="ev-reg-airline" value={chosen} onChange={(e) => setAirlineId(e.target.value)}>
              {allowed.map((m) => (
                <option key={m.airline_id} value={m.airline_id}>
                  {airlineName(m.airline_id) || m.airline_id}
                </option>
              ))}
            </Select>
          </Field>
          {chooses ? (
            <Field id="ev-reg-airport" label={chooses === 'origin' ? 'Origen que planeas (opcional)' : 'Destino que planeas (opcional)'}>
              <AirportPicker id="ev-reg-airport" value={proposed} onChange={setProposed} />
            </Field>
          ) : null}
          <Field id="ev-reg-notes" label="Nota para el creador (opcional)">
            <Input id="ev-reg-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </Field>
          <div>
            <Button
              loading={register.isPending}
              onClick={async () => {
                try {
                  const r = await register.mutateAsync({ eventId: event.id, airlineId: chosen, proposedAirportId: proposed, notes });
                  toast.success(r.status === 'approved' ? 'Registro aprobado' : 'Registro enviado: el creador del evento lo revisa');
                } catch (error) {
                  toast.error(describeError(error));
                }
              }}
            >
              Registrarme
            </Button>
          </div>
          <p className="text-xs text-muted">Mientras estés registrado en un evento no puedes inscribirte a un tour, y al revés.</p>
        </div>
      )}
    </Panel>
  );
}

function RankingPanel({ event, now }: { event: EventDetail; now: number }) {
  const { dual } = useTimePrefs();
  const ended = eventTiming(event, now) === 'ended';
  return (
    <Panel
      title="Ranking"
      description={`${criterionLabels[event.prize_criterion]}. Cuenta el mejor PIREP de cada piloto, aceptado o en revisión, de vuelos que empiezan dentro del horario.`}
    >
      {event.prize_description ? (
        <p className="mb-3 flex items-start gap-2 rounded-md border border-line bg-bg p-3 text-sm">
          <Medal className="mt-0.5 size-4 shrink-0" style={{ color: event.color }} aria-hidden />
          <span>
            <strong>Premio para los {event.prize_places} primeros:</strong> {event.prize_description}
          </span>
        </p>
      ) : null}
      {event.ranking.length === 0 ? (
        <p className="text-sm text-muted">Todavía no hay PIREP del evento.</p>
      ) : (
        <Table minWidth="44rem">
          <thead>
            <tr>
              <Th>#</Th>
              <Th>Piloto</Th>
              <Th>Vuelo</Th>
              <Th>Ruta</Th>
              <Th className="text-right">{criterionLabels[event.prize_criterion]}</Th>
              <Th>PIREP</Th>
            </tr>
          </thead>
          <tbody>
            {event.ranking.map((r) => {
              const winner = r.position <= event.prize_places;
              return (
                <tr key={r.user_id} className={cn(winner && 'bg-accent/5')}>
                  <Td className="font-mono font-semibold">
                    {podiumMetal(r.position) ? (
                      <BadgeArt
                        spec={{ shape: 'round', emblem: 'number', metal: podiumMetal(r.position)!, label: String(r.position), top: null, ribbon: null }}
                        size={34}
                        title={`${r.position}.º lugar`}
                      />
                    ) : (
                      <>
                        {winner ? <Medal className="mr-1 inline size-4" style={{ color: event.color }} aria-label="Lugar con premio" /> : null}
                        {r.position}
                      </>
                    )}
                  </Td>
                  <Td>
                    {r.name} <span className="text-xs text-muted">{formatPilotNumber(r.number)}</span>
                    <span className="block text-xs text-muted">{r.airline_icao}</span>
                  </Td>
                  <Td className="font-mono text-sm">
                    {r.callsign}
                    <span className="block text-xs text-muted">{r.aircraft_type}</span>
                  </Td>
                  <Td className="font-mono text-sm">
                    {r.origin} → {r.destination}
                  </Td>
                  <Td className="text-right font-mono">{criterionValue(r, event.prize_criterion, (iso) => dual(iso, { seconds: true }).primary)}</Td>
                  <Td>
                    <Link to={`/pireps/${r.pirep_id}`} className="text-sm text-cyan underline-offset-2 hover:underline">
                      Ver
                    </Link>
                    {r.pirep_status === 'pending' ? (
                      <Badge tone="info" className="ml-2">
                        En revisión
                      </Badge>
                    ) : null}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {ended ? <p className="mt-3 text-xs text-muted">El evento terminó. Un PIREP en revisión puede cambiar el resultado si se rechaza.</p> : null}
    </Panel>
  );
}

function RegistrationsPanel({ event }: { event: EventDetail }) {
  const review = useReviewRegistration();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const pending = event.registrations.filter((r) => r.status === 'pending');
  const approved = event.registrations.filter((r) => r.status === 'approved');
  return (
    <Panel title="Participantes" description={`${event.participants} registrados.`}>
      <div className="space-y-4">
        {pending.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Registros por aprobar</h3>
            <ul className="divide-y divide-line rounded-md border border-line">
              {pending.map((r) => (
                <li key={r.registration_id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{r.name}</span> <span className="text-sm text-muted">({formatPilotNumber(r.number)})</span>
                    <span className="block text-xs text-muted">
                      Vuela con {r.airline_name}
                      {r.proposed_airport ? ` · planea ${r.proposed_airport}` : ''}
                      {r.notes ? ` · “${r.notes}”` : ''}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    onClick={async () => {
                      try {
                        await review.mutateAsync({ registrationId: r.registration_id, approve: true });
                        toast.success(`${r.name} quedó registrado`);
                      } catch (error) {
                        toast.error(describeError(error));
                      }
                    }}
                  >
                    <Check className="size-4" aria-hidden />
                    Aprobar
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setRejecting(r.registration_id)}>
                    <X className="size-4" aria-hidden />
                    Rechazar
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {approved.length === 0 ? (
          <p className="text-sm text-muted">Todavía no hay pilotos registrados.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {approved.map((r) => (
              <li key={r.registration_id} className="rounded-md border border-line px-3 py-2 text-sm">
                <span className="font-medium">{r.name}</span> <span className="text-xs text-muted">{formatPilotNumber(r.number)}</span>
                <span className="block text-xs text-muted">
                  {r.airline_icao ?? r.airline_name}
                  {r.proposed_airport ? ` · ${r.proposed_airport}` : ''}
                  {r.flights > 0 ? ` · ${r.flights} vuelo(s)` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {rejecting ? (
        <RejectDialog
          title="Rechazar registro"
          onClose={() => setRejecting(null)}
          onReject={async (comment) => {
            await review.mutateAsync({ registrationId: rejecting, approve: false, comment });
            toast.success('Registro rechazado');
          }}
        />
      ) : null}
    </Panel>
  );
}

function OwnerActions({ event }: { event: EventDetail }) {
  const submit = useSubmitEvent();
  const review = useReviewEvent();
  const cancel = useCancelEvent();
  const [rejecting, setRejecting] = useState(false);
  const open = event.status !== 'cancelled' && eventTiming(event) !== 'ended';
  return (
    <div className="flex flex-wrap gap-2">
      {event.can_edit && open ? (
        <Link to={`/events/${event.id}/edit`} className={buttonClasses('secondary', 'sm')}>
          <Pencil className="size-4" aria-hidden />
          Editar
        </Link>
      ) : null}
      {event.can_edit && open && (event.status === 'draft' || event.status === 'rejected') ? (
        <Button
          size="sm"
          loading={submit.isPending}
          onClick={async () => {
            try {
              const status = await submit.mutateAsync(event.id);
              toast.success(status === 'published' ? 'Evento publicado' : 'Evento enviado: el administrador de la aerolínea lo revisa');
            } catch (error) {
              toast.error(describeError(error));
            }
          }}
        >
          <Send className="size-4" aria-hidden />
          Enviar para publicar
        </Button>
      ) : null}
      {event.can_approve ? (
        <>
          <Button
            size="sm"
            loading={review.isPending}
            onClick={async () => {
              try {
                await review.mutateAsync({ eventId: event.id, approve: true });
                toast.success('Evento publicado');
              } catch (error) {
                toast.error(describeError(error));
              }
            }}
          >
            <Check className="size-4" aria-hidden />
            Aprobar y publicar
          </Button>
          <Button size="sm" variant="danger" onClick={() => setRejecting(true)}>
            Rechazar
          </Button>
        </>
      ) : null}
      {event.can_edit && open ? (
        <ConfirmButton
          size="sm"
          variant="danger"
          title="Cancelar el evento"
          message="Los pilotos ya no podrán reservar. Los vuelos ya hechos conservan su PIREP."
          confirmLabel="Cancelar evento"
          onConfirm={async () => {
            try {
              await cancel.mutateAsync({ eventId: event.id });
              toast.success('Evento cancelado');
            } catch (error) {
              toast.error(describeError(error));
            }
          }}
        >
          Cancelar evento
        </ConfirmButton>
      ) : null}
      {rejecting ? (
        <RejectDialog
          title="Rechazar la publicación"
          onClose={() => setRejecting(false)}
          onReject={async (comment) => {
            await review.mutateAsync({ eventId: event.id, approve: false, comment });
            toast.success('Evento rechazado');
          }}
        />
      ) : null}
    </div>
  );
}

export function EventDetailPage() {
  const { id } = useParams();
  const event = useEvent(id);
  const { theme } = useTheme();
  const { dual } = useTimePrefs();
  const now = useNow(30_000);

  if (event.isPending) return <Skeleton className="h-96" />;
  if (event.isError) {
    return (
      <div className="space-y-4">
        <Link to="/events" className={buttonClasses('ghost', 'sm')}>
          <ArrowLeft className="size-4" aria-hidden />
          Eventos
        </Link>
        <Alert tone="danger">{describeError(event.error)}</Alert>
      </div>
    );
  }
  const e = event.data;
  const timing = eventTiming(e, now);
  const start = dual(e.starts_at, { withDate: true });
  const end = dual(e.ends_at, { withDate: true });

  return (
    <div className="space-y-5">
      <Link to="/events" className={buttonClasses('ghost', 'sm')}>
        <ArrowLeft className="size-4" aria-hidden />
        Eventos
      </Link>
      <section className="overflow-hidden rounded-lg border border-line bg-surface" aria-label={`Evento ${e.folio}`}>
        <div className="h-2" style={{ background: e.color }} aria-hidden />
        <div className="flex flex-wrap items-start gap-4 p-4">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-mono text-sm font-semibold" style={{ color: e.color }}>
              {e.folio}
            </p>
            <h1 className="font-display text-3xl font-semibold leading-tight">{e.name}</h1>
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <AirlineLogo airline={{ name: e.airline.name, icao_code: e.airline.icao, logo_path: e.airline.logo_path, brand_primary_color: e.airline.color }} size="sm" />
              {e.airline.name}
              {e.creator ? ` · organizado por ${e.creator.name}` : ''}
              <Badge tone={eventStatusTone[e.status]}>{eventStatusLabels[e.status]}</Badge>
              {e.status === 'published' ? <Badge tone={timing === 'live' ? 'ok' : 'neutral'}>{timingText(e, now)}</Badge> : null}
            </p>
            {e.description ? <p className="max-w-3xl whitespace-pre-line pt-1 text-[15px]">{e.description}</p> : null}
          </div>
          <div className="flex flex-col items-end gap-2">
            {e.status === 'published' ? <InviteLinkButton path={`/events/${e.id}`} what="evento" /> : null}
            <OwnerActions event={e} />
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
          <Fact label="Ruta">
            <span className="font-mono font-semibold">{routeText(e)}</span>
          </Fact>
          <Fact label="Escenario">{scenarioLabels[e.scenario]}</Fact>
          <Fact label="Inicio">
            {start.primary}
            {start.secondary ? <span className="block text-xs text-muted">{start.secondary}</span> : null}
          </Fact>
          <Fact label="Fin">
            {end.primary}
            <span className="block text-xs text-muted">Duración {formatMinutes(eventMinutes(e))} h</span>
          </Fact>
          <Fact label="Aeronaves">{e.aircraft_types.length > 0 ? <span className="font-mono">{e.aircraft_types.join(' · ')}</span> : 'Cualquiera'}</Fact>
          <Fact label="Aerolíneas">{e.airlines.length > 0 ? e.airlines.map((a) => a.icao ?? a.name).join(' · ') : 'Todas'}</Fact>
        </dl>
      </section>

      {e.status === 'rejected' && e.review_comment ? <Alert tone="danger">Publicación rechazada: {e.review_comment}</Alert> : null}
      {e.status === 'cancelled' ? <Alert tone="danger">Evento cancelado{e.review_comment ? `: ${e.review_comment}` : ''}.</Alert> : null}
      {e.status === 'submitted' && !e.can_approve ? <Alert tone="info">El evento espera que un administrador de {e.airline.name} lo apruebe.</Alert> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          <EventMap origin={e.origin} destination={e.destination} color={e.color} theme={theme} height="clamp(260px, 40vh, 400px)" />
          <p className="text-xs text-muted">{scenarioHints[e.scenario]} En el mapa en vivo, la figura del avión de los participantes toma el color del evento.</p>
        </div>
        <RegistrationPanel event={e} now={now} />
      </div>

      {e.status !== 'draft' ? <RankingPanel event={e} now={now} /> : null}
      {e.status !== 'draft' ? <RegistrationsPanel event={e} /> : null}
    </div>
  );
}
