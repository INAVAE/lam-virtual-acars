import { ArrowDown, ArrowLeft, ArrowUp, ImagePlus, Plus, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { AirportPicker } from '@/components/airport-picker';
import { TourBadge } from '@/components/tour-badge';
import { Alert } from '@/components/ui/alert';
import { Button, buttonClasses } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useAircraftTypes } from '@/hooks/use-fleet';
import { useAirlines, useMyMemberships } from '@/hooks/use-lam-data';
import { MAX_BADGE_BYTES, uploadTourBadge, useSaveTour, useTour, type LegInput, type TourInput } from '@/hooks/use-tours';
import { useAirlineScope } from '@/lib/airline-scope';
import { cn } from '@/lib/cn';
import { describeError } from '@/lib/errors';
import { normalizeTourCode, TOUR_CODE_PATTERN, TOUR_COLORS, type TourDetail } from '@/lib/tours';

interface LegDraft {
  key: number;
  origin: number | null;
  destination: number | null;
  notes: string;
}

let legKey = 0;
const newLeg = (origin: number | null = null): LegDraft => ({ key: ++legKey, origin, destination: null, notes: '' });

function TourEditor({ initial }: { initial: TourDetail | null }) {
  const navigate = useNavigate();
  const save = useSaveTour();
  const types = useAircraftTypes();
  const airlines = useAirlines();
  const memberships = useMyMemberships();
  const { selected, isOrgAdmin } = useAirlineScope();
  const locked = initial !== null && (initial.status === 'published' || initial.status === 'closed');

  const myAirlines = useMemo(() => {
    const active = new Set((memberships.data ?? []).filter((m) => m.status === 'active').map((m) => m.airline_id));
    return (airlines.data ?? []).filter((a) => isOrgAdmin || active.has(a.id));
  }, [airlines.data, memberships.data, isOrgAdmin]);

  const [airlineId, setAirlineId] = useState(initial?.airline.id ?? selected?.id ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [color, setColor] = useState(initial?.color ?? TOUR_COLORS[0]);
  const [startsOn, setStartsOn] = useState(initial?.starts_on ?? '');
  const [endsOn, setEndsOn] = useState(initial?.ends_on ?? '');
  const [ordered, setOrdered] = useState(initial?.ordered_legs ?? true);
  const [allowUnreviewed, setAllowUnreviewed] = useState(initial?.allow_unreviewed_progress ?? true);
  const [maxUnreviewed, setMaxUnreviewed] = useState(String(initial?.max_unreviewed_legs ?? 2));
  const [autoApprove, setAutoApprove] = useState(initial?.auto_approve_same_airline ?? false);
  const [typeIds, setTypeIds] = useState<number[]>(initial?.aircraft_type_ids ?? []);
  const [legs, setLegs] = useState<LegDraft[]>(() =>
    initial && initial.legs.length > 0
      ? initial.legs.map((l) => ({ key: ++legKey, origin: l.origin.id, destination: l.destination.id, notes: l.notes ?? '' }))
      : [newLeg()],
  );
  const [badgeFile, setBadgeFile] = useState<File | null>(null);
  const [badgePath, setBadgePath] = useState(initial?.badge_path ?? null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (badgeFile ? URL.createObjectURL(badgeFile) : badgePath), [badgeFile, badgePath]);

  const normalizedCode = normalizeTourCode(code);
  const max = Number(maxUnreviewed);
  const errors = {
    airline: !airlineId ? 'Elige la aerolínea del tour' : undefined,
    code: !TOUR_CODE_PATTERN.test(normalizedCode) ? 'De 3 a 16 letras, números o guiones; por ejemplo TMX-01' : undefined,
    name: name.trim().length < 3 ? 'Escribe el nombre (3 caracteres o más)' : undefined,
    dates: startsOn && endsOn && endsOn < startsOn ? 'El fin no puede ser antes del inicio' : undefined,
    max: allowUnreviewed && !(Number.isInteger(max) && max >= 1 && max <= 20) ? 'De 1 a 20' : undefined,
    legs: !locked && (legs.length === 0 || legs.some((l) => !l.origin || !l.destination || l.origin === l.destination))
      ? 'Cada leg necesita origen y destino distintos'
      : undefined,
  };
  const invalid = Object.values(errors).some(Boolean);
  const show = (e: string | undefined) => (tried ? e : undefined);

  const groupedTypes = useMemo(() => {
    const list = types.data ?? [];
    const order = ['light', 'business_jet', 'turboprop', 'regional_jet', 'narrowbody', 'widebody', 'jumbo'];
    return [...list].sort((a, b) => order.indexOf(a.map_category) - order.indexOf(b.map_category) || a.icao_code.localeCompare(b.icao_code));
  }, [types.data]);

  function updateLeg(i: number, patch: Partial<LegDraft>) {
    setLegs((cur) => cur.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  }
  function moveLeg(i: number, dir: -1 | 1) {
    setLegs((cur) => {
      const next = [...cur];
      const j = i + dir;
      if (j < 0 || j >= next.length) return cur;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }

  function onFile(file: File | undefined) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast.error('Usa una imagen PNG, JPG o WebP.');
      return;
    }
    if (file.size > MAX_BADGE_BYTES) {
      toast.error('La insignia debe pesar menos de 512 KB.');
      return;
    }
    setBadgeFile(file);
  }

  async function submit() {
    setTried(true);
    if (invalid) return;
    setBusy(true);
    const tour: TourInput = {
      ...(initial ? {} : { airline_id: airlineId }),
      code: normalizedCode,
      name: name.trim(),
      description: description.trim() || null,
      color,
      badge_path: badgePath,
      aircraft_type_ids: typeIds,
      starts_on: startsOn || null,
      ends_on: endsOn || null,
      ordered_legs: ordered,
      allow_unreviewed_progress: allowUnreviewed,
      max_unreviewed_legs: allowUnreviewed ? max : 1,
      auto_approve_same_airline: autoApprove,
    };
    const legInput: LegInput[] | null = locked
      ? null
      : legs.map((l) => ({ origin_airport_id: l.origin!, destination_airport_id: l.destination!, notes: l.notes.trim() || null }));
    try {
      const id = await save.mutateAsync({ id: initial?.id ?? null, tour, legs: legInput });
      if (badgeFile) {
        try {
          const url = await uploadTourBadge(id, badgeFile);
          await save.mutateAsync({ id, tour: { ...tour, badge_path: url }, legs: null });
        } catch (error) {
          toast.error(`El tour se guardó, pero la insignia no: ${describeError(error)}`);
        }
      }
      toast.success(initial ? 'Tour actualizado' : 'Tour creado en borrador. Revísalo y envíalo para publicarlo.');
      void navigate(`/tours/${id}`);
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Link to={initial ? `/tours/${initial.id}` : '/tours'} className={buttonClasses('ghost', 'sm')}>
        <ArrowLeft className="size-4" aria-hidden />
        {initial ? initial.code : 'Tours'}
      </Link>
      <PageHeader
        title={initial ? `Editar ${initial.code}` : 'Crear tour'}
        description="Si no administras la aerolínea, el tour se publica cuando su administrador lo aprueba."
      />
      {locked ? <Alert tone="info">El tour ya está publicado: su código, sus legs y los tipos de aeronave quedan fijos. Puedes cambiar lo demás.</Alert> : null}
      {tried && invalid ? <Alert tone="danger">Revisa los campos marcados.</Alert> : null}

      <Panel title="Datos del tour">
        <div className="grid gap-4 md:grid-cols-2">
          {initial ? null : (
            <Field id="tour-airline" label="Aerolínea del tour" error={show(errors.airline)} hint="Sus administradores aprueban el tour. Pilotos de cualquier aerolínea pueden inscribirse.">
              <Select id="tour-airline" value={airlineId} onChange={(e) => setAirlineId(e.target.value)}>
                <option value="">Elige una aerolínea</option>
                {myAirlines.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field id="tour-code" label="Código" error={show(errors.code)} hint="Único. Aparece en el mapa en vivo.">
            <Input id="tour-code" className="font-mono uppercase" value={code} disabled={locked} onChange={(e) => setCode(e.target.value)} maxLength={16} />
          </Field>
          <Field id="tour-name" label="Nombre" error={show(errors.name)}>
            <Input id="tour-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          <div className="md:col-span-2">
            <Field id="tour-description" label="Descripción">
              <Textarea id="tour-description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} />
            </Field>
          </div>
          <Field id="tour-start" label="Inicio (opcional)">
            <Input id="tour-start" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </Field>
          <Field id="tour-end" label="Fin (opcional)" error={show(errors.dates)}>
            <Input id="tour-end" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </Field>
          <fieldset className="md:col-span-2">
            <legend className="mb-2 text-sm font-medium">Color en el mapa</legend>
            <div className="flex flex-wrap items-center gap-2">
              {TOUR_COLORS.map((c) => (
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

      <Panel title="Insignia" description="La ganan los pilotos que terminan el tour con todos sus legs aceptados. PNG, JPG o WebP de hasta 512 KB, de preferencia cuadrada.">
        <div className="flex flex-wrap items-center gap-4">
          <TourBadge code={normalizedCode || 'TOUR'} color={color} badgePath={preview} size="lg" />
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            <ImagePlus className="size-4" aria-hidden />
            {preview ? 'Cambiar imagen' : 'Subir imagen'}
          </Button>
          {preview ? (
            <Button
              variant="ghost"
              onClick={() => {
                setBadgeFile(null);
                setBadgePath(null);
              }}
            >
              Quitar
            </Button>
          ) : null}
        </div>
      </Panel>

      <Panel title="Reglas">
        <div className="grid gap-4 md:grid-cols-2">
          <Checkbox
            id="tour-ordered"
            label="Los legs se vuelan en orden"
            hint="Sin marcar, el piloto elige el orden."
            checked={ordered}
            disabled={locked}
            onChange={(e) => setOrdered(e.target.checked)}
          />
          <Checkbox
            id="tour-auto"
            label="Aprobar sin revisión a pilotos de la aerolínea del tour"
            hint="Los de otras aerolíneas siempre los aprueba el creador."
            checked={autoApprove}
            onChange={(e) => setAutoApprove(e.target.checked)}
          />
          <Checkbox
            id="tour-unreviewed"
            label="Seguir volando sin que el leg anterior esté revisado"
            hint="Sin marcar, cada leg debe tener su PIREP aceptado antes del siguiente."
            checked={allowUnreviewed}
            onChange={(e) => setAllowUnreviewed(e.target.checked)}
          />
          {allowUnreviewed ? (
            <Field id="tour-max" label="Máximo de legs en revisión a la vez" error={show(errors.max)}>
              <Input id="tour-max" type="number" min={1} max={20} inputMode="numeric" value={maxUnreviewed} onChange={(e) => setMaxUnreviewed(e.target.value)} className="w-28" />
            </Field>
          ) : null}
        </div>
      </Panel>

      <Panel title="Aeronaves permitidas" description="Sin ninguna marcada, se vuela con cualquier tipo. Cada piloto usa la flota de su propia aerolínea.">
        {types.isPending ? (
          <Skeleton className="h-24" />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2">
            {groupedTypes.map((t) => (
              <Checkbox
                key={t.id}
                id={`tour-type-${t.id}`}
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
      </Panel>

      <Panel
        title="Legs"
        description={locked ? 'Publicado: los legs no cambian.' : 'Cada leg es una ruta propia del tour; no tiene que existir en Routes.'}
        actions={
          locked ? null : (
            <Button size="sm" variant="secondary" disabled={legs.length >= 60} onClick={() => setLegs((cur) => [...cur, newLeg(cur[cur.length - 1]?.destination ?? null)])}>
              <Plus className="size-4" aria-hidden />
              Agregar leg
            </Button>
          )
        }
      >
        {show(errors.legs) ? <Alert tone="danger" className="mb-3">{errors.legs}</Alert> : null}
        {locked && initial ? (
          <ol className="space-y-1 text-sm">
            {initial.legs.map((l) => (
              <li key={l.id} className="font-mono">
                {l.leg_number}. {l.origin.icao} → {l.destination.icao}
              </li>
            ))}
          </ol>
        ) : (
          <ol className="space-y-3">
            {legs.map((leg, i) => (
              <li key={leg.key} className="grid gap-3 rounded-md border border-line bg-bg p-3 md:grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                <span className="font-mono text-lg font-semibold md:pb-2">{i + 1}</span>
                <Field id={`leg-${leg.key}-o`} label="Origen">
                  <AirportPicker id={`leg-${leg.key}-o`} value={leg.origin} onChange={(v) => updateLeg(i, { origin: v })} invalid={tried && !leg.origin} />
                </Field>
                <Field id={`leg-${leg.key}-d`} label="Destino">
                  <AirportPicker
                    id={`leg-${leg.key}-d`}
                    value={leg.destination}
                    onChange={(v) => updateLeg(i, { destination: v })}
                    invalid={tried && (!leg.destination || leg.destination === leg.origin)}
                  />
                </Field>
                <Field id={`leg-${leg.key}-n`} label="Notas (opcional)">
                  <Input id={`leg-${leg.key}-n`} value={leg.notes} onChange={(e) => updateLeg(i, { notes: e.target.value })} maxLength={500} />
                </Field>
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" aria-label={`Subir leg ${i + 1}`} disabled={i === 0} onClick={() => moveLeg(i, -1)}>
                    <ArrowUp className="size-4" aria-hidden />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Bajar leg ${i + 1}`} disabled={i === legs.length - 1} onClick={() => moveLeg(i, 1)}>
                    <ArrowDown className="size-4" aria-hidden />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Quitar leg ${i + 1}`}
                    disabled={legs.length === 1}
                    onClick={() => setLegs((cur) => cur.filter((_, n) => n !== i))}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </span>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <div className="flex justify-end gap-2">
        <Link to={initial ? `/tours/${initial.id}` : '/tours'} className={buttonClasses('secondary')}>
          Cancelar
        </Link>
        <Button loading={busy} onClick={() => void submit()}>
          {initial ? 'Guardar cambios' : 'Crear tour'}
        </Button>
      </div>
    </div>
  );
}

export function TourEditorPage() {
  const { id } = useParams();
  const tour = useTour(id);
  if (!id) return <TourEditor initial={null} />;
  if (tour.isPending) return <Skeleton className="h-96" />;
  if (tour.isError) return <Alert tone="danger">{describeError(tour.error)}</Alert>;
  if (!tour.data.can_edit) return <Alert tone="danger">Solo el creador del tour o un administrador de su aerolínea lo puede editar.</Alert>;
  return <TourEditor key={tour.data.id} initial={tour.data} />;
}
