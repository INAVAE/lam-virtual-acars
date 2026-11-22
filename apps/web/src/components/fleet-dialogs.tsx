import { zodResolver } from '@hookform/resolvers/zod';
import { ENGINE_TYPES, MANUAL_AIRCRAFT_STATUSES, OPERATION_TYPES, WAKE_CATEGORIES, type AircraftStatus } from '@lam/shared-types';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { AirportPicker } from '@/components/airport-picker';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, fieldAria } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useSaveAircraft, useSaveAircraftType, type AircraftType, type FleetAircraft } from '@/hooks/use-fleet';
import type { Airline } from '@/hooks/use-lam-data';
import { aircraftSvg, defaultMapCategory, MAP_CATEGORIES, MAP_CATEGORY_LABELS, mapCategory, type MapCategory } from '@/lib/aircraft-icons';
import { describeError } from '@/lib/errors';
import { aircraftStatusLabels, engineTypeLabel, operationTypeLabels, wakeCategoryLabel } from '@/lib/format';

/*
 * Ventanas para agregar o editar una aeronave de la flota y un tipo del
 * catálogo. Las usan Fleet y la reserva de vuelo directo (para agregar a la
 * flota el avión que no aparece sin salir de la reserva).
 */

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

export function AircraftDialog({
  airline,
  aircraft,
  types,
  controlled,
  onClose,
  initial,
  onSaved,
  canAddType = false,
}: {
  airline: Airline;
  aircraft: FleetAircraft | null;
  types: AircraftType[];
  /** La aerolínea controla la disponibilidad: se editan estado, base y ubicación. */
  controlled: boolean;
  onClose: () => void;
  /** Valores iniciales de una aeronave nueva (por ejemplo, desde la reserva: en el origen). */
  initial?: Partial<Pick<AircraftForm, 'aircraft_type_id' | 'base_airport_id' | 'current_airport_id' | 'operation_type'>>;
  /** Se llama con el id de la aeronave guardada. */
  onSaved?: (id: string) => void;
  /** Muestra «Nuevo tipo» junto al tipo (solo el superadministrador agrega tipos al catálogo). */
  canAddType?: boolean;
}) {
  const save = useSaveAircraft();
  const [addingType, setAddingType] = useState(false);
  // El tipo recién creado se elige cuando ya aparece en la lista (después de recargar el catálogo).
  const [newTypeId, setNewTypeId] = useState<number | null>(null);
  const systemStatus = aircraft !== null && !MANUAL_AIRCRAFT_STATUSES.includes(aircraft.status);
  const statusOptions: readonly AircraftStatus[] = aircraft && systemStatus ? [aircraft.status] : MANUAL_AIRCRAFT_STATUSES;
  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<AircraftForm>({
    resolver: zodResolver(aircraftSchema),
    defaultValues: {
      aircraft_type_id: aircraft?.aircraft_type_id ?? initial?.aircraft_type_id ?? 0,
      registration: aircraft?.registration ?? '',
      fleet_number: aircraft?.fleet_number ?? '',
      configuration: aircraft?.configuration ?? '',
      operation_type:
        (aircraft?.operation_type as AircraftForm['operation_type']) ?? initial?.operation_type ?? (airline.operation_type === 'cargo' ? 'cargo' : 'passenger'),
      status: aircraft?.status ?? 'available',
      base_airport_id: aircraft?.base_airport_id ?? initial?.base_airport_id ?? null,
      current_airport_id: aircraft?.current_airport_id ?? initial?.current_airport_id ?? null,
      notes: aircraft?.notes ?? '',
    },
  });

  useEffect(() => {
    if (newTypeId !== null && types.some((t) => t.id === newTypeId)) {
      setValue('aircraft_type_id', newTypeId, { shouldValidate: true });
      setNewTypeId(null);
    }
  }, [newTypeId, types, setValue]);

  async function onSubmit(values: AircraftForm) {
    try {
      const id = await save.mutateAsync({
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
      toast.success(aircraft ? 'Aeronave actualizada' : `Aeronave ${values.registration} agregada a la flota`);
      onSaved?.(id);
      onClose();
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  return (
    <>
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
          <Field
            id="ac-type"
            label="Tipo de aeronave"
            error={errors.aircraft_type_id?.message}
            hint={canAddType ? '¿No está en la lista? «Nuevo tipo» lo agrega al catálogo.' : undefined}
          >
            <div className="flex gap-2">
              <Select className="min-w-0 flex-1" {...fieldAria('ac-type', errors.aircraft_type_id?.message)} {...register('aircraft_type_id')}>
                <option value={0}>Elige un tipo</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.icao_code} · {t.manufacturer} {t.model}
                  </option>
                ))}
              </Select>
              {canAddType ? (
                <Button variant="secondary" onClick={() => setAddingType(true)}>
                  <Plus className="size-4" aria-hidden />
                  Nuevo tipo
                </Button>
              ) : null}
            </div>
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
          {controlled ? (
            <>
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
            </>
          ) : null}
          <div className="sm:col-span-2">
            <Field id="ac-notes" label="Notas" error={errors.notes?.message}>
              <Textarea {...fieldAria('ac-notes', errors.notes?.message)} {...register('notes')} />
            </Field>
          </div>
        </form>
      </Dialog>
      {addingType ? (
        <AircraftTypeDialog
          type={null}
          onClose={() => setAddingType(false)}
          onSaved={setNewTypeId}
        />
      ) : null}
    </>
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
  map_category: z.enum(['auto', ...MAP_CATEGORIES] as [string, ...string[]]),
});
type TypeForm = z.infer<typeof typeSchema>;

export function AircraftTypeDialog({
  type,
  onClose,
  onSaved,
}: {
  type: AircraftType | null;
  onClose: () => void;
  /** Se llama con el id del tipo guardado. */
  onSaved?: (id: number) => void;
}) {
  const save = useSaveAircraftType();
  const {
    register,
    handleSubmit,
    watch,
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
      map_category: type?.map_category ?? 'auto',
    },
  });
  const [wIcao, wWake, wEngine, wPax, wCategory] = watch(['icao_code', 'wake_category', 'engine_type', 'max_passengers', 'map_category']);
  const autoCategory = defaultMapCategory((wIcao ?? '').toUpperCase(), wWake, wEngine, typeof wPax === 'number' ? wPax : wPax ? Number(wPax) : null);
  const shownCategory: MapCategory = wCategory === 'auto' ? autoCategory : mapCategory(wCategory);

  async function onSubmit({ map_category, ...rest }: TypeForm) {
    const values = {
      ...rest,
      map_category: map_category === 'auto' ? defaultMapCategory(rest.icao_code, rest.wake_category, rest.engine_type, rest.max_passengers) : map_category,
    };
    try {
      const id = await save.mutateAsync({ id: type?.id, values });
      toast.success(type ? 'Tipo actualizado' : `Tipo ${values.icao_code} agregado al catálogo`);
      onSaved?.(id);
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
      description={type ? undefined : 'Se agrega al catálogo que comparten todas las aerolíneas; después ya se puede usar en la flota y en las rutas.'}
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
        <Field id="t-map" label="Figura en el mapa en vivo" hint="Distingue en el mapa un avión ligero de un 737 o de un A380.">
          <div className="flex items-center gap-3">
            <Select id="t-map" className="flex-1" {...register('map_category')}>
              <option value="auto">Automática · {MAP_CATEGORY_LABELS[autoCategory]}</option>
              {MAP_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {MAP_CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
            <span
              className="inline-grid size-10 shrink-0 place-items-center rounded-md border border-line bg-bg"
              aria-hidden
              dangerouslySetInnerHTML={{ __html: aircraftSvg(shownCategory, '#38bdf8') }}
            />
          </div>
        </Field>
      </form>
    </Dialog>
  );
}
