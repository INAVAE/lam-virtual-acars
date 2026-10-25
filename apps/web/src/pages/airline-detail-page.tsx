import { zodResolver } from '@hookform/resolvers/zod';
import { AIRLINE_NETWORKS, OPERATION_TYPES } from '@lam/shared-types';
import { ArrowLeft, ImageUp } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { AirlineLogo } from '@/components/airline-logo';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, fieldAria } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  MAX_LOGO_BYTES,
  useAirlineBySlug,
  useAirlineSettings,
  useUpdateAirline,
  useUpdateAirlineSettings,
  useUploadAirlineLogo,
  type AirlineRecord,
  type AirlineSettings,
} from '@/hooks/use-airline-admin';
import { contrastRatio, readableTextOn } from '@/lib/color';
import { describeError } from '@/lib/errors';
import { operationTypeLabels } from '@/lib/format';
import { useAirlinePermissions } from '@/lib/permissions';

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim() : v);
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Formato #RRGGBB');

// -----------------------------------------------------------------------------
// Datos generales e identidad
// -----------------------------------------------------------------------------
const airlineSchema = z.object({
  name: z.string().trim().min(2, 'Escribe el nombre').max(80),
  description: z.preprocess(emptyToNull, z.string().max(1000, 'Máximo 1000 caracteres').nullable()),
  website_url: z.preprocess(
    emptyToNull,
    z.string().regex(/^https:\/\/[^\s]+$/, 'Usa una dirección que empiece con https://').max(200).nullable(),
  ),
  operation_type: z.enum(OPERATION_TYPES),
  network: z.enum(AIRLINE_NETWORKS),
  flight_plan_remarks: z.preprocess(emptyToNull, z.string().max(100, 'Máximo 100 caracteres').nullable()),
  brand_primary_color: hex,
  brand_secondary_color: z.preprocess(emptyToNull, hex.nullable()),
  // Solo superadministrador. Opcionales: si el bloque está deshabilitado,
  // el formulario no envía estos valores.
  icao_code: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim().toUpperCase() : v),
    z.string().regex(/^[A-Z]{3}$/, 'Tres letras').nullable().optional(),
  ),
  iata_code: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim().toUpperCase() : v),
    z.string().regex(/^[A-Z0-9]{2}$/, 'Dos caracteres').nullable().optional(),
  ),
  is_active: z.boolean().optional(),
  is_unofficial_brand: z.boolean().optional(),
});
type AirlineForm = z.infer<typeof airlineSchema>;

function toForm(a: AirlineRecord): AirlineForm {
  return {
    name: a.name,
    description: a.description,
    website_url: a.website_url,
    operation_type: (OPERATION_TYPES as readonly string[]).includes(a.operation_type) ? (a.operation_type as AirlineForm['operation_type']) : 'passenger',
    network: (AIRLINE_NETWORKS as readonly string[]).includes(a.network) ? (a.network as AirlineForm['network']) : 'IVAO',
    flight_plan_remarks: a.flight_plan_remarks,
    brand_primary_color: a.brand_primary_color,
    brand_secondary_color: a.brand_secondary_color,
    icao_code: a.icao_code,
    iata_code: a.iata_code,
    is_active: a.is_active,
    is_unofficial_brand: a.is_unofficial_brand,
  };
}

function ColorField({ id, label, value, onChange, error }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string }) {
  const valid = /^#[0-9A-Fa-f]{6}$/.test(value);
  return (
    <Field id={id} label={label} error={error}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label}: selector`}
          value={valid ? value : '#000000'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className={`h-10 w-12 shrink-0 cursor-pointer rounded-md border border-line bg-bg p-1 ${valid ? '' : 'opacity-30'}`}
        />
        <Input
          id={id}
          className="font-mono uppercase"
          placeholder="Sin color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
        />
      </div>
    </Field>
  );
}

function AirlineEditor({ airline, canManage, isOrgAdmin }: { airline: AirlineRecord; canManage: boolean; isOrgAdmin: boolean }) {
  const update = useUpdateAirline();
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<AirlineForm>({ resolver: zodResolver(airlineSchema), defaultValues: toForm(airline) });

  useEffect(() => reset(toForm(airline)), [airline, reset]);

  const primary = watch('brand_primary_color') ?? '';
  const secondary = watch('brand_secondary_color') ?? '';
  const primaryValid = /^#[0-9A-Fa-f]{6}$/.test(primary);

  async function onSubmit(values: AirlineForm) {
    const changes = isOrgAdmin
      ? values
      : (({ icao_code: _i, iata_code: _a, is_active: _ac, is_unofficial_brand: _u, ...rest }) => rest)(values);
    try {
      await update.mutateAsync({ id: airline.id, changes });
      toast.success('Aerolínea actualizada');
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  const disabled = !canManage;

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
      <fieldset disabled={disabled} className="space-y-6">
        <Panel title="Datos generales">
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="al-name" label="Nombre" error={errors.name?.message}>
              <Input {...fieldAria('al-name', errors.name?.message)} {...register('name')} />
            </Field>
            <Field id="al-site" label="Sitio web" error={errors.website_url?.message}>
              <Input type="url" placeholder="https://" {...fieldAria('al-site', errors.website_url?.message)} {...register('website_url')} />
            </Field>
            <div className="md:col-span-2">
              <Field id="al-desc" label="Descripción" error={errors.description?.message}>
                <Textarea rows={3} {...fieldAria('al-desc', errors.description?.message)} {...register('description')} />
              </Field>
            </div>
            <Field id="al-op" label="Tipo de operación">
              <Select id="al-op" {...register('operation_type')}>
                {OPERATION_TYPES.map((o) => (
                  <option key={o} value={o}>
                    {operationTypeLabels[o]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="al-network" label="Red de control aéreo">
              <Select id="al-network" {...register('network')}>
                {AIRLINE_NETWORKS.map((n) => (
                  <option key={n} value={n}>
                    {n === 'OFFLINE' ? 'Sin red (fuera de línea)' : n}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="al-rmk" label="RMK del plan de vuelo" error={errors.flight_plan_remarks?.message} hint="Por ejemplo IVAOVA/MXL.">
              <Input className="font-mono" {...fieldAria('al-rmk', errors.flight_plan_remarks?.message)} {...register('flight_plan_remarks')} />
            </Field>
          </div>
        </Panel>

        <Panel title="Identidad visual" description="El color principal tiñe la interfaz cuando se selecciona la aerolínea.">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
            <ColorField
              id="al-primary"
              label="Color principal"
              value={primary}
              error={errors.brand_primary_color?.message}
              onChange={(v) => setValue('brand_primary_color', v, { shouldDirty: true, shouldValidate: true })}
            />
            <ColorField
              id="al-secondary"
              label="Color secundario"
              value={secondary}
              error={errors.brand_secondary_color?.message}
              onChange={(v) => setValue('brand_secondary_color', v, { shouldDirty: true, shouldValidate: true })}
            />
            {primaryValid ? (
              <div
                className="flex h-10 items-center rounded-md px-4 text-sm font-medium"
                style={{ backgroundColor: primary, color: readableTextOn(primary) }}
              >
                Botón de ejemplo
              </div>
            ) : null}
          </div>
          {primaryValid && contrastRatio(primary, readableTextOn(primary)) < 4.5 ? (
            <p className="mt-2 text-sm text-warn-ink">
              Este color tiene poco contraste con el texto. Se puede usar, pero los botones serán menos legibles.
            </p>
          ) : null}
        </Panel>
      </fieldset>

      <Panel
        title="Códigos y estado"
        description={isOrgAdmin ? 'Solo el superadministrador cambia estos datos.' : 'Solo un superadministrador puede cambiar estos datos.'}
      >
        <fieldset disabled={!isOrgAdmin} className="grid gap-4 md:grid-cols-2">
          <Field id="al-icao" label="Código ICAO" error={errors.icao_code?.message} hint="Obligatorio para activar la aerolínea.">
            <Input className="font-mono uppercase" maxLength={3} {...fieldAria('al-icao', errors.icao_code?.message)} {...register('icao_code')} />
          </Field>
          <Field id="al-iata" label="Código IATA" error={errors.iata_code?.message} hint="Opcional.">
            <Input className="font-mono uppercase" maxLength={2} {...fieldAria('al-iata', errors.iata_code?.message)} {...register('iata_code')} />
          </Field>
          <Checkbox
            id="al-active"
            label="Aerolínea activa"
            hint="Visible en la página pública y abierta a solicitudes de ingreso."
            {...register('is_active')}
          />
          <Checkbox
            id="al-unofficial"
            label="Inspirada en una marca real"
            hint="Muestra el aviso de operación virtual no oficial."
            {...register('is_unofficial_brand')}
          />
        </fieldset>
      </Panel>

      {canManage ? (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={!isDirty || isSubmitting} onClick={() => reset(toForm(airline))}>
            Descartar cambios
          </Button>
          <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
            Guardar aerolínea
          </Button>
        </div>
      ) : null}
    </form>
  );
}

// -----------------------------------------------------------------------------
// Logotipo
// -----------------------------------------------------------------------------
function LogoPanel({ airline, canManage }: { airline: AirlineRecord; canManage: boolean }) {
  const upload = useUploadAirlineLogo();
  const input = useRef<HTMLInputElement>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      await upload.mutateAsync({ airlineId: airline.id, file });
      toast.success('Logotipo actualizado');
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      if (input.current) input.current.value = '';
    }
  }

  return (
    <Panel title="Logotipo" description={`PNG, JPG o WebP de hasta ${MAX_LOGO_BYTES / 1024} KB. Se muestra sobre fondo blanco; usa una imagen cuadrada.`}>
      <div className="flex flex-wrap items-center gap-4">
        <AirlineLogo airline={airline} size="lg" />
        {canManage ? (
          <>
            <input
              ref={input}
              id="logo-file"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <Button variant="secondary" loading={upload.isPending} onClick={() => input.current?.click()}>
              <ImageUp className="size-4" aria-hidden />
              {airline.logo_path ? 'Cambiar logotipo' : 'Subir logotipo'}
            </Button>
          </>
        ) : null}
      </div>
    </Panel>
  );
}

// -----------------------------------------------------------------------------
// Políticas
// -----------------------------------------------------------------------------
const settingsSchema = z.object({
  max_active_bookings: z.coerce.number().int().min(1, 'Mínimo 1').max(10, 'Máximo 10'),
  booking_expiry_hours: z.coerce.number().int().min(1, 'Mínimo 1 hora').max(168, 'Máximo 168 horas'),
  delay_tolerance_minutes: z.coerce.number().int().min(0).max(600, 'Máximo 600 minutos'),
  require_aircraft_at_origin: z.boolean(),
  require_type_rating: z.boolean(),
  auto_approve_pireps: z.boolean(),
  public_tracking: z.boolean(),
});
type SettingsForm = z.infer<typeof settingsSchema>;

function toSettingsForm(s: AirlineSettings): SettingsForm {
  return {
    max_active_bookings: s.max_active_bookings,
    booking_expiry_hours: s.booking_expiry_hours,
    delay_tolerance_minutes: s.delay_tolerance_minutes,
    require_aircraft_at_origin: s.require_aircraft_at_origin,
    require_type_rating: s.require_type_rating,
    auto_approve_pireps: s.auto_approve_pireps,
    public_tracking: s.public_tracking,
  };
}

function SettingsPanel({ airlineId, canManage }: { airlineId: string; canManage: boolean }) {
  const settings = useAirlineSettings(airlineId);
  const update = useUpdateAirlineSettings();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<SettingsForm>({ resolver: zodResolver(settingsSchema) });

  useEffect(() => {
    if (settings.data) reset(toSettingsForm(settings.data));
  }, [settings.data, reset]);

  async function onSubmit(values: SettingsForm) {
    try {
      await update.mutateAsync({ airlineId, changes: values });
      toast.success('Políticas actualizadas');
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  if (settings.isPending) return <Skeleton className="h-48" />;
  if (settings.isError) return <Alert tone="danger">{describeError(settings.error)}</Alert>;
  if (!settings.data) return <Alert>Solo los miembros de la aerolínea ven sus políticas.</Alert>;

  return (
    <Panel title="Políticas operacionales" description="Se aplican a las reservas y, desde la Fase 5, a los PIREP.">
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <fieldset disabled={!canManage} className="grid gap-4">
          <Field id="st-bookings" label="Reservas activas por piloto" error={errors.max_active_bookings?.message}>
            <Input type="number" min={1} max={10} {...fieldAria('st-bookings', errors.max_active_bookings?.message)} {...register('max_active_bookings')} />
          </Field>
          <Field id="st-expiry" label="Vencimiento de reserva (horas)" error={errors.booking_expiry_hours?.message}>
            <Input type="number" min={1} max={168} {...fieldAria('st-expiry', errors.booking_expiry_hours?.message)} {...register('booking_expiry_hours')} />
          </Field>
          <Field id="st-delay" label="Tolerancia de retraso (min)" error={errors.delay_tolerance_minutes?.message}>
            <Input type="number" min={0} max={600} {...fieldAria('st-delay', errors.delay_tolerance_minutes?.message)} {...register('delay_tolerance_minutes')} />
          </Field>
          <Checkbox
            id="st-origin"
            label="La aeronave debe estar en el origen"
            hint="Para reservar, la aeronave tiene que estar en el aeropuerto de salida."
            {...register('require_aircraft_at_origin')}
          />
          <Checkbox
            id="st-rating"
            label="Exigir habilitación de tipo"
            hint="El piloto solo reserva tipos de aeronave para los que el staff lo habilitó en Pilots."
            {...register('require_type_rating')}
          />
          <Checkbox
            id="st-auto"
            label="Aprobar PIREP automáticamente"
            hint="Si cumple las reglas de la aerolínea, sin revisión manual."
            {...register('auto_approve_pireps')}
          />
          <Checkbox id="st-public" label="Seguimiento público" hint="Los vuelos aparecen en el mapa público." {...register('public_tracking')} />
        </fieldset>
        {canManage ? (
          <div className="mt-4 flex justify-end">
            <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
              Guardar políticas
            </Button>
          </div>
        ) : null}
      </form>
    </Panel>
  );
}

// -----------------------------------------------------------------------------
export function AirlineDetailPage() {
  const { slug } = useParams();
  const airline = useAirlineBySlug(slug);
  const permissions = useAirlinePermissions(airline.data?.id);

  return (
    <div className="space-y-6">
      <Link to="/airlines" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Airlines
      </Link>

      {airline.isPending ? (
        <Skeleton className="h-64" />
      ) : airline.isError ? (
        <Alert tone="danger">{describeError(airline.error)}</Alert>
      ) : !airline.data ? (
        <Alert>No encontramos esta aerolínea o no tienes acceso a ella.</Alert>
      ) : (
        <>
          <header className="flex flex-wrap items-center gap-4">
            <AirlineLogo airline={airline.data} size="lg" />
            <div className="min-w-0">
              <p className="font-mono text-2xl leading-none">{airline.data.icao_code ?? '···'}</p>
              <h1 className="font-display text-3xl font-semibold leading-tight">{airline.data.name}</h1>
            </div>
            <div className="ml-auto flex gap-2">
              {airline.data.is_active ? <Badge tone="ok">Activa</Badge> : <Badge tone="warn">Inactiva</Badge>}
              {!permissions.canManage ? <Badge>Solo lectura</Badge> : null}
            </div>
          </header>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <AirlineEditor airline={airline.data} canManage={permissions.canManage} isOrgAdmin={permissions.isOrgAdmin} />
            <div className="space-y-6">
              <LogoPanel airline={airline.data} canManage={permissions.canManage} />
              <SettingsPanel airlineId={airline.data.id} canManage={permissions.canManage} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
