import { ArrowLeft } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { AirportPicker } from '@/components/airport-picker';
import { SelectAll } from '@/components/select-all';
import { Alert } from '@/components/ui/alert';
import { Button, buttonClasses } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useEvent, useSaveEvent, type EventInput } from '@/hooks/use-events';
import { useAircraftTypes } from '@/hooks/use-fleet';
import { useAirlines, useMyMemberships } from '@/hooks/use-lam-data';
import { useAirlineScope } from '@/lib/airline-scope';
import { cn } from '@/lib/cn';
import { describeError } from '@/lib/errors';
import {
  criterionLabels,
  EVENT_COLORS,
  isoToUtcInput,
  scenarioHints,
  scenarioLabels,
  utcInputToIso,
  type EventDetail,
  type EventScenario,
  type PrizeCriterion,
} from '@/lib/events';

const SCENARIOS: EventScenario[] = ['same_origin_same_destination', 'any_origin_same_destination', 'same_origin_any_destination'];
const CRITERIA: PrizeCriterion[] = ['best_score', 'softest_landing', 'first_arrival', 'longest_distance'];

function EventEditor({ initial }: { initial: EventDetail | null }) {
  const navigate = useNavigate();
  const save = useSaveEvent();
  const types = useAircraftTypes();
  const airlines = useAirlines();
  const memberships = useMyMemberships();
  const { selected, isOrgAdmin } = useAirlineScope();
  const locked = initial?.status === 'published';

  const myAirlines = useMemo(() => {
    const active = new Set((memberships.data ?? []).filter((m) => m.status === 'active').map((m) => m.airline_id));
    return (airlines.data ?? []).filter((a) => isOrgAdmin || active.has(a.id));
  }, [airlines.data, memberships.data, isOrgAdmin]);

  const [airlineId, setAirlineId] = useState(initial?.airline.id ?? selected?.id ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [scenario, setScenario] = useState<EventScenario>(initial?.scenario ?? 'same_origin_same_destination');
  const [origin, setOrigin] = useState<number | null>(initial?.origin?.id ?? null);
  const [destination, setDestination] = useState<number | null>(initial?.destination?.id ?? null);
  const [startsAt, setStartsAt] = useState(isoToUtcInput(initial?.starts_at));
  const [endsAt, setEndsAt] = useState(isoToUtcInput(initial?.ends_at));
  const [color, setColor] = useState(initial?.color ?? EVENT_COLORS[0]);
  const [typeIds, setTypeIds] = useState<number[]>(initial?.aircraft_type_ids ?? []);
  const [airlineIds, setAirlineIds] = useState<string[]>(initial?.airline_ids ?? []);
  const [criterion, setCriterion] = useState<PrizeCriterion>(initial?.prize_criterion ?? 'best_score');
  const [places, setPlaces] = useState(String(initial?.prize_places ?? 3));
  const [prize, setPrize] = useState(initial?.prize_description ?? '');
  const [tried, setTried] = useState(false);

  const needsOrigin = scenario !== 'any_origin_same_destination';
  const needsDestination = scenario !== 'same_origin_any_destination';
  const startIso = utcInputToIso(startsAt);
  const endIso = utcInputToIso(endsAt);
  const placesNum = Number(places);
  const errors = {
    airline: !initial && !airlineId ? 'Elige la aerolínea del evento' : undefined,
    name: name.trim().length < 3 ? 'Escribe el nombre (3 caracteres o más)' : undefined,
    origin: needsOrigin && !origin ? 'Elige el aeropuerto de salida' : undefined,
    destination: needsDestination && !destination ? 'Elige el destino' : needsOrigin && needsDestination && origin === destination ? 'Debe ser distinto a la salida' : undefined,
    start: !startIso ? 'Indica la fecha y hora de inicio (UTC)' : undefined,
    end: !endIso
      ? 'Indica la fecha y hora de fin (UTC)'
      : startIso && Date.parse(endIso) <= Date.parse(startIso)
        ? 'El fin va después del inicio'
        : startIso && Date.parse(endIso) - Date.parse(startIso) > 31 * 86_400_000
          ? 'Un evento dura como máximo 31 días'
          : !initial && Date.parse(endIso) <= Date.now()
            ? 'El evento ya habría terminado'
            : undefined,
    places: !(Number.isInteger(placesNum) && placesNum >= 1 && placesNum <= 10) ? 'De 1 a 10' : undefined,
  };
  const invalid = Object.values(errors).some(Boolean);
  const show = (e: string | undefined) => (tried ? e : undefined);

  async function submit() {
    setTried(true);
    if (invalid || !startIso || !endIso) return;
    const event: EventInput = {
      ...(initial ? {} : { airline_id: airlineId }),
      name: name.trim(),
      description: description.trim() || null,
      scenario,
      origin_airport_id: needsOrigin ? origin : null,
      destination_airport_id: needsDestination ? destination : null,
      starts_at: startIso,
      ends_at: endIso,
      aircraft_type_ids: typeIds,
      airline_ids: airlineIds,
      color,
      prize_criterion: criterion,
      prize_description: prize.trim() || null,
      prize_places: placesNum,
    };
    try {
      const id = await save.mutateAsync({ id: initial?.id ?? null, event });
      toast.success(initial ? 'Evento actualizado' : 'Evento creado en borrador. Revísalo y envíalo para publicarlo.');
      void navigate(`/events/${id}`);
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  return (
    <div className="space-y-5">
      <Link to={initial ? `/events/${initial.id}` : '/events'} className={buttonClasses('ghost', 'sm')}>
        <ArrowLeft className="size-4" aria-hidden />
        {initial ? initial.folio : 'Eventos'}
      </Link>
      <PageHeader
        title={initial ? `Editar ${initial.folio}` : 'Crear evento'}
        description="El folio se asigna solo. Si no administras la aerolínea, el evento se publica cuando su administrador lo aprueba."
      />
      {locked ? <Alert tone="info">El evento ya está publicado: escenario, aeropuertos, horario, aeronaves, aerolíneas y premio quedan fijos. Puedes cambiar el nombre, la descripción, el color y el texto del premio.</Alert> : null}
      {tried && invalid ? <Alert tone="danger">Revisa los campos marcados.</Alert> : null}

      <Panel title="Datos del evento">
        <div className="grid gap-4 md:grid-cols-2">
          {initial ? null : (
            <Field id="ev-airline" label="Aerolínea organizadora" error={show(errors.airline)} hint="Sus administradores aprueban el evento.">
              <Select id="ev-airline" value={airlineId} onChange={(e) => setAirlineId(e.target.value)}>
                <option value="">Elige una aerolínea</option>
                {myAirlines.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field id="ev-name" label="Nombre" error={show(errors.name)}>
            <Input id="ev-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          <div className="md:col-span-2">
            <Field id="ev-description" label="Descripción">
              <Textarea id="ev-description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} />
            </Field>
          </div>
          <fieldset className="md:col-span-2">
            <legend className="mb-2 text-sm font-medium">Color en el mapa</legend>
            <div className="flex flex-wrap items-center gap-2">
              {EVENT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Color ${c}`}
                  aria-pressed={color === c}
                  className={cn('size-8 rounded-full border-2', color === c ? 'border-ink' : 'border-transparent')}
                  style={{ background: c }}
                />
              ))}
              <label className="ml-2 inline-flex items-center gap-2 text-sm text-muted">
                Otro
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-line bg-transparent" />
              </label>
              <span className="text-xs text-muted">Solo pinta la figura del avión; la trayectoria conserva los colores por fase.</span>
            </div>
          </fieldset>
        </div>
      </Panel>

      <Panel title="Escenario y horario" description="Las horas van en UTC (Zulu).">
        <div className="space-y-4">
          <fieldset>
            <legend className="sr-only">Escenario</legend>
            <div className="grid gap-2 md:grid-cols-3">
              {SCENARIOS.map((s) => (
                <label
                  key={s}
                  className={cn(
                    'flex cursor-pointer flex-col gap-1 rounded-md border p-3 text-sm',
                    scenario === s ? 'border-accent bg-accent/10' : 'border-line hover:border-muted',
                    locked && 'cursor-not-allowed opacity-70',
                  )}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <input type="radio" name="scenario" value={s} checked={scenario === s} disabled={locked} onChange={() => setScenario(s)} className="accent-[var(--accent)]" />
                    {scenarioLabels[s]}
                  </span>
                  <span className="text-xs text-muted">{scenarioHints[s]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 md:grid-cols-2">
            {needsOrigin ? (
              <Field id="ev-origin" label="Salida" error={show(errors.origin)}>
                <AirportPicker id="ev-origin" value={origin} onChange={setOrigin} disabled={locked} invalid={tried && Boolean(errors.origin)} />
              </Field>
            ) : (
              <p className="self-end text-sm text-muted">Cada piloto elige de dónde sale.</p>
            )}
            {needsDestination ? (
              <Field id="ev-destination" label="Llegada" error={show(errors.destination)}>
                <AirportPicker id="ev-destination" value={destination} onChange={setDestination} disabled={locked} invalid={tried && Boolean(errors.destination)} />
              </Field>
            ) : (
              <p className="self-end text-sm text-muted">Cada piloto elige a dónde vuela.</p>
            )}
            <Field id="ev-start" label="Inicio (UTC)" error={show(errors.start)}>
              <Input id="ev-start" type="datetime-local" value={startsAt} disabled={locked} onChange={(e) => setStartsAt(e.target.value)} />
            </Field>
            <Field id="ev-end" label="Fin (UTC)" error={show(errors.end)} hint="Las reservas abren 12 horas antes del inicio.">
              <Input id="ev-end" type="datetime-local" value={endsAt} disabled={locked} onChange={(e) => setEndsAt(e.target.value)} />
            </Field>
          </div>
        </div>
      </Panel>

      <Panel title="Premio" description="El ranking toma el mejor PIREP de cada piloto según el criterio que elijas.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field id="ev-criterion" label="Criterio">
            <Select id="ev-criterion" value={criterion} disabled={locked} onChange={(e) => setCriterion(e.target.value as PrizeCriterion)}>
              {CRITERIA.map((c) => (
                <option key={c} value={c}>
                  {criterionLabels[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="ev-places" label="Lugares con premio" error={show(errors.places)}>
            <Input id="ev-places" type="number" min={1} max={10} inputMode="numeric" value={places} disabled={locked} onChange={(e) => setPlaces(e.target.value)} className="w-28" />
          </Field>
          <div className="md:col-span-2">
            <Field id="ev-prize" label="Premio" hint="Qué ganan los primeros lugares, por ejemplo una insignia o una mención.">
              <Input id="ev-prize" value={prize} onChange={(e) => setPrize(e.target.value)} maxLength={500} />
            </Field>
          </div>
        </div>
      </Panel>

      <Panel title="Quién participa" description="Sin nada marcado, entra cualquier aerolínea y cualquier aeronave. Cada piloto vuela con la flota de su aerolínea.">
        <div className="space-y-4">
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">Aerolíneas</h3>
              <SelectAll all={(airlines.data ?? []).map((a) => a.id)} selected={airlineIds} onChange={setAirlineIds} disabled={locked} noun="todas" />
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2">
              {(airlines.data ?? []).map((a) => (
                <Checkbox
                  key={a.id}
                  id={`ev-airline-${a.id}`}
                  label={a.name}
                  checked={airlineIds.includes(a.id)}
                  disabled={locked}
                  onChange={(e) => setAirlineIds((cur) => (e.target.checked ? [...cur, a.id] : cur.filter((x) => x !== a.id)))}
                />
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">Aeronaves</h3>
              <SelectAll all={(types.data ?? []).map((t) => t.id)} selected={typeIds} onChange={setTypeIds} disabled={locked} />
            </div>
            {types.isPending ? (
              <Skeleton className="h-24" />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2">
                {(types.data ?? []).map((t) => (
                  <Checkbox
                    key={t.id}
                    id={`ev-type-${t.id}`}
                    label={
                      <>
                        <span className="font-mono font-medium">{t.icao_code}</span> {t.manufacturer} {t.model}
                      </>
                    }
                    checked={typeIds.includes(t.id)}
                    disabled={locked}
                    onChange={(e) => setTypeIds((cur) => (e.target.checked ? [...cur, t.id] : cur.filter((x) => x !== t.id)))}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </Panel>

      <div className="flex justify-end gap-2">
        <Link to={initial ? `/events/${initial.id}` : '/events'} className={buttonClasses('secondary')}>
          Cancelar
        </Link>
        <Button loading={save.isPending} onClick={() => void submit()}>
          {initial ? 'Guardar cambios' : 'Crear evento'}
        </Button>
      </div>
    </div>
  );
}

export function EventEditorPage() {
  const { id } = useParams();
  const event = useEvent(id);
  if (!id) return <EventEditor initial={null} />;
  if (event.isPending) return <Skeleton className="h-96" />;
  if (event.isError) return <Alert tone="danger">{describeError(event.error)}</Alert>;
  if (!event.data.can_edit) return <Alert tone="danger">Solo el creador del evento o un administrador de su aerolínea lo puede editar.</Alert>;
  return <EventEditor key={event.data.id} initial={event.data} />;
}
