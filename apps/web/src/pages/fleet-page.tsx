import { zodResolver } from '@hookform/resolvers/zod';
import { ENGINE_TYPES, MANUAL_AIRCRAFT_STATUSES, OPERATION_TYPES, WAKE_CATEGORIES, type AircraftStatus } from '@lam/shared-types';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { AirportPicker } from '@/components/airport-picker';
import { ConfirmButton } from '@/components/confirm-button';
import { ScopeRequired } from '@/components/scope-required';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, fieldAria } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyRow, Table, Td, Th } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  useAircraftTypes,
  useDeleteAircraft,
  useFleet,
  useSaveAircraft,
  useSaveAircraftType,
  type AircraftType,
  type FleetAircraft,
} from '@/hooks/use-fleet';
import type { Airline } from '@/hooks/use-lam-data';
import { useAirlineScope } from '@/lib/airline-scope';
import { describeError } from '@/lib/errors';
import {
  aircraftStatusLabels,
  aircraftStatusTone,
  engineTypeLabel,
  formatLocalDate,
  formatNumber,
  operationTypeLabel,
  operationTypeLabels,
  wakeCategoryLabel,
} from '@/lib/format';
import { useAirlinePermissions } from '@/lib/permissions';
import { formatHours } from '@/lib/schedule';

// -----------------------------------------------------------------------------
// Aeronave
// -----------------------------------------------------------------------------
const aircraftSchema = z.object({
  aircraft_type_id: z.coerce.number({ invalid_type_error: 'Elige un tipo' }).int().positive('Elige un tipo'),
  registration: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,9}$/, 'Usa letras, números y guiones, por ejemplo XA-LAM'),
  fleet_number: z.string().trim().max(12, 'Máximo 12 caracteres'),
  configuration: z.string().trim().max(60, 'Máximo 60 caracteres'),
  operation_type: z.enum(OPERATION_TYPES),
  // Un select deshabilitado no envía valor: el estado es opcional al guardar.
  status: z.enum(['available', 'assigned', 'in_flight', 'maintenance', 'out_of_service']).optional(),
  base_airport_id: z.number().nullable(),
  current_airport_id: z.number().nullable(),
  notes: z.string().trim().max(500, 'Máximo 500 caracteres'),
});
type AircraftForm = z.infer<typeof aircraftSchema>;

function AircraftDialog({
  airline,
  aircraft,
  types,
  onClose,
}: {
  airline: Airline;
  aircraft: FleetAircraft | null;
  types: AircraftType[];
  onClose: () => void;
}) {
  const save = useSaveAircraft();
  const systemStatus = aircraft !== null && !MANUAL_AIRCRAFT_STATUSES.includes(aircraft.status);
  const statusOptions: readonly AircraftStatus[] = aircraft && systemStatus ? [aircraft.status] : MANUAL_AIRCRAFT_STATUSES;
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AircraftForm>({
    resolver: zodResolver(aircraftSchema),
    defaultValues: {
      aircraft_type_id: aircraft?.aircraft_type_id ?? 0,
      registration: aircraft?.registration ?? '',
      fleet_number: aircraft?.fleet_number ?? '',
      configuration: aircraft?.configuration ?? '',
      operation_type: (aircraft?.operation_type as AircraftForm['operation_type']) ?? (airline.operation_type === 'cargo' ? 'cargo' : 'passenger'),
      status: aircraft?.status ?? 'available',
      base_airport_id: aircraft?.base_airport_id ?? null,
      current_airport_id: aircraft?.current_airport_id ?? null,
      notes: aircraft?.notes ?? '',
    },
  });

  async function onSubmit(values: AircraftForm) {
    try {
      await save.mutateAsync({
        id: aircraft?.id,
        values: {
          airline_id: airline.id,
          aircraft_type_id: values.aircraft_type_id,
          registration: values.registration,
          fleet_number: values.fleet_number || null,
          configuration: values.configuration || null,
          operation_type: values.operation_type,
          ...(systemStatus || !values.status ? {} : { status: values.status }),
          base_airport_id: values.base_airport_id,
          current_airport_id: values.current_airport_id,
          notes: values.notes || null,
        },
      });
      toast.success(aircraft ? 'Aeronave actualizada' : 'Aeronave agregada');
      onClose();
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={aircraft ? `Editar ${aircraft.registration}` : 'Agregar aeronave'}
      description="Horas, ciclos y último vuelo se actualizan solos con los PIREP aprobados."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="aircraft-form" loading={isSubmitting}>
            {aircraft ? 'Guardar cambios' : 'Agregar aeronave'}
          </Button>
        </>
      }
    >
      <form id="aircraft-form" onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field id="ac-type" label="Tipo de aeronave" error={errors.aircraft_type_id?.message}>
          <Select {...fieldAria('ac-type', errors.aircraft_type_id?.message)} {...register('aircraft_type_id')}>
            <option value={0}>Elige un tipo</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.icao_code} · {t.manufacturer} {t.model}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="ac-registration" label="Matrícula" error={errors.registration?.message}>
          <Input
            className="font-mono uppercase"
            autoComplete="off"
            {...fieldAria('ac-registration', errors.registration?.message)}
            {...register('registration')}
          />
        </Field>
        <Field id="ac-fleet" label="Número de flota" error={errors.fleet_number?.message} hint="Opcional, único en la aerolínea.">
          <Input {...fieldAria('ac-fleet', errors.fleet_number?.message, 'Opcional')} {...register('fleet_number')} />
        </Field>
        <Field id="ac-config" label="Configuración" error={errors.configuration?.message} hint="Por ejemplo Y186 o C12Y162.">
          <Input {...fieldAria('ac-config', errors.configuration?.message)} {...register('configuration')} />
        </Field>
        <Field id="ac-operation" label="Tipo de operación">
          <Select id="ac-operation" {...register('operation_type')}>
            {OPERATION_TYPES.map((o) => (
              <option key={o} value={o}>
                {operationTypeLabels[o]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="ac-status"
          label="Estado"
          hint={systemStatus ? 'La aeronave está asignada o en vuelo; el sistema cambia su estado.' : 'Asignada y En vuelo los pone el sistema.'}
        >
          <Select id="ac-status" disabled={systemStatus} {...register('status')}>
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {aircraftStatusLabels[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="ac-base" label="Base">
          <Controller
            control={control}
            name="base_airport_id"
            render={({ field }) => <AirportPicker id="ac-base" value={field.value} onChange={field.onChange} />}
          />
        </Field>
        <Field id="ac-current" label="Ubicación actual" hint="Se actualiza sola al aterrizar en la Fase 4.">
          <Controller
            control={control}
            name="current_airport_id"
            render={({ field }) => <AirportPicker id="ac-current" value={field.value} onChange={field.onChange} />}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field id="ac-notes" label="Notas" error={errors.notes?.message}>
            <Textarea {...fieldAria('ac-notes', errors.notes?.message)} {...register('notes')} />
          </Field>
        </div>
      </form>
    </Dialog>
  );
}

function FleetTable({ airline, canManage }: { airline: Airline; canManage: boolean }) {
  const fleet = useFleet(airline.id);
  const types = useAircraftTypes();
  const remove = useDeleteAircraft();
  const [editing, setEditing] = useState<FleetAircraft | 'new' | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const rows = useMemo(
    () =>
      (fleet.data ?? []).filter(
        (a) => (!typeFilter || String(a.aircraft_type_id) === typeFilter) && (!statusFilter || a.status === statusFilter),
      ),
    [fleet.data, typeFilter, statusFilter],
  );

  const counts = useMemo(() => {
    const all = fleet.data ?? [];
    return {
      total: all.length,
      available: all.filter((a) => a.status === 'available').length,
      hours: all.reduce((sum, a) => sum + a.total_minutes, 0),
    };
  }, [fleet.data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <dl className="flex flex-wrap gap-x-8 gap-y-2">
          <div>
            <dt className="text-sm text-muted">Aeronaves</dt>
            <dd className="font-display text-2xl font-semibold tabular-nums">{counts.total}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Disponibles</dt>
            <dd className="font-display text-2xl font-semibold tabular-nums">{counts.available}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Horas acumuladas</dt>
            <dd className="font-display text-2xl font-semibold tabular-nums">{formatHours(counts.hours)}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="fleet-type" className="sr-only">
              Filtrar por tipo
            </label>
            <Select id="fleet-type" className="w-44" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">Todos los tipos</option>
              {(types.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.icao_code} · {t.model}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="fleet-status" className="sr-only">
              Filtrar por estado
            </label>
            <Select id="fleet-status" className="w-48" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Todos los estados</option>
              {Object.entries(aircraftStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          {canManage ? (
            <Button onClick={() => setEditing('new')} disabled={!types.data}>
              <Plus className="size-4" aria-hidden />
              Agregar aeronave
            </Button>
          ) : null}
        </div>
      </div>

      {fleet.isError ? <Alert tone="danger">{describeError(fleet.error)}</Alert> : null}

      {fleet.isPending ? (
        <Skeleton className="h-48" />
      ) : (
        <Table minWidth="64rem">
          <thead>
            <tr>
              <Th>Matrícula</Th>
              <Th>Tipo</Th>
              <Th>Configuración</Th>
              <Th>Estado</Th>
              <Th>Base</Th>
              <Th>Ubicación</Th>
              <Th className="text-right">Horas</Th>
              <Th className="text-right">Ciclos</Th>
              <Th>Último vuelo</Th>
              {canManage ? <Th className="text-right">Acciones</Th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={canManage ? 10 : 9}>
                {fleet.data?.length
                  ? 'Ninguna aeronave coincide con los filtros.'
                  : canManage
                    ? 'La flota está vacía. Agrega la primera aeronave.'
                    : 'Esta aerolínea todavía no registra aeronaves.'}
              </EmptyRow>
            ) : (
              rows.map((a) => (
                <tr key={a.id}>
                  <Td>
                    <p className="font-mono font-medium">{a.registration}</p>
                    {a.fleet_number ? <p className="text-xs text-muted">Flota {a.fleet_number}</p> : null}
                  </Td>
                  <Td>
                    <p className="font-mono">{a.type?.icao_code}</p>
                    <p className="text-xs text-muted">
                      {a.type?.manufacturer} {a.type?.model}
                    </p>
                  </Td>
                  <Td>
                    <p>{a.configuration ?? <span className="text-muted">Sin definir</span>}</p>
                    <p className="text-xs text-muted">{operationTypeLabel(a.operation_type)}</p>
                  </Td>
                  <Td>
                    <Badge tone={aircraftStatusTone[a.status]}>{aircraftStatusLabels[a.status]}</Badge>
                  </Td>
                  <Td className="font-mono">{a.base?.icao_code ?? <span className="font-sans text-muted">Sin base</span>}</Td>
                  <Td className="font-mono">{a.current?.icao_code ?? <span className="font-sans text-muted">Sin registro</span>}</Td>
                  <Td className="text-right tabular-nums">{formatHours(a.total_minutes)}</Td>
                  <Td className="text-right tabular-nums">{formatNumber(a.cycles)}</Td>
                  <Td>{a.last_flight_at ? formatLocalDate(a.last_flight_at) : <span className="text-muted">Sin vuelos</span>}</Td>
                  {canManage ? (
                    <Td className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => setEditing(a)}>
                          Editar
                        </Button>
                        <ConfirmButton
                          size="sm"
                          variant="ghost"
                          title={`Eliminar ${a.registration}`}
                          message="La aeronave sale de la flota. Si ya tiene vuelos registrados, la base de datos no permitirá borrarla; ponla Fuera de servicio."
                          confirmLabel="Eliminar"
                          onConfirm={async () => {
                            try {
                              await remove.mutateAsync({ id: a.id, airlineId: airline.id });
                              toast.success('Aeronave eliminada');
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
      )}

      {editing && types.data ? (
        <AircraftDialog
          airline={airline}
          aircraft={editing === 'new' ? null : editing}
          types={types.data}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Tipos de aeronave
// -----------------------------------------------------------------------------
const optionalInt = (max: number) =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? null : Number(v)),
    z.number().int('Usa un número entero').min(0).max(max).nullable(),
  );

const typeSchema = z.object({
  icao_code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,3}$/, 'Designador ICAO de 2 a 4 caracteres, por ejemplo B738'),
  manufacturer: z.string().trim().min(2, 'Escribe el fabricante').max(60),
  model: z.string().trim().min(1, 'Escribe el modelo').max(80),
  wake_category: z.enum(WAKE_CATEGORIES),
  engine_type: z.enum(ENGINE_TYPES),
  max_passengers: optionalInt(900),
  max_cargo_kg: optionalInt(300000),
  cruise_speed_kts: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? null : Number(v)),
    z.number().int().min(60, 'Mínimo 60 kt').max(700, 'Máximo 700 kt').nullable(),
  ),
});
type TypeForm = z.infer<typeof typeSchema>;

function AircraftTypeDialog({ type, onClose }: { type: AircraftType | null; onClose: () => void }) {
  const save = useSaveAircraftType();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TypeForm>({
    resolver: zodResolver(typeSchema),
    defaultValues: {
      icao_code: type?.icao_code ?? '',
      manufacturer: type?.manufacturer ?? '',
      model: type?.model ?? '',
      wake_category: (type?.wake_category as TypeForm['wake_category']) ?? 'M',
      engine_type: (type?.engine_type as TypeForm['engine_type']) ?? 'jet',
      max_passengers: type?.max_passengers ?? null,
      max_cargo_kg: type?.max_cargo_kg ?? null,
      cruise_speed_kts: type?.cruise_speed_kts ?? null,
    },
  });

  async function onSubmit(values: TypeForm) {
    try {
      await save.mutateAsync({ id: type?.id, values });
      toast.success(type ? 'Tipo actualizado' : 'Tipo agregado');
      onClose();
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={type ? `Editar ${type.icao_code}` : 'Agregar tipo de aeronave'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="type-form" loading={isSubmitting}>
            {type ? 'Guardar cambios' : 'Agregar tipo'}
          </Button>
        </>
      }
    >
      <form id="type-form" onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field id="t-icao" label="Designador ICAO" error={errors.icao_code?.message}>
          <Input className="font-mono uppercase" disabled={Boolean(type)} {...fieldAria('t-icao', errors.icao_code?.message)} {...register('icao_code')} />
        </Field>
        <Field id="t-manufacturer" label="Fabricante" error={errors.manufacturer?.message}>
          <Input {...fieldAria('t-manufacturer', errors.manufacturer?.message)} {...register('manufacturer')} />
        </Field>
        <Field id="t-model" label="Modelo" error={errors.model?.message}>
          <Input {...fieldAria('t-model', errors.model?.message)} {...register('model')} />
        </Field>
        <Field id="t-wake" label="Estela turbulenta">
          <Select id="t-wake" {...register('wake_category')}>
            {WAKE_CATEGORIES.map((w) => (
              <option key={w} value={w}>
                {w} · {wakeCategoryLabel(w)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="t-engine" label="Motor">
          <Select id="t-engine" {...register('engine_type')}>
            {ENGINE_TYPES.map((e) => (
              <option key={e} value={e}>
                {engineTypeLabel(e)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="t-speed" label="Velocidad de crucero (kt)" error={errors.cruise_speed_kts?.message}>
          <Input type="number" inputMode="numeric" {...fieldAria('t-speed', errors.cruise_speed_kts?.message)} {...register('cruise_speed_kts')} />
        </Field>
        <Field id="t-pax" label="Pasajeros máximos" error={errors.max_passengers?.message}>
          <Input type="number" inputMode="numeric" {...fieldAria('t-pax', errors.max_passengers?.message)} {...register('max_passengers')} />
        </Field>
        <Field id="t-cargo" label="Carga máxima (kg)" error={errors.max_cargo_kg?.message}>
          <Input type="number" inputMode="numeric" {...fieldAria('t-cargo', errors.max_cargo_kg?.message)} {...register('max_cargo_kg')} />
        </Field>
      </form>
    </Dialog>
  );
}

function AircraftTypesTable() {
  const types = useAircraftTypes();
  const { isOrgAdmin } = useAirlineScope();
  const [editing, setEditing] = useState<AircraftType | 'new' | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-muted">
          Catálogo compartido por todas las aerolíneas. Las rutas y la flota solo pueden usar tipos de esta lista.
        </p>
        {isOrgAdmin ? (
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden />
            Agregar tipo
          </Button>
        ) : null}
      </div>
      {types.isPending ? (
        <Skeleton className="h-48" />
      ) : types.isError ? (
        <Alert tone="danger">{describeError(types.error)}</Alert>
      ) : (
        <Table minWidth="48rem">
          <thead>
            <tr>
              <Th>ICAO</Th>
              <Th>Aeronave</Th>
              <Th>Estela</Th>
              <Th>Motor</Th>
              <Th className="text-right">Pasajeros</Th>
              <Th className="text-right">Carga (kg)</Th>
              <Th className="text-right">Crucero (kt)</Th>
              {isOrgAdmin ? <Th className="text-right">Acciones</Th> : null}
            </tr>
          </thead>
          <tbody>
            {types.data.map((t) => (
              <tr key={t.id}>
                <Td className="font-mono font-medium">{t.icao_code}</Td>
                <Td>
                  {t.manufacturer} {t.model}
                </Td>
                <Td>{wakeCategoryLabel(t.wake_category)}</Td>
                <Td>{engineTypeLabel(t.engine_type)}</Td>
                <Td className="text-right tabular-nums">{t.max_passengers ?? '—'}</Td>
                <Td className="text-right tabular-nums">{t.max_cargo_kg ? formatNumber(t.max_cargo_kg) : '—'}</Td>
                <Td className="text-right tabular-nums">{t.cruise_speed_kts ?? '—'}</Td>
                {isOrgAdmin ? (
                  <Td className="text-right">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(t)}>
                      Editar
                    </Button>
                  </Td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing ? <AircraftTypeDialog type={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
function FleetSection({ airline }: { airline: Airline }) {
  const { canManage } = useAirlinePermissions(airline.id);
  return <FleetTable airline={airline} canManage={canManage} />;
}

export function FleetPage() {
  const [tab, setTab] = useState<'fleet' | 'types'>('fleet');
  return (
    <div className="space-y-6">
      <PageHeader title="Fleet" description="Aeronaves de la aerolínea seleccionada y catálogo de tipos de aeronave." />
      <Tabs
        label="Flota"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'fleet', label: 'Aeronaves' },
          { value: 'types', label: 'Tipos de aeronave' },
        ]}
      />
      {tab === 'fleet' ? <ScopeRequired>{(airline) => <FleetSection airline={airline} />}</ScopeRequired> : <AircraftTypesTable />}
    </div>
  );
}
