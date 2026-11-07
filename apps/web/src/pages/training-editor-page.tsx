import { ArrowLeft, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Avatar } from '@/components/avatar';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useAircraftTypes } from '@/hooks/use-fleet';
import { useAirlines, useMyMemberships } from '@/hooks/use-lam-data';
import { useInstructorSearch, useSaveTraining, useTraining, useTrainings, type TrainingPerson } from '@/hooks/use-trainings';
import { useAirlineScope } from '@/lib/airline-scope';
import { describeError } from '@/lib/errors';
import { formatPilotNumber } from '@/lib/format';
import { formatMinutes } from '@/lib/pirep';
import { useTimePrefs } from '@/lib/time-context';
import { dualTime } from '@/lib/time';
import {
  isDiscordUrl,
  isoToZonedInput,
  trainingCategories,
  trainingLevels,
  zonedInputToIso,
  type TrainingCategory,
  type TrainingLevel,
} from '@/lib/training';

type InstructorMode = 'lam' | 'external';

function InstructorPicker({ value, onChange }: { value: TrainingPerson | null; onChange: (p: TrainingPerson | null) => void }) {
  const [query, setQuery] = useState('');
  const results = useInstructorSearch(query, value === null);
  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-line px-3 py-2">
        <Avatar name={value.display_name} url={value.avatar_url} size="xs" />
        <span className="text-sm">
          {value.display_name}
          {value.pilot_number ? <span className="ml-1.5 font-mono text-xs text-muted">{formatPilotNumber(value.pilot_number)}</span> : null}
        </span>
        <button type="button" className="ml-auto rounded p-1 text-muted hover:text-ink" onClick={() => onChange(null)} aria-label="Cambiar instructor">
          <X className="size-4" aria-hidden />
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input id="trn-instructor" className="pl-8" placeholder="Nombre o número LAM" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
      </div>
      {query.trim().length >= 2 ? (
        <ul className="max-h-48 overflow-y-auto rounded-md border border-line" aria-label="Pilotos encontrados">
          {(results.data ?? []).length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">{results.isFetching ? 'Buscando…' : 'Sin resultados'}</li>
          ) : (
            results.data!.map((p) => (
              <li key={p.user_id}>
                <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => onChange(p)}>
                  <Avatar name={p.display_name} url={p.avatar_url} size="xs" />
                  {p.display_name}
                  <span className="font-mono text-xs text-muted">{p.pilot_number ? formatPilotNumber(p.pilot_number) : ''}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

export function TrainingEditorPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const existing = useTraining(id);
  const list = useTrainings();
  const save = useSaveTraining();
  const types = useAircraftTypes();
  const airlines = useAirlines();
  const memberships = useMyMemberships();
  const { isOrgAdmin, selected } = useAirlineScope();
  const { timeZone, localLabel, primary } = useTimePrefs();

  const [zone, setZone] = useState<'UTC' | 'local'>(primary === 'local' ? 'local' : 'UTC');
  const inputZone = zone === 'UTC' ? 'UTC' : timeZone;
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<TrainingCategory>('flight_ops');
  const [level, setLevel] = useState<TrainingLevel>('basic');
  const [description, setDescription] = useState('');
  const [airlineId, setAirlineId] = useState(selected?.id ?? '');
  const [typeId, setTypeId] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [capacity, setCapacity] = useState('');
  const [mode, setMode] = useState<InstructorMode>('lam');
  const [instructor, setInstructor] = useState<TrainingPerson | null>(null);
  const [externalName, setExternalName] = useState('');
  const [discordUrl, setDiscordUrl] = useState('');
  const [discordChannel, setDiscordChannel] = useState('');
  const [materials, setMaterials] = useState('');
  const [tried, setTried] = useState(false);
  const [loaded, setLoaded] = useState(!editing);

  const t = existing.data;
  useEffect(() => {
    if (!editing || !t || loaded) return;
    setTitle(t.title);
    setCategory(t.category);
    setLevel(t.level);
    setDescription(t.description ?? '');
    setAirlineId(t.airline_id ?? '');
    setTypeId(t.aircraft_type_id ? String(t.aircraft_type_id) : '');
    setStart(isoToZonedInput(t.starts_at, inputZone));
    setEnd(isoToZonedInput(t.ends_at, inputZone));
    setCapacity(t.capacity ? String(t.capacity) : '');
    if (t.instructor_id && t.instructor) {
      setMode('lam');
      setInstructor(t.instructor);
    } else {
      setMode('external');
      setExternalName(t.instructor_name ?? '');
    }
    setDiscordUrl(t.discord_url ?? '');
    setDiscordChannel(t.discord_channel ?? '');
    setMaterials(t.materials_url ?? '');
    setLoaded(true);
  }, [editing, t, loaded, inputZone]);

  function changeZone(next: 'UTC' | 'local') {
    const nextZone = next === 'UTC' ? 'UTC' : timeZone;
    // Conserva el mismo instante al cambiar la zona en la que se captura.
    const s = zonedInputToIso(start, inputZone);
    const e = zonedInputToIso(end, inputZone);
    if (s) setStart(isoToZonedInput(s, nextZone));
    if (e) setEnd(isoToZonedInput(e, nextZone));
    setZone(next);
  }

  const myAirlines = useMemo(() => {
    const active = new Set((memberships.data ?? []).filter((m) => m.status === 'active').map((m) => m.airline_id));
    return (airlines.data ?? []).filter((a) => isOrgAdmin || active.has(a.id));
  }, [airlines.data, memberships.data, isOrgAdmin]);

  const startsIso = zonedInputToIso(start, inputZone);
  const endsIso = zonedInputToIso(end, inputZone);
  const errors = {
    title: title.trim().length < 3 ? 'Escribe el tema (al menos 3 caracteres)' : undefined,
    start: !startsIso ? 'Elige fecha y hora de inicio' : !editing && Date.parse(startsIso) < Date.now() ? 'Elige una fecha futura' : undefined,
    end: !endsIso
      ? 'Elige fecha y hora de fin'
      : startsIso && Date.parse(endsIso) <= Date.parse(startsIso)
        ? 'Debe ser posterior al inicio'
        : startsIso && Date.parse(endsIso) - Date.parse(startsIso) > 24 * 3_600_000
          ? 'Dura como máximo 24 horas'
          : undefined,
    instructor: mode === 'lam' ? (instructor ? undefined : 'Elige al instructor') : externalName.trim().length < 2 ? 'Escribe el nombre del instructor' : undefined,
    capacity: capacity && !(Number(capacity) >= 1 && Number(capacity) <= 500) ? 'De 1 a 500' : undefined,
    discord: discordUrl.trim() && !isDiscordUrl(discordUrl) ? 'Pega el enlace de invitación (https://discord.gg/…) o del canal (https://discord.com/channels/…)' : undefined,
    materials: materials.trim() && !/^https:\/\/\S+$/.test(materials.trim()) ? 'Un enlace https://' : undefined,
  };
  const show = (e: string | undefined) => (tried ? e : undefined);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (Object.values(errors).some(Boolean) || !startsIso || !endsIso) return;
    try {
      const savedId = await save.mutateAsync({
        id: id ?? null,
        input: {
          title: title.trim(),
          category,
          level,
          description: description.trim() || null,
          aircraft_type_id: typeId ? Number(typeId) : null,
          airline_id: airlineId || null,
          starts_at: startsIso,
          ends_at: endsIso,
          capacity: capacity ? Number(capacity) : null,
          instructor_id: mode === 'lam' ? (instructor?.user_id ?? null) : null,
          instructor_name: mode === 'external' ? externalName.trim() : null,
          discord_url: discordUrl.trim() || null,
          discord_channel: discordChannel.trim() || null,
          materials_url: materials.trim() || null,
        },
      });
      toast.success(editing ? 'Entrenamiento actualizado' : 'Entrenamiento programado');
      navigate(`/training/${savedId}`, { replace: true });
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  const preview = (iso: string | null) => {
    if (!iso) return null;
    const d = dualTime(iso, timeZone, 'utc', { withDate: true });
    return d.secondary ? `${d.primary} · ${d.secondary}` : d.primary;
  };

  if (editing && existing.isPending) return <Skeleton className="h-96" />;
  if (editing && existing.isError) return <Alert tone="danger">{describeError(existing.error)}</Alert>;
  if (editing && t && !t.can_manage) return <Alert tone="danger">Solo quien programó el entrenamiento o su instructor lo modifican.</Alert>;
  if (!editing && list.data && !list.data.can_create) {
    return <Alert tone="danger">Solo los administradores y jefes de operaciones de una aerolínea programan entrenamientos.</Alert>;
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <Link to={editing ? `/training/${id}` : '/training'} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        {editing ? 'Regresar al entrenamiento' : 'Training'}
      </Link>
      <PageHeader
        title={editing ? `Editar ${t?.folio ?? ''}` : 'Programar entrenamiento'}
        description="Cualquier piloto de cualquier aerolínea podrá solicitar su lugar; tú (o el instructor) confirmas cada participación."
      />

      <Panel title="Tema">
        <div className="grid gap-4 md:grid-cols-2">
          <Field id="trn-title" label="Título" error={show(errors.title)}>
            <Input id="trn-title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej. SOP del A320: del arranque al despegue" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field id="trn-category" label="Categoría">
              <Select id="trn-category" value={category} onChange={(e) => setCategory(e.target.value as TrainingCategory)}>
                {Object.entries(trainingCategories).map(([k, c]) => (
                  <option key={k} value={k}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="trn-level" label="Nivel">
              <Select id="trn-level" value={level} onChange={(e) => setLevel(e.target.value as TrainingLevel)}>
                {Object.entries(trainingLevels).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field id="trn-description" label="Descripción" hint="Qué se verá, requisitos previos y qué tener listo (simulador, aeronave, cartas).">
            <Textarea id="trn-description" rows={5} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div className="grid content-start gap-4">
            <Field id="trn-type" label="Aeronave (opcional)">
              <Select id="trn-type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                <option value="">Ninguna en particular</option>
                {(types.data ?? []).map((at) => (
                  <option key={at.id} value={at.id}>
                    {at.icao_code} · {at.manufacturer} {at.model}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="trn-airline" label="Organiza (opcional)" hint="Se muestra como organizadora; la inscripción sigue abierta a todas las aerolíneas.">
              <Select id="trn-airline" value={airlineId} onChange={(e) => setAirlineId(e.target.value)}>
                <option value="">LAM (todas las aerolíneas)</option>
                {myAirlines.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
      </Panel>

      <Panel title="Fecha y hora" description="Se guarda en UTC. Los pilotos la ven en Zulu y en su hora local.">
        <div className="space-y-4">
          <div className="inline-flex rounded-md border border-line p-0.5" role="group" aria-label="Zona en la que capturas">
            {(['UTC', 'local'] as const).map((z) => (
              <button
                key={z}
                type="button"
                aria-pressed={zone === z}
                onClick={() => changeZone(z)}
                className={zone === z ? 'h-8 rounded bg-accent px-3 text-sm text-accent-ink' : 'h-8 rounded px-3 text-sm text-muted hover:text-ink'}
              >
                {z === 'UTC' ? 'Capturar en Zulu (UTC)' : `Capturar en mi hora local (${localLabel})`}
              </button>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Field id="trn-start" label={`Inicio (${zone === 'UTC' ? 'UTC' : localLabel})`} error={show(errors.start)} hint={preview(startsIso) ?? undefined}>
              <Input id="trn-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field id="trn-end" label={`Fin (${zone === 'UTC' ? 'UTC' : localLabel})`} error={show(errors.end)} hint={preview(endsIso) ?? undefined}>
              <Input id="trn-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
            <Field id="trn-capacity" label="Cupo (opcional)" error={show(errors.capacity)} hint="Sin cupo, cabe quien confirmes.">
              <Input id="trn-capacity" type="number" min={1} max={500} inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </Field>
          </div>
          {startsIso && endsIso && Date.parse(endsIso) > Date.parse(startsIso) ? (
            <p className="text-sm text-muted">Duración: {formatMinutes(Math.round((Date.parse(endsIso) - Date.parse(startsIso)) / 60_000))}</p>
          ) : null}
        </div>
      </Panel>

      <Panel title="Instructor" description="Un piloto de LAM (también podrá confirmar inscripciones y pasar lista) o un instructor externo.">
        <div className="space-y-3">
          <div className="inline-flex rounded-md border border-line p-0.5" role="group" aria-label="Tipo de instructor">
            {(['lam', 'external'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={mode === m ? 'h-8 rounded bg-accent px-3 text-sm text-accent-ink' : 'h-8 rounded px-3 text-sm text-muted hover:text-ink'}
              >
                {m === 'lam' ? 'Piloto de LAM' : 'Externo'}
              </button>
            ))}
          </div>
          <div className="max-w-md">
            {mode === 'lam' ? (
              <Field id="trn-instructor" label="Instructor" error={show(errors.instructor)}>
                <InstructorPicker value={instructor} onChange={setInstructor} />
              </Field>
            ) : (
              <Field id="trn-external" label="Nombre del instructor" error={show(errors.instructor)}>
                <Input id="trn-external" maxLength={80} value={externalName} onChange={(e) => setExternalName(e.target.value)} />
              </Field>
            )}
          </div>
        </div>
      </Panel>

      <Panel title="Dónde se da" description="El canal de Discord donde será el entrenamiento y, si hay, el material de apoyo.">
        <div className="grid gap-4 md:grid-cols-3">
          <Field id="trn-discord" label="Enlace de Discord" error={show(errors.discord)}>
            <Input id="trn-discord" type="url" placeholder="https://discord.gg/…" value={discordUrl} onChange={(e) => setDiscordUrl(e.target.value)} />
          </Field>
          <Field id="trn-channel" label="Canal (opcional)">
            <Input id="trn-channel" maxLength={80} placeholder="#training-a320" value={discordChannel} onChange={(e) => setDiscordChannel(e.target.value)} />
          </Field>
          <Field id="trn-materials" label="Material (opcional)" error={show(errors.materials)}>
            <Input id="trn-materials" type="url" placeholder="https://…" value={materials} onChange={(e) => setMaterials(e.target.value)} />
          </Field>
        </div>
      </Panel>

      {tried && Object.values(errors).some(Boolean) ? <Alert tone="danger">Revisa los campos marcados.</Alert> : null}
      <div className="flex justify-end gap-2">
        <Link to={editing ? `/training/${id}` : '/training'} className="inline-flex h-10 items-center rounded-md border border-line px-4 text-sm hover:bg-surface-2">
          Cancelar
        </Link>
        <Button type="submit" loading={save.isPending}>
          {editing ? 'Guardar cambios' : 'Programar'}
        </Button>
      </div>
    </form>
  );
}
