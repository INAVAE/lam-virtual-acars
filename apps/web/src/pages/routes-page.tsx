import { zodResolver } from '@hookform/resolvers/zod';
import { OPERATION_TYPES, type RouteImportResult, type RouteImportRow } from '@lam/shared-types';
import { ArrowRight, FileDown, FileUp, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { AirportPicker } from '@/components/airport-picker';
import { ConfirmButton } from '@/components/confirm-button';
import { ScopeRequired } from '@/components/scope-required';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog } from '@/components/ui/dialog';
import { Field, fieldAria } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyRow, Table, Td, Th } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useAircraftTypes, type AircraftType } from '@/hooks/use-fleet';
import type { Airline } from '@/hooks/use-lam-data';
import {
  useDeleteRoute,
  useImportRoutes,
  useRoutes,
  useSaveRoute,
  type RouteFilters,
  type RouteRow,
} from '@/hooks/use-routes';
import { csvCell, csvToObjects } from '@/lib/csv';
import { describeError } from '@/lib/errors';
import { formatNumber, operationTypeLabel, operationTypeLabels } from '@/lib/format';
import { useAirlinePermissions } from '@/lib/permissions';
import { ALL_DAYS, WEEKDAYS, formatDays, formatDuration } from '@/lib/schedule';
import { ScheduleTimeText } from '@/lib/time-context';

const PAGE_SIZE = 50;

// -----------------------------------------------------------------------------
// Ruta
// -----------------------------------------------------------------------------
const routeSchema = z
  .object({
    flight_number: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[0-9]{1,4}[A-Z]?$/, 'De 1 a 4 dígitos y una letra opcional, por ejemplo 123 o 123A'),
    origin_airport_id: z.number({ invalid_type_error: 'Elige el origen' }).nullable(),
    destination_airport_id: z.number({ invalid_type_error: 'Elige el destino' }).nullable(),
    aircraft_type_ids: z.array(z.number()).min(1, 'Elige al menos un tipo de aeronave'),
    departure_time_utc: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/, 'Usa formato HH:MM'),
    days_of_week: z.number().int().min(1, 'Elige al menos un día').max(127),
    estimated_minutes: z.preprocess(
      (v) => (v === '' || v === null || v === undefined ? null : Number(v)),
      z.number().int('Usa minutos enteros').min(10, 'Mínimo 10 minutos').max(1440, 'Máximo 24 horas').nullable(),
    ),
    operation_type: z.enum(OPERATION_TYPES),
    is_active: z.boolean(),
    notes: z.string().trim().max(500, 'Máximo 500 caracteres'),
  })
  .superRefine((v, ctx) => {
    if (v.origin_airport_id === null) ctx.addIssue({ code: 'custom', path: ['origin_airport_id'], message: 'Elige el origen' });
    if (v.destination_airport_id === null)
      ctx.addIssue({ code: 'custom', path: ['destination_airport_id'], message: 'Elige el destino' });
    if (v.origin_airport_id !== null && v.origin_airport_id === v.destination_airport_id)
      ctx.addIssue({ code: 'custom', path: ['destination_airport_id'], message: 'El destino debe ser distinto del origen' });
  });
type RouteForm = z.infer<typeof routeSchema>;

function typeIdsOf(route: RouteRow | null): number[] {
  return route?.route_aircraft_types.map((t) => t.aircraft_type_id) ?? [];
}

function RouteDialog({
  airline,
  route,
  types,
  onClose,
}: {
  airline: Airline;
  route: RouteRow | null;
  types: AircraftType[];
  onClose: () => void;
}) {
  const save = useSaveRoute();
  const previousTypeIds = typeIdsOf(route);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RouteForm>({
    resolver: zodResolver(routeSchema),
    defaultValues: {
      flight_number: route?.flight_number ?? '',
      origin_airport_id: route?.origin_airport_id ?? null,
      destination_airport_id: route?.destination_airport_id ?? null,
      aircraft_type_ids: previousTypeIds,
      departure_time_utc: route?.departure_time_utc?.slice(0, 5) ?? '',
      days_of_week: route?.days_of_week ?? ALL_DAYS,
      estimated_minutes: route ? route.estimated_minutes : null,
      operation_type: (route?.operation_type as RouteForm['operation_type']) ?? (airline.operation_type === 'cargo' ? 'cargo' : 'passenger'),
      is_active: route?.is_active ?? true,
      notes: route?.notes ?? '',
    },
  });

  async function onSubmit(values: RouteForm) {
    try {
      await save.mutateAsync({
        id: route?.id,
        values: {
          airline_id: airline.id,
          flight_number: values.flight_number,
          origin_airport_id: values.origin_airport_id!,
          destination_airport_id: values.destination_airport_id!,
          departure_time_utc: values.departure_time_utc || null,
          days_of_week: values.days_of_week,
          estimated_minutes: values.estimated_minutes,
          operation_type: values.operation_type,
          is_active: values.is_active,
          notes: values.notes || null,
        },
        aircraftTypeIds: values.aircraft_type_ids,
        previousTypeIds,
      });
      toast.success(route ? 'Ruta actualizada' : 'Ruta creada');
      onClose();
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  return (
    <Dialog
      open
      size="xl"
      onClose={onClose}
      title={route ? `Editar ${airline.icao_code ?? ''}${route.flight_number}` : 'Nueva ruta'}
      description="La distancia se calcula sola. Si dejas la duración vacía, se estima a 430 kt más 30 minutos."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="route-form" loading={isSubmitting}>
            {route ? 'Guardar cambios' : 'Crear ruta'}
          </Button>
        </>
      }
    >
      <form id="route-form" onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 md:grid-cols-2">
        <Field id="r-number" label="Número de vuelo" error={errors.flight_number?.message} hint={`Se mostrará como ${airline.icao_code ?? 'ICAO'} + número.`}>
          <Input className="font-mono uppercase" {...fieldAria('r-number', errors.flight_number?.message)} {...register('flight_number')} />
        </Field>
        <Field id="r-operation" label="Tipo de operación">
          <Select id="r-operation" {...register('operation_type')}>
            {OPERATION_TYPES.map((o) => (
              <option key={o} value={o}>
                {operationTypeLabels[o]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="r-origin" label="Origen" error={errors.origin_airport_id?.message}>
          <Controller
            control={control}
            name="origin_airport_id"
            render={({ field }) => (
              <AirportPicker id="r-origin" value={field.value} onChange={field.onChange} invalid={Boolean(errors.origin_airport_id)} />
            )}
          />
        </Field>
        <Field id="r-destination" label="Destino" error={errors.destination_airport_id?.message}>
          <Controller
            control={control}
            name="destination_airport_id"
            render={({ field }) => (
              <AirportPicker
                id="r-destination"
                value={field.value}
                onChange={field.onChange}
                invalid={Boolean(errors.destination_airport_id)}
              />
            )}
          />
        </Field>
        <Field id="r-time" label="Salida programada (UTC)" error={errors.departure_time_utc?.message} hint="Opcional. Formato de 24 horas, HH:MM.">
          <Input
            className="font-mono"
            inputMode="numeric"
            placeholder="14:30"
            maxLength={5}
            {...fieldAria('r-time', errors.departure_time_utc?.message)}
            {...register('departure_time_utc')}
          />
        </Field>
        <Field id="r-minutes" label="Duración estimada (minutos)" error={errors.estimated_minutes?.message} hint="Opcional.">
          <Input type="number" inputMode="numeric" {...fieldAria('r-minutes', errors.estimated_minutes?.message)} {...register('estimated_minutes')} />
        </Field>

        <fieldset className="md:col-span-2">
          <legend className="mb-2 text-sm font-medium">Días de operación</legend>
          <Controller
            control={control}
            name="days_of_week"
            render={({ field }) => (
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((d) => {
                  const on = (field.value & d.bit) !== 0;
                  return (
                    <button
                      key={d.bit}
                      type="button"
                      aria-pressed={on}
                      title={d.name}
                      onClick={() => field.onChange(on ? field.value & ~d.bit : field.value | d.bit)}
                      className={
                        on
                          ? 'h-9 w-11 rounded-md bg-accent font-medium text-accent-ink'
                          : 'h-9 w-11 rounded-md border border-line text-muted hover:text-ink'
                      }
                    >
                      <span aria-hidden>{d.short}</span>
                      <span className="sr-only">{d.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          />
          {errors.days_of_week ? <p className="mt-1 text-sm text-danger-ink">{errors.days_of_week.message}</p> : null}
        </fieldset>

        <fieldset className="md:col-span-2">
          <legend className="mb-2 text-sm font-medium">Tipos de aeronave permitidos</legend>
          <Controller
            control={control}
            name="aircraft_type_ids"
            render={({ field }) => (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
                {types.map((t) => (
                  <Checkbox
                    key={t.id}
                    id={`r-type-${t.id}`}
                    label={
                      <>
                        <span className="font-mono">{t.icao_code}</span> <span className="text-muted">{t.model}</span>
                      </>
                    }
                    checked={field.value.includes(t.id)}
                    onChange={(e) =>
                      field.onChange(e.target.checked ? [...field.value, t.id] : field.value.filter((id) => id !== t.id))
                    }
                  />
                ))}
              </div>
            )}
          />
          {errors.aircraft_type_ids ? <p className="mt-1 text-sm text-danger-ink">{errors.aircraft_type_ids.message}</p> : null}
        </fieldset>

        <div className="md:col-span-2">
          <Field id="r-notes" label="Notas" error={errors.notes?.message}>
            <Textarea {...fieldAria('r-notes', errors.notes?.message)} {...register('notes')} />
          </Field>
        </div>
        <Checkbox id="r-active" label="Ruta activa" hint="Las rutas inactivas no se pueden reservar." {...register('is_active')} />
      </form>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Importación CSV
// -----------------------------------------------------------------------------
const TEMPLATE_HEADER = ['flight_number', 'origin', 'destination', 'aircraft_types', 'departure_time_utc', 'days', 'operation_type', 'estimated_minutes', 'active'];
const TEMPLATE_EXAMPLE = ['100', 'MMMX', 'MMGL', 'B738|A20N', '14:30', '1234567', 'passenger', '', 'true'];

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toImportRows(objects: Record<string, string>[]): RouteImportRow[] {
  return objects.map((o) => ({
    flight_number: o.flight_number ?? '',
    origin: o.origin ?? '',
    destination: o.destination ?? '',
    aircraft_types: o.aircraft_types ?? '',
    departure_time_utc: o.departure_time_utc ?? '',
    days: o.days ?? '',
    operation_type: o.operation_type ?? '',
    estimated_minutes: o.estimated_minutes ?? '',
    active: o.active ?? '',
  }));
}

function ImportRoutesDialog({ airline, onClose }: { airline: Airline; onClose: () => void }) {
  const importer = useImportRoutes();
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<RouteImportRow[]>([]);
  const [check, setCheck] = useState<RouteImportResult | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    setCheck(null);
    setReadError(null);
    setRows([]);
    if (!file) return;
    setFileName(file.name);
    if (file.size > 2 * 1024 * 1024) {
      setReadError('El archivo pesa más de 2 MB. Divídelo en varios.');
      return;
    }
    const objects = csvToObjects(await file.text());
    const missing = ['flight_number', 'origin', 'destination', 'aircraft_types'].filter((k) => !objects[0] || !(k in objects[0]));
    if (objects.length === 0) {
      setReadError('El archivo no tiene filas de datos.');
      return;
    }
    if (missing.length > 0) {
      setReadError(`Faltan columnas obligatorias: ${missing.join(', ')}. Descarga la plantilla para ver el formato.`);
      return;
    }
    if (objects.length > 2000) {
      setReadError('Importa como máximo 2000 rutas por archivo.');
      return;
    }
    const parsed = toImportRows(objects);
    setRows(parsed);
    try {
      setCheck(await importer.mutateAsync({ airlineId: airline.id, rows: parsed, dryRun: true }));
    } catch (error) {
      setReadError(describeError(error));
    }
  }

  async function commit() {
    try {
      const result = await importer.mutateAsync({ airlineId: airline.id, rows, dryRun: false });
      toast.success(`Importación terminada: ${result.created} rutas nuevas y ${result.updated} actualizadas`);
      onClose();
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  const canCommit = Boolean(check && check.errors.length === 0 && rows.length > 0);

  return (
    <Dialog
      open
      size="lg"
      onClose={() => !importer.isPending && onClose()}
      title={`Importar rutas de ${airline.name}`}
      description="Primero se revisa cada fila sin guardar nada. Si todas son válidas, se importan juntas; si una falla, no se guarda ninguna."
      footer={
        <>
          <Button variant="secondary" disabled={importer.isPending} onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!canCommit} loading={importer.isPending && canCommit} onClick={commit}>
            Importar {rows.length > 0 ? `${formatNumber(rows.length)} rutas` : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-md border border-line bg-bg p-3 text-sm">
          <p className="text-muted">
            Columnas: <span className="font-mono text-ink">{TEMPLATE_HEADER.join(', ')}</span>. Las cuatro primeras son obligatorias.
            Separa varios tipos con <span className="font-mono text-ink">|</span>. Días del 1 (lunes) al 7 (domingo). Hora en UTC. Si
            un número de vuelo ya existe, la ruta se actualiza.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 -ml-2"
            onClick={() => downloadText('plantilla-rutas.csv', `${TEMPLATE_HEADER.join(',')}\n${TEMPLATE_EXAMPLE.map(csvCell).join(',')}\n`)}
          >
            <FileDown className="size-4" aria-hidden />
            Descargar plantilla
          </Button>
        </div>

        <div>
          <label htmlFor="routes-file" className="mb-1.5 block text-sm font-medium">
            Archivo CSV
          </label>
          <input
            id="routes-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void onFile(e.target.files?.[0])}
            className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border file:border-line file:bg-surface-2 file:px-3 file:py-1.5 file:text-ink"
          />
          {fileName ? <p className="mt-1 text-sm text-muted">{fileName}</p> : null}
        </div>

        {readError ? <Alert tone="danger">{readError}</Alert> : null}
        {importer.isPending && !check ? <p className="text-sm text-muted">Revisando filas…</p> : null}

        {check ? (
          check.errors.length === 0 ? (
            <Alert tone="ok">Las {formatNumber(check.valid)} filas son válidas. Ya puedes importarlas.</Alert>
          ) : (
            <>
              <Alert tone="danger">
                {formatNumber(check.errors.length)} de {formatNumber(check.total)} filas tienen errores. Corrígelas en el archivo y vuelve a
                cargarlo.
              </Alert>
              <Table minWidth="32rem" className="max-h-72 overflow-y-auto">
                <thead>
                  <tr>
                    <Th className="w-16">Fila</Th>
                    <Th className="w-24">Vuelo</Th>
                    <Th>Error</Th>
                  </tr>
                </thead>
                <tbody>
                  {check.errors.slice(0, 200).map((e) => (
                    <tr key={e.row}>
                      <Td className="tabular-nums">{e.row + 1}</Td>
                      <Td className="font-mono">{e.flight_number ?? ''}</Td>
                      <Td>{e.message}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          )
        ) : null}
      </div>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
function RoutesView({ airline }: { airline: Airline }) {
  const { canManage } = useAirlinePermissions(airline.id);
  const types = useAircraftTypes();
  const remove = useDeleteRoute();
  const [filters, setFilters] = useState<RouteFilters>({
    origin: '',
    destination: '',
    aircraftTypeId: null,
    status: 'all',
    page: 0,
    pageSize: PAGE_SIZE,
  });
  const [draft, setDraft] = useState({ origin: '', destination: '' });
  const [editing, setEditing] = useState<RouteRow | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
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
            <label htmlFor="rf-origin" className="mb-1 block text-sm text-muted">
              Origen
            </label>
            <Input
              id="rf-origin"
              className="font-mono uppercase"
              placeholder="MMMX"
              maxLength={4}
              value={draft.origin}
              onChange={(e) => setDraft((d) => ({ ...d, origin: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="rf-destination" className="mb-1 block text-sm text-muted">
              Destino
            </label>
            <Input
              id="rf-destination"
              className="font-mono uppercase"
              placeholder="MMGL"
              maxLength={4}
              value={draft.destination}
              onChange={(e) => setDraft((d) => ({ ...d, destination: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="rf-type" className="mb-1 block text-sm text-muted">
              Aeronave
            </label>
            <Select
              id="rf-type"
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
            <label htmlFor="rf-status" className="mb-1 block text-sm text-muted">
              Estado
            </label>
            <Select
              id="rf-status"
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as RouteFilters['status'], page: 0 }))}
            >
              <option value="all">Todas</option>
              <option value="active">Activas</option>
              <option value="inactive">Inactivas</option>
            </Select>
          </div>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setImporting(true)}>
              <FileUp className="size-4" aria-hidden />
              Importar CSV
            </Button>
            <Button onClick={() => setEditing('new')} disabled={!types.data}>
              <Plus className="size-4" aria-hidden />
              Nueva ruta
            </Button>
          </div>
        ) : null}
      </div>

      {routes.isError ? <Alert tone="danger">{describeError(routes.error)}</Alert> : null}

      {routes.isPending ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <Table minWidth="64rem">
            <thead>
              <tr>
                <Th>Vuelo</Th>
                <Th>Ruta</Th>
                <Th className="text-right">Distancia</Th>
                <Th className="text-right">Duración</Th>
                <Th>Salida</Th>
                <Th>Días</Th>
                <Th>Aeronaves</Th>
                <Th>Estado</Th>
                {canManage ? <Th className="text-right">Acciones</Th> : null}
              </tr>
            </thead>
            <tbody>
              {routes.data?.rows.length === 0 ? (
                <EmptyRow colSpan={canManage ? 9 : 8}>
                  {filters.origin || filters.destination || filters.aircraftTypeId || filters.status !== 'all'
                    ? 'Ninguna ruta coincide con los filtros.'
                    : canManage
                      ? 'Esta aerolínea no tiene rutas. Crea una o importa un CSV.'
                      : 'Esta aerolínea todavía no publica rutas.'}
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
                    <Td className="whitespace-nowrap">{r.departure_time_utc ? <ScheduleTimeText value={r.departure_time_utc} inline={false} /> : <span className="text-muted">Libre</span>}</Td>
                    <Td>{formatDays(r.days_of_week)}</Td>
                    <Td className="font-mono text-xs">
                      {r.route_aircraft_types.map((t) => t.aircraft_types?.icao_code).filter(Boolean).join(' ')}
                    </Td>
                    <Td>{r.is_active ? <Badge tone="ok">Activa</Badge> : <Badge>Inactiva</Badge>}</Td>
                    {canManage ? (
                      <Td className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="secondary" onClick={() => setEditing(r)} disabled={!types.data}>
                            Editar
                          </Button>
                          <ConfirmButton
                            size="sm"
                            variant="ghost"
                            title={`Eliminar ${code}${r.flight_number}`}
                            message="La ruta deja de existir. Los vuelos ya reservados conservan sus datos. Si solo quieres dejar de ofrecerla, desactívala."
                            confirmLabel="Eliminar"
                            onConfirm={async () => {
                              try {
                                await remove.mutateAsync({ id: r.id, airlineId: airline.id });
                                toast.success('Ruta eliminada');
                              } catch (error) {
                                toast.error(describeError(error));
                                throw error;
                              }
                            }}
                          >
                            Eliminar
                          </ConfirmButton>
                        </div>
                      </Td>
                    ) : null}
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

      {editing && types.data ? (
        <RouteDialog airline={airline} route={editing === 'new' ? null : editing} types={types.data} onClose={() => setEditing(null)} />
      ) : null}
      {importing ? <ImportRoutesDialog airline={airline} onClose={() => setImporting(false)} /> : null}
    </div>
  );
}

export function RoutesPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Routes" description="Rutas programadas de la aerolínea seleccionada. Cada ruta es una plantilla que generará vuelos." />
      <ScopeRequired>{(airline) => <RoutesView airline={airline} />}</ScopeRequired>
    </div>
  );
}
