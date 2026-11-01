import { ArrowLeft, Check, Pencil, Send, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { AirlineLogo } from '@/components/airline-logo';
import { ConfirmButton } from '@/components/confirm-button';
import { TourBadge } from '@/components/tour-badge';
import { TourMap } from '@/components/tour-map';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClasses } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, Td, Th } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useFleet } from '@/hooks/use-fleet';
import { useAirlines, useMyMemberships } from '@/hooks/use-lam-data';
import {
  useBookTourLeg,
  useCloseTour,
  useEnrollTour,
  useReviewEnrollment,
  useReviewTour,
  useSubmitTour,
  useTour,
  useWithdrawEnrollment,
} from '@/hooks/use-tours';
import { normalizeCallsign, CALLSIGN_PATTERN } from '@/lib/booking';
import { cn } from '@/lib/cn';
import { describeError } from '@/lib/errors';
import { formatNumber, formatPilotNumber } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import {
  enrollmentStatusLabels,
  enrollmentStatusTone,
  FLIGHT_NUMBER_PATTERN,
  legBlock,
  legBlockLabels,
  legStateLabels,
  legStateTone,
  tourProgress,
  tourStatusLabels,
  tourStatusTone,
  tourWindow,
  type LegState,
  type TourDetail,
  type TourLeg,
} from '@/lib/tours';

function Rule({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function ProgressBar({ value, total, color }: { value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Avance del tour">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/** Rechazar con motivo (publicación del tour o inscripción). */
function RejectDialog({ title, onClose, onReject }: { title: string; onClose: () => void; onReject: (comment: string) => Promise<void> }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await onReject(comment.trim());
      onClose();
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" loading={busy} disabled={comment.trim().length === 0} onClick={() => void submit()}>
            Rechazar
          </Button>
        </>
      }
    >
      <Field id="reject-comment" label="Motivo" hint="Lo verá quien lo envió.">
        <Textarea id="reject-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
      </Field>
    </Dialog>
  );
}

/** Reserva de un leg con la flota de la aerolínea con la que el piloto se inscribió. */
function BookLegDialog({ tour, leg, enrollmentId, airlineId, onClose }: { tour: TourDetail; leg: TourLeg; enrollmentId: string; airlineId: string; onClose: () => void }) {
  const fleet = useFleet(airlineId);
  const book = useBookTourLeg();
  const [aircraftId, setAircraftId] = useState('');
  const [callsign, setCallsign] = useState('');
  const [flightNumber, setFlightNumber] = useState('');
  const [tried, setTried] = useState(false);

  const options = useMemo(
    () =>
      (fleet.data ?? []).filter(
        (a) => a.status === 'available' && (tour.aircraft_type_ids.length === 0 || tour.aircraft_type_ids.includes(a.aircraft_type_id)),
      ),
    [fleet.data, tour.aircraft_type_ids],
  );
  const cs = normalizeCallsign(callsign);
  const fn = flightNumber.trim().toUpperCase();
  const callsignError = tried && !CALLSIGN_PATTERN.test(cs) ? 'De 3 a 10 letras o números, sin espacios' : undefined;
  const numberError = tried && !FLIGHT_NUMBER_PATTERN.test(fn) ? 'De 1 a 4 dígitos y, opcional, una letra' : undefined;

  async function submit() {
    setTried(true);
    if (!aircraftId || !CALLSIGN_PATTERN.test(cs) || !FLIGHT_NUMBER_PATTERN.test(fn)) return;
    try {
      await book.mutateAsync({ enrollmentId, legId: leg.id, aircraftId, callsign: cs, flightNumber: fn });
      toast.success(`Leg ${leg.leg_number} reservado. Lo encuentras en My Flights para despachar e iniciar con LAM ACARS.`);
      onClose();
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Reservar leg ${leg.leg_number}: ${leg.origin.icao} → ${leg.destination.icao}`}
      description={`${formatNumber(leg.distance_nm)} NM. El PIREP cuenta como un vuelo normal de tu aerolínea y avanza el tour.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={book.isPending} onClick={() => void submit()}>
            Reservar leg
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field id="leg-aircraft" label="Aeronave" error={tried && !aircraftId ? 'Elige una aeronave' : undefined} hint={tour.aircraft_types.length > 0 ? `Tipos del tour: ${tour.aircraft_types.join(', ')}` : undefined}>
            {fleet.isPending ? (
              <Skeleton className="h-10" />
            ) : options.length === 0 ? (
              <Alert tone="info">No hay aeronaves disponibles de los tipos del tour en tu aerolínea.</Alert>
            ) : (
              <Select id="leg-aircraft" value={aircraftId} onChange={(e) => setAircraftId(e.target.value)}>
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
        <Field id="leg-callsign" label="Callsign" error={callsignError}>
          <Input id="leg-callsign" className="font-mono uppercase" value={callsign} onChange={(e) => setCallsign(e.target.value)} autoComplete="off" />
        </Field>
        <Field id="leg-number" label="Número de vuelo" error={numberError}>
          <Input id="leg-number" className="font-mono uppercase" inputMode="numeric" value={flightNumber} onChange={(e) => setFlightNumber(e.target.value)} autoComplete="off" />
        </Field>
      </div>
    </Dialog>
  );
}

function EnrollPanel({ tour }: { tour: TourDetail }) {
  const memberships = useMyMemberships();
  const airlines = useAirlines();
  const enroll = useEnrollTour();
  const withdraw = useWithdrawEnrollment();
  const mine = tour.my_enrollment;
  const active = (memberships.data ?? []).filter((m) => m.status === 'active');
  const [airlineId, setAirlineId] = useState('');
  const chosen = airlineId || active.find((m) => m.airline_id === tour.airline.id)?.airline_id || active[0]?.airline_id || '';
  const timing = tourWindow(tour);
  const airlineName = (id: string) => airlines.data?.find((a) => a.id === id)?.name ?? '';

  if (mine && ['pending', 'approved', 'completed'].includes(mine.status)) {
    const legs = tour.my_legs ?? [];
    const progress = tourProgress(legs);
    return (
      <Panel
        title="Mi participación"
        description={`Vuelas con la flota de ${airlineName(mine.airline_id) || 'tu aerolínea'}.`}
        actions={
          mine.status !== 'completed' ? (
            <ConfirmButton
              size="sm"
              variant="secondary"
              title="Retirarte del tour"
              message="Tu avance se conserva en tus PIREP, pero dejas de participar. Puedes volver a inscribirte después."
              confirmLabel="Retirarme"
              onConfirm={async () => {
                try {
                  await withdraw.mutateAsync(mine.id);
                  toast.success('Te retiraste del tour');
                } catch (error) {
                  toast.error(describeError(error));
                }
              }}
            >
              Retirarme
            </ConfirmButton>
          ) : null
        }
      >
        <div className="space-y-3">
          <p className="flex flex-wrap items-center gap-2">
            <Badge tone={enrollmentStatusTone[mine.status]}>{enrollmentStatusLabels[mine.status]}</Badge>
            {mine.status === 'pending' ? <span className="text-sm text-muted">El creador del tour revisa tu inscripción.</span> : null}
          </p>
          {mine.status !== 'pending' ? (
            <>
              <ProgressBar value={progress.flown} total={progress.total} color={tour.color} />
              <p className="text-sm text-muted">
                {progress.flown} de {progress.total} legs volados · {progress.accepted} aceptados. Un leg cuenta con su PIREP aceptado o en revisión; si se
                rechaza, se repite.
              </p>
            </>
          ) : null}
          {mine.status === 'completed' ? (
            <p className="flex items-center gap-3 rounded-md border border-line bg-bg p-3">
              <TourBadge code={tour.code} color={tour.color} badgePath={tour.badge_path} />
              <span>
                <strong>¡Tour terminado!</strong>
                <span className="block text-sm text-muted">La insignia ya aparece en tu perfil.</span>
              </span>
            </p>
          ) : null}
        </div>
      </Panel>
    );
  }

  if (tour.status !== 'published') return null;
  return (
    <Panel title="Inscripción" description="Cualquier piloto de cualquier aerolínea puede participar; vuelas con la flota de la aerolínea que elijas.">
      {timing === 'ended' ? (
        <p className="text-sm text-muted">El tour ya terminó.</p>
      ) : active.length === 0 ? (
        <p className="text-sm text-muted">Necesitas una membresía activa en alguna aerolínea para inscribirte.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <Field id="enroll-airline" label="Volar con">
            <Select id="enroll-airline" value={chosen} onChange={(e) => setAirlineId(e.target.value)}>
              {active.map((m) => (
                <option key={m.airline_id} value={m.airline_id}>
                  {airlineName(m.airline_id) || m.airline_id}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            loading={enroll.isPending}
            onClick={async () => {
              try {
                const r = await enroll.mutateAsync({ tourId: tour.id, airlineId: chosen });
                toast.success(r.status === 'approved' ? 'Inscripción aprobada: ya puedes reservar el primer leg' : 'Inscripción enviada: el creador del tour la revisa');
              } catch (error) {
                toast.error(describeError(error));
              }
            }}
          >
            Inscribirme
          </Button>
          {tour.auto_approve_same_airline ? (
            <p className="w-full text-xs text-muted">Los pilotos de {tour.airline.name} quedan aprobados al inscribirse.</p>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

function LegsTable({ tour, onBook }: { tour: TourDetail; onBook: (leg: TourLeg) => void }) {
  const mine = tour.my_enrollment;
  const myLegs = tour.my_legs ?? [];
  const canBook = mine?.status === 'approved' && tour.status === 'published' && tourWindow(tour) === 'open';
  return (
    <Table minWidth="44rem">
      <thead>
        <tr>
          <Th>Leg</Th>
          <Th>Ruta</Th>
          <Th className="text-right">Distancia</Th>
          <Th>Notas</Th>
          {mine ? <Th>Mi avance</Th> : null}
          {canBook ? <Th className="text-right">Acción</Th> : null}
        </tr>
      </thead>
      <tbody>
        {tour.legs.map((leg) => {
          const my = myLegs.find((l) => l.leg_id === leg.id);
          const block = canBook ? legBlock(tour, myLegs, leg.leg_number) : null;
          return (
            <tr key={leg.id}>
              <Td className="font-mono font-semibold">{leg.leg_number}</Td>
              <Td>
                <span className="font-mono font-medium">
                  {leg.origin.icao} → {leg.destination.icao}
                </span>
                <span className="block text-xs text-muted">
                  {leg.origin.city ?? leg.origin.name} → {leg.destination.city ?? leg.destination.name}
                </span>
              </Td>
              <Td className="text-right tabular-nums">{formatNumber(leg.distance_nm)} NM</Td>
              <Td className="max-w-[16rem] text-sm text-muted">{leg.notes ?? '—'}</Td>
              {mine ? (
                <Td>
                  {my ? (
                    <span className="flex flex-col gap-0.5">
                      <Badge tone={legStateTone[my.state]}>{legStateLabels[my.state]}</Badge>
                      {my.pirep_id ? (
                        <Link to={`/pireps/${my.pirep_id}`} className="text-xs text-cyan underline-offset-2 hover:underline">
                          Ver PIREP
                        </Link>
                      ) : null}
                    </span>
                  ) : (
                    '—'
                  )}
                </Td>
              ) : null}
              {canBook ? (
                <Td className="text-right">
                  {block === null ? (
                    <Button size="sm" onClick={() => onBook(leg)}>
                      Reservar
                    </Button>
                  ) : block === 'booked' ? (
                    <Link to="/my-flights" className={buttonClasses('secondary', 'sm')}>
                      Ver en My Flights
                    </Link>
                  ) : block === 'done' ? null : (
                    <span className="text-xs text-muted">{legBlockLabels[block]}</span>
                  )}
                </Td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function ParticipantsPanel({ tour }: { tour: TourDetail }) {
  const review = useReviewEnrollment();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const pending = tour.participants_list.filter((p) => p.status === 'pending');
  const flying = tour.participants_list.filter((p) => p.status !== 'pending');
  return (
    <Panel title="Participantes" description={`${tour.participants} inscritos · ${tour.finishers} terminaron con todos los legs aceptados.`}>
      <div className="space-y-4">
        {pending.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Inscripciones por aprobar</h3>
            <ul className="divide-y divide-line rounded-md border border-line">
              {pending.map((p) => (
                <li key={p.enrollment_id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{p.name}</span> <span className="text-sm text-muted">({formatPilotNumber(p.number)})</span>
                    <span className="block text-xs text-muted">Vuela con {p.airline_name}</span>
                  </span>
                  <Button
                    size="sm"
                    loading={review.isPending && review.variables?.enrollmentId === p.enrollment_id && review.variables.approve}
                    onClick={async () => {
                      try {
                        await review.mutateAsync({ enrollmentId: p.enrollment_id, approve: true });
                        toast.success(`${p.name} quedó inscrito`);
                      } catch (error) {
                        toast.error(describeError(error));
                      }
                    }}
                  >
                    <Check className="size-4" aria-hidden />
                    Aprobar
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setRejecting(p.enrollment_id)}>
                    <X className="size-4" aria-hidden />
                    Rechazar
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {flying.length === 0 ? (
          <p className="text-sm text-muted">Todavía no hay pilotos inscritos.</p>
        ) : (
          <Table minWidth="32rem">
            <thead>
              <tr>
                <Th>Piloto</Th>
                <Th>Aerolínea</Th>
                <Th>Avance</Th>
                <Th>Estado</Th>
              </tr>
            </thead>
            <tbody>
              {flying.map((p) => (
                <tr key={p.enrollment_id}>
                  <Td>
                    {p.name} <span className="text-xs text-muted">{formatPilotNumber(p.number)}</span>
                  </Td>
                  <Td className="font-mono text-sm">{p.airline_icao ?? p.airline_name}</Td>
                  <Td className="w-48">
                    <ProgressBar value={p.legs_flown} total={tour.legs_count} color={tour.color} />
                    <span className="text-xs text-muted">
                      {p.legs_flown}/{tour.legs_count} volados · {p.legs_accepted} aceptados
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={enrollmentStatusTone[p.status]}>{enrollmentStatusLabels[p.status]}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
      {rejecting ? (
        <RejectDialog
          title="Rechazar inscripción"
          onClose={() => setRejecting(null)}
          onReject={async (comment) => {
            await review.mutateAsync({ enrollmentId: rejecting, approve: false, comment });
            toast.success('Inscripción rechazada');
          }}
        />
      ) : null}
    </Panel>
  );
}

function OwnerActions({ tour }: { tour: TourDetail }) {
  const submit = useSubmitTour();
  const review = useReviewTour();
  const close = useCloseTour();
  const [rejecting, setRejecting] = useState(false);
  const editable = tour.can_edit && tour.status !== 'closed';
  return (
    <div className="flex flex-wrap gap-2">
      {editable ? (
        <Link to={`/tours/${tour.id}/edit`} className={buttonClasses('secondary', 'sm')}>
          <Pencil className="size-4" aria-hidden />
          Editar
        </Link>
      ) : null}
      {tour.can_edit && (tour.status === 'draft' || tour.status === 'rejected') ? (
        <Button
          size="sm"
          loading={submit.isPending}
          onClick={async () => {
            try {
              const status = await submit.mutateAsync(tour.id);
              toast.success(status === 'published' ? 'Tour publicado' : 'Tour enviado: el administrador de la aerolínea lo revisa');
            } catch (error) {
              toast.error(describeError(error));
            }
          }}
        >
          <Send className="size-4" aria-hidden />
          Enviar para publicar
        </Button>
      ) : null}
      {tour.can_approve ? (
        <>
          <Button
            size="sm"
            loading={review.isPending}
            onClick={async () => {
              try {
                await review.mutateAsync({ tourId: tour.id, approve: true });
                toast.success('Tour publicado');
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
      {tour.can_edit && tour.status === 'published' ? (
        <ConfirmButton
          size="sm"
          variant="secondary"
          title="Cerrar el tour"
          message="Ya no admitirá inscripciones ni reservas nuevas. Lo volado y las insignias se conservan."
          confirmLabel="Cerrar tour"
          onConfirm={async () => {
            try {
              await close.mutateAsync(tour.id);
              toast.success('Tour cerrado');
            } catch (error) {
              toast.error(describeError(error));
            }
          }}
        >
          Cerrar tour
        </ConfirmButton>
      ) : null}
      {rejecting ? (
        <RejectDialog
          title="Rechazar la publicación"
          onClose={() => setRejecting(false)}
          onReject={async (comment) => {
            await review.mutateAsync({ tourId: tour.id, approve: false, comment });
            toast.success('Tour rechazado');
          }}
        />
      ) : null}
    </div>
  );
}

export function TourDetailPage() {
  const { id } = useParams();
  const tour = useTour(id);
  const { theme } = useTheme();
  const [booking, setBooking] = useState<TourLeg | null>(null);
  const states = useMemo(() => {
    const out: Record<string, LegState> = {};
    for (const l of tour.data?.my_legs ?? []) out[l.leg_id] = l.state;
    return out;
  }, [tour.data?.my_legs]);

  if (tour.isPending) return <Skeleton className="h-96" />;
  if (tour.isError) {
    return (
      <div className="space-y-4">
        <Link to="/tours" className={buttonClasses('ghost', 'sm')}>
          <ArrowLeft className="size-4" aria-hidden />
          Tours
        </Link>
        <Alert tone="danger">{describeError(tour.error)}</Alert>
      </div>
    );
  }
  const t = tour.data;
  const mine = t.my_enrollment;
  const range = t.starts_on || t.ends_on ? `${t.starts_on ?? 'sin inicio'} → ${t.ends_on ?? 'sin fin'}` : 'Sin fechas: siempre abierto';

  return (
    <div className="space-y-5">
      <Link to="/tours" className={buttonClasses('ghost', 'sm')}>
        <ArrowLeft className="size-4" aria-hidden />
        Tours
      </Link>
      <section className="overflow-hidden rounded-lg border border-line bg-surface" aria-label={`Tour ${t.code}`}>
        <div className="h-2" style={{ background: t.color }} aria-hidden />
        <div className="flex flex-wrap items-start gap-4 p-4">
          <TourBadge code={t.code} color={t.color} badgePath={t.badge_path} size="lg" muted={mine?.status !== 'completed'} />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-mono text-sm font-semibold" style={{ color: t.color }}>
              {t.code}
            </p>
            <h1 className="font-display text-3xl font-semibold leading-tight">{t.name}</h1>
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <AirlineLogo airline={{ name: t.airline.name, icao_code: t.airline.icao, logo_path: t.airline.logo_path, brand_primary_color: t.airline.color }} size="sm" />
              {t.airline.name}
              {t.creator ? ` · creado por ${t.creator.name}` : ''}
              <Badge tone={tourStatusTone[t.status]}>{tourStatusLabels[t.status]}</Badge>
            </p>
            {t.description ? <p className="max-w-3xl whitespace-pre-line pt-1 text-[15px]">{t.description}</p> : null}
          </div>
          <OwnerActions tour={t} />
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
          <Rule label="Legs">
            {t.legs_count} · {formatNumber(t.distance_nm)} NM
          </Rule>
          <Rule label="Orden">{t.ordered_legs ? 'En orden' : 'Cualquier orden'}</Rule>
          <Rule label="Sin revisión">
            {t.allow_unreviewed_progress ? `Hasta ${t.max_unreviewed_legs} legs en revisión` : 'Cada leg debe estar revisado'}
          </Rule>
          <Rule label="Aeronaves">{t.aircraft_types.length > 0 ? <span className="font-mono">{t.aircraft_types.join(' · ')}</span> : 'Cualquiera'}</Rule>
          <Rule label="Vigencia">{range}</Rule>
          <Rule label="Inscripción">{t.auto_approve_same_airline ? `Automática para ${t.airline.icao ?? t.airline.name}` : 'La aprueba el creador'}</Rule>
        </dl>
      </section>

      {t.status === 'rejected' && t.review_comment ? <Alert tone="danger">Publicación rechazada: {t.review_comment}</Alert> : null}
      {t.status === 'submitted' && !t.can_approve ? <Alert tone="info">El tour espera que un administrador de {t.airline.name} lo apruebe.</Alert> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <TourMap legs={t.legs} color={t.color} states={mine ? states : undefined} theme={theme} height="clamp(300px, 46vh, 460px)" />
        <EnrollPanel tour={t} />
      </div>

      <Panel title="Legs" description={t.ordered_legs ? 'Se vuelan en el orden de la lista.' : 'Se pueden volar en cualquier orden.'}>
        <LegsTable tour={t} onBook={setBooking} />
      </Panel>

      {t.status !== 'draft' ? <ParticipantsPanel tour={t} /> : null}

      {booking && mine ? (
        <BookLegDialog tour={t} leg={booking} enrollmentId={mine.id} airlineId={mine.airline_id} onClose={() => setBooking(null)} />
      ) : null}
      <p className={cn('text-xs text-muted')}>
        El color del tour pinta la figura del avión en el mapa en vivo mientras vuelas un leg; tu trayectoria conserva los colores por fase.
      </p>
    </div>
  );
}
