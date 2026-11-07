import { ArrowLeft, CalendarPlus, Download, ExternalLink, MessageCircle, Pencil, Plane, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { AirlineLogo } from '@/components/airline-logo';
import { Avatar } from '@/components/avatar';
import { ConfirmButton } from '@/components/confirm-button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyRow, Table, Td, Th } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useNow } from '@/hooks/use-now';
import {
  useCancelTraining,
  useRegisterTraining,
  useReviewTrainingRegistration,
  useSetTrainingResult,
  useTraining,
  useWithdrawTraining,
  type TrainingDetail,
  type TrainingRegistration,
} from '@/hooks/use-trainings';
import { useAuth } from '@/lib/auth';
import { describeError } from '@/lib/errors';
import { formatLocalDateTime, formatPilotNumber } from '@/lib/format';
import { formatMinutes } from '@/lib/pirep';
import { DualTimeText, useTimePrefs } from '@/lib/time-context';
import { downloadIcs, googleCalendarUrl, registrationStatus, trainingLevels, trainingPhase, trainingResults } from '@/lib/training';
import { CategoryBadge, TrainingStatusBadge } from '@/pages/training-page';

function pageUrl(id: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}training/${id}`;
}

function run(promise: Promise<unknown>, ok: string) {
  return promise.then(
    () => toast.success(ok),
    (error: unknown) => {
      toast.error(describeError(error));
      throw error;
    },
  );
}

function MyRegistration({ training, now }: { training: TrainingDetail; now: number }) {
  const register = useRegisterTraining();
  const withdraw = useWithdrawTraining();
  const [notes, setNotes] = useState('');
  const { user } = useAuth();
  const reg = training.my_registration;
  const phase = trainingPhase(training, now);
  const isInstructor = training.instructor_id !== null && training.instructor_id === user?.id;

  if (reg && reg.status !== 'withdrawn') {
    const s = registrationStatus[reg.status];
    return (
      <Panel title="Mi participación" description={`Solicitada el ${formatLocalDateTime(reg.created_at)}.`}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={s.tone}>{s.label}</Badge>
            {reg.result ? <Badge tone={trainingResults[reg.result].tone}>{trainingResults[reg.result].label}</Badge> : null}
          </div>
          <p className="text-sm text-muted">
            {reg.status === 'pending'
              ? 'Quien organiza el entrenamiento revisa tu solicitud. Aquí verás la confirmación.'
              : reg.status === 'approved'
                ? reg.result === 'completed'
                  ? 'Completaste este entrenamiento: ya aparece en los reconocimientos de tu perfil.'
                  : 'Tu lugar está confirmado. Agrega el entrenamiento a tu calendario y entra al canal de Discord a la hora indicada.'
                : 'Tu solicitud no fue aprobada.'}
          </p>
          {reg.review_comment ? <p className="rounded-md border border-line px-3 py-2 text-sm">Comentario: {reg.review_comment}</p> : null}
          {reg.status !== 'rejected' && !reg.result && phase !== 'ended' && phase !== 'cancelled' ? (
            <ConfirmButton
              size="sm"
              variant="ghost"
              title="Retirar mi participación"
              message="Liberas tu lugar. Puedes volver a solicitarlo mientras no empiece."
              confirmLabel="Retirarme"
              onConfirm={() => run(withdraw.mutateAsync(reg.id), 'Participación retirada')}
            >
              Retirar mi participación
            </ConfirmButton>
          ) : null}
        </div>
      </Panel>
    );
  }

  if (phase !== 'upcoming' || isInstructor) return null;
  if (!training.can_join) return <Alert>Para inscribirte necesitas ser miembro activo de alguna aerolínea.</Alert>;
  const full = training.capacity !== null && training.approved >= training.capacity;
  return (
    <Panel title="Solicitar participación" description="Quien organiza confirma tu lugar; verás el estado aquí y en la lista de Training.">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(register.mutateAsync({ id: training.id, notes: notes.trim() || null }), 'Solicitud enviada').then(() => setNotes(''), () => undefined);
        }}
      >
        {full ? <Alert>El cupo está lleno; puedes solicitar lugar por si alguien se retira.</Alert> : null}
        <label htmlFor="trn-notes" className="block text-sm font-medium">
          Nota para el instructor (opcional)
        </label>
        <Textarea id="trn-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Tu experiencia con el tema o la aeronave" />
        <Button type="submit" loading={register.isPending}>
          Solicitar participación
        </Button>
      </form>
    </Panel>
  );
}

function RegistrationRow({ r, training, now }: { r: TrainingRegistration; training: TrainingDetail; now: number }) {
  const review = useReviewTrainingRegistration();
  const result = useSetTrainingResult();
  const [comment, setComment] = useState('');
  const started = now >= Date.parse(training.starts_at);
  const cancelled = training.status === 'cancelled';
  const s = registrationStatus[r.status];
  return (
    <tr>
      <Td>
        <span className="flex items-center gap-2">
          <Avatar name={r.pilot.display_name} url={r.pilot.avatar_url} size="xs" />
          <span>
            <Link to={`/pilots/${r.pilot.pilot_number}`} className="font-medium underline-offset-4 hover:underline">
              {r.pilot.display_name}
            </Link>
            <span className="block font-mono text-xs text-muted">
              {formatPilotNumber(r.pilot.pilot_number)}
              {r.pilot.airlines ? ` · ${r.pilot.airlines}` : ''}
              {r.pilot.discord_username ? ` · @${r.pilot.discord_username}` : ''}
            </span>
          </span>
        </span>
      </Td>
      <Td className="max-w-xs text-sm">{r.notes ?? <span className="text-muted">—</span>}</Td>
      <Td>
        <Badge tone={s.tone}>{s.label}</Badge>
        {r.result ? (
          <span className="ml-1.5">
            <Badge tone={trainingResults[r.result].tone}>{trainingResults[r.result].label}</Badge>
          </span>
        ) : null}
      </Td>
      <Td className="text-right">
        {cancelled ? null : !started && (r.status === 'pending' || r.status === 'approved' || r.status === 'rejected') ? (
          <div className="flex flex-wrap justify-end gap-1.5">
            {r.status !== 'approved' ? (
              <Button size="sm" loading={review.isPending} onClick={() => void run(review.mutateAsync({ id: r.id, approve: true, comment: comment.trim() || null }), `${r.pilot.display_name} confirmado`).catch(() => undefined)}>
                Confirmar
              </Button>
            ) : null}
            {r.status !== 'rejected' ? (
              <ConfirmButton
                size="sm"
                variant="ghost"
                title={`No aprobar a ${r.pilot.display_name}`}
                message={
                  <div className="space-y-2 text-left">
                    <p>Verá «No aprobada» con tu comentario.</p>
                    <Textarea aria-label="Comentario" rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />
                  </div>
                }
                confirmLabel="No aprobar"
                onConfirm={() => run(review.mutateAsync({ id: r.id, approve: false, comment: comment.trim() || null }), 'Solicitud no aprobada')}
              >
                {r.status === 'approved' ? 'Quitar' : 'No aprobar'}
              </ConfirmButton>
            ) : null}
          </div>
        ) : started && r.status === 'approved' ? (
          <div className="flex flex-wrap justify-end gap-1.5" role="group" aria-label={`Resultado de ${r.pilot.display_name}`}>
            <Button
              size="sm"
              variant={r.result === 'completed' ? 'primary' : 'secondary'}
              aria-pressed={r.result === 'completed'}
              loading={result.isPending}
              onClick={() => void run(result.mutateAsync({ id: r.id, result: r.result === 'completed' ? null : 'completed' }), 'Resultado guardado').catch(() => undefined)}
            >
              Completó
            </Button>
            <Button
              size="sm"
              variant={r.result === 'absent' ? 'primary' : 'ghost'}
              aria-pressed={r.result === 'absent'}
              disabled={result.isPending}
              onClick={() => void run(result.mutateAsync({ id: r.id, result: r.result === 'absent' ? null : 'absent' }), 'Resultado guardado').catch(() => undefined)}
            >
              No asistió
            </Button>
          </div>
        ) : null}
      </Td>
    </tr>
  );
}

function Manage({ training, now }: { training: TrainingDetail; now: number }) {
  const started = now >= Date.parse(training.starts_at);
  const rows = training.registrations;
  return (
    <Panel
      expandable
      title="Inscripciones"
      description={
        started
          ? 'Ya empezó: marca a cada participante como «Completó» (gana el reconocimiento en su perfil) o «No asistió».'
          : 'Confirma o no aprueba cada solicitud. Al empezar el entrenamiento podrás registrar la asistencia.'
      }
    >
      <Table minWidth="52rem">
        <thead>
          <tr>
            <Th>Piloto</Th>
            <Th>Nota</Th>
            <Th>Estado</Th>
            <Th className="text-right">{started ? 'Resultado' : 'Acciones'}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={4}>Todavía nadie se inscribe.</EmptyRow>
          ) : (
            rows.map((r) => <RegistrationRow key={r.id} r={r} training={training} now={now} />)
          )}
        </tbody>
      </Table>
    </Panel>
  );
}

export function TrainingDetailPage() {
  const { id } = useParams();
  const now = useNow(30_000);
  const training = useTraining(id);
  const cancel = useCancelTraining();
  const { localLabel } = useTimePrefs();
  const [reason, setReason] = useState('');
  const t = training.data;

  return (
    <div className="space-y-5">
      <Link to="/training" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Training
      </Link>

      {training.isPending ? (
        <Skeleton className="h-64" />
      ) : training.isError ? (
        <Alert tone="danger">{describeError(training.error)}</Alert>
      ) : t ? (
        <>
          <section aria-label="Datos del entrenamiento" className="rounded-lg border border-line bg-surface p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-muted">{t.folio}</span>
              <CategoryBadge category={t.category} />
              <Badge tone="neutral">{trainingLevels[t.level]}</Badge>
              {trainingPhase(t, now) === 'live' ? <Badge tone="info">En curso</Badge> : null}
              {trainingPhase(t, now) === 'ended' ? <Badge tone="neutral">Terminado</Badge> : null}
              {t.status === 'cancelled' ? <Badge tone="danger">Cancelado</Badge> : null}
              <span className="ml-auto">
                <TrainingStatusBadge training={t} />
              </span>
            </div>
            <h1 className="mt-2 font-display text-3xl font-semibold leading-tight">{t.title}</h1>
            {t.status === 'cancelled' ? <Alert tone="danger" className="mt-3">{`Cancelado${t.cancel_reason ? `: ${t.cancel_reason}` : '.'}`}</Alert> : null}

            <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-sm text-muted">Inicio</dt>
                <dd>
                  <DualTimeText value={t.starts_at} withDate />
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Fin</dt>
                <dd>
                  <DualTimeText value={t.ends_at} withDate />
                  <span className="block text-xs text-muted">Duración {formatMinutes(Math.round((Date.parse(t.ends_at) - Date.parse(t.starts_at)) / 60_000))}</span>
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Instructor</dt>
                <dd className="flex items-center gap-2">
                  <Avatar name={t.instructor?.display_name} url={t.instructor?.avatar_url} size="sm" />
                  {t.instructor?.pilot_number ? (
                    <Link to={`/pilots/${t.instructor.pilot_number}`} className="underline-offset-4 hover:underline">
                      {t.instructor.display_name}
                    </Link>
                  ) : (
                    <span>
                      {t.instructor?.display_name}
                      <span className="block text-xs text-muted">Instructor externo</span>
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Participantes</dt>
                <dd className="inline-flex items-center gap-1.5">
                  <Users className="size-4 text-muted" aria-hidden />
                  {t.approved} confirmados{t.capacity ? ` de ${t.capacity}` : ''}
                  {t.can_manage && t.pending ? ` · ${t.pending} por revisar` : ''}
                </dd>
              </div>
              {t.airline ? (
                <div>
                  <dt className="text-sm text-muted">Organiza</dt>
                  <dd className="flex items-center gap-2">
                    <AirlineLogo airline={t.airline} size="sm" />
                    {t.airline.name}
                  </dd>
                </div>
              ) : null}
              {t.aircraft_type ? (
                <div>
                  <dt className="text-sm text-muted">Aeronave</dt>
                  <dd className="inline-flex items-center gap-1.5">
                    <Plane className="size-4 text-muted" aria-hidden />
                    <span className="font-mono">{t.aircraft_type.icao_code}</span> {t.aircraft_type.model}
                  </dd>
                </div>
              ) : null}
              {t.created_by ? (
                <div>
                  <dt className="text-sm text-muted">Programó</dt>
                  <dd>{t.created_by.display_name}</dd>
                </div>
              ) : null}
            </dl>

            {t.description ? <p className="mt-4 max-w-4xl whitespace-pre-line text-[15px]">{t.description}</p> : null}

            <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
              {t.discord_url ? (
                <a
                  href={t.discord_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#5865F2] px-3 text-sm font-medium text-white hover:brightness-110"
                >
                  <MessageCircle className="size-4" aria-hidden />
                  {t.discord_channel ? `Discord · ${t.discord_channel}` : 'Abrir el canal de Discord'}
                </a>
              ) : null}
              <Button variant="secondary" onClick={() => downloadIcs(t, pageUrl(t.id))}>
                <Download className="size-4" aria-hidden />
                Agregar a mi calendario (.ics)
              </Button>
              <a
                href={googleCalendarUrl(t, pageUrl(t.id))}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line px-3 text-sm hover:bg-surface-2"
              >
                <CalendarPlus className="size-4" aria-hidden />
                Google Calendar
              </a>
              {t.materials_url ? (
                <a
                  href={t.materials_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line px-3 text-sm hover:bg-surface-2"
                >
                  <ExternalLink className="size-4" aria-hidden />
                  Material del entrenamiento
                </a>
              ) : null}
              {t.can_manage && t.status === 'scheduled' && now < Date.parse(t.ends_at) ? (
                <>
                  <Link to={`/training/${t.id}/edit`} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line px-3 text-sm hover:bg-surface-2">
                    <Pencil className="size-4" aria-hidden />
                    Editar
                  </Link>
                  <ConfirmButton
                    variant="danger"
                    title={`Cancelar ${t.folio}`}
                    message={
                      <div className="space-y-2 text-left">
                        <p>Los inscritos verán que se canceló, con el motivo. No se puede deshacer.</p>
                        <Textarea aria-label="Motivo" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (opcional)" />
                      </div>
                    }
                    confirmLabel="Cancelar entrenamiento"
                    onConfirm={() => run(cancel.mutateAsync({ id: t.id, reason: reason.trim() || null }), 'Entrenamiento cancelado')}
                  >
                    Cancelar
                  </ConfirmButton>
                </>
              ) : null}
            </div>
            <p className="mt-2 text-xs text-muted">
              El archivo .ics guarda la hora en UTC; tu calendario la muestra en tu zona ({localLabel}).
            </p>
          </section>

          <MyRegistration training={t} now={now} />

          {t.can_manage ? (
            <Manage training={t} now={now} />
          ) : (
            <Panel title="Participantes confirmados">
              {t.registrations.filter((r) => r.status === 'approved').length === 0 ? (
                <p className="text-sm text-muted">Todavía no hay participantes confirmados.</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {t.registrations
                    .filter((r) => r.status === 'approved')
                    .map((r) => (
                      <li key={r.id} className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-sm">
                        <Avatar name={r.pilot.display_name} url={r.pilot.avatar_url} size="xs" />
                        {r.pilot.display_name}
                        <span className="font-mono text-xs text-muted">{r.pilot.airlines}</span>
                        {r.result ? <Badge tone={trainingResults[r.result].tone}>{trainingResults[r.result].label}</Badge> : null}
                      </li>
                    ))}
                </ul>
              )}
            </Panel>
          )}
        </>
      ) : null}
    </div>
  );
}
