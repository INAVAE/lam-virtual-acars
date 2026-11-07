import { zodResolver } from '@hookform/resolvers/zod';
import { profileUpdateSchema, type ProfileUpdateInput } from '@lam/validation';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { PilotBadgesPanel } from '@/components/tour-badge';
import { Panel } from '@/components/ui/panel';
import { AcarsDevicesPanel } from '@/components/acars-devices-panel';
import { Skeleton } from '@/components/ui/skeleton';
import { useAirlines, useMyMemberships, useProfile, useUpdateProfile, type Profile } from '@/hooks/use-lam-data';
import { describeError } from '@/lib/errors';
import { browserTimeZone, dualTime, isValidTimeZone, supportedTimeZones, zoneAbbreviation } from '@/lib/time';
import { useTimePrefs } from '@/lib/time-context';

function toFormValues(profile: Profile): ProfileUpdateInput {
  return {
    displayName: profile.display_name,
    countryCode: profile.country_code ?? '',
    simbriefUsername: profile.simbrief_username ?? '',
    primaryAirlineId: profile.primary_airline_id ?? '',
  };
}

function ProfileForm({ profile }: { profile: Profile }) {
  const update = useUpdateProfile();
  const memberships = useMyMemberships();
  const airlines = useAirlines();

  const activeAirlines = useMemo(() => {
    const ids = new Set((memberships.data ?? []).filter((m) => m.status === 'active').map((m) => m.airline_id));
    return (airlines.data ?? []).filter((a) => ids.has(a.id));
  }, [memberships.data, airlines.data]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileUpdateInput>({
    resolver: zodResolver(profileUpdateSchema),
    defaultValues: toFormValues(profile),
  });

  useEffect(() => {
    reset(toFormValues(profile));
  }, [profile, reset]);

  async function onSubmit(values: ProfileUpdateInput) {
    try {
      await update.mutateAsync({
        display_name: values.displayName,
        country_code: values.countryCode,
        simbrief_username: values.simbriefUsername,
        primary_airline_id: values.primaryAirlineId,
      });
      toast.success('Perfil guardado');
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  const simbriefHint = 'Tu usuario o alias de SimBrief. Con él importas el plan de vuelo en My Flights.';
  const primaryHint =
    activeAirlines.length === 0 ? 'Disponible cuando tengas una membresía activa.' : 'La que se muestra por defecto.';

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 sm:grid-cols-2">
      <Field id="simbriefUsername" label="Usuario de SimBrief" error={errors.simbriefUsername?.message} hint={simbriefHint}>
        <Input
          autoComplete="off"
          {...fieldAria('simbriefUsername', errors.simbriefUsername?.message, simbriefHint)}
          {...register('simbriefUsername')}
        />
      </Field>
      <Field id="primaryAirlineId" label="Aerolínea principal" error={errors.primaryAirlineId?.message} hint={primaryHint}>
        <Select
          disabled={activeAirlines.length === 0}
          {...fieldAria('primaryAirlineId', errors.primaryAirlineId?.message, primaryHint)}
          {...register('primaryAirlineId')}
        >
          <option value="">Sin aerolínea principal</option>
          {activeAirlines.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
          Guardar perfil
        </Button>
      </div>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Hora: zona horaria (en el perfil) y hora principal (en este navegador)
// -----------------------------------------------------------------------------
function TimeSettings({ profile }: { profile: Profile }) {
  const update = useUpdateProfile();
  const { primary, setPrimary } = useTimePrefs();
  const zones = useMemo(() => supportedTimeZones(), []);
  const detected = browserTimeZone();
  const [value, setValue] = useState(profile.time_zone ?? '');
  useEffect(() => setValue(profile.time_zone ?? ''), [profile.time_zone]);
  const now = new Date();
  const preview = dualTime(now, value || detected, primary, { seconds: false });

  async function save() {
    if (value && !isValidTimeZone(value)) {
      toast.error('Zona horaria no válida');
      return;
    }
    try {
      await update.mutateAsync({ time_zone: value || null });
      toast.success(value ? `Zona horaria: ${value}` : `Zona horaria automática (${detected})`);
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id="timeZone" label="Zona horaria" hint={`Se guarda en tu perfil. Automática usa la de este equipo: ${detected}.`}>
        <Select id="timeZone" aria-describedby="timeZone-hint" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Automática ({detected})</option>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replaceAll('_', ' ')} · {zoneAbbreviation(z, now)}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset>
        <legend className="text-sm font-medium text-ink">Hora principal</legend>
        <div className="mt-1.5 inline-flex rounded-md border border-line p-0.5" role="radiogroup" aria-label="Hora principal">
          {(
            [
              ['utc', 'UTC (Zulu)'],
              ['local', 'Local'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={primary === v}
              onClick={() => setPrimary(v)}
              className={
                primary === v ? 'rounded bg-accent px-3 py-1.5 text-sm text-accent-ink' : 'rounded px-3 py-1.5 text-sm text-muted hover:text-ink'
              }
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-sm text-muted">La otra se muestra al lado en tono tenue. También cambia con un clic en el reloj de arriba.</p>
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
        <p className="text-sm text-muted">
          Así se verá ahora: <span className="font-mono text-ink">{preview.primary}</span>
          {preview.secondary ? <span className="font-mono"> · {preview.secondary}</span> : null}
          {(profile.time_zone ?? '') !== value ? <span> (sin guardar)</span> : null}
        </p>
        <Button onClick={save} loading={update.isPending} disabled={(profile.time_zone ?? '') === value}>
          Guardar zona horaria
        </Button>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const profile = useProfile();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-semibold">Settings</h1>
        <p className="mt-1 text-muted">
          SimBrief, tu aerolínea principal, la hora y el conector. Tus datos personales, tu foto y tu contraseña están en{' '}
          <Link to="/account" className="font-medium text-ink underline underline-offset-4">
            Mi cuenta
          </Link>
          .
        </p>
      </header>

      {profile.isPending ? (
        <Skeleton className="h-64" />
      ) : profile.isError ? (
        <Alert tone="danger">{describeError(profile.error)}</Alert>
      ) : (
        <>
          <Panel title="Perfil de piloto" description="Con tu usuario de SimBrief importas el plan de vuelo en My Flights.">
            <ProfileForm profile={profile.data} />
          </Panel>
          <PilotBadgesPanel title="Insignias de tours" />
          <Panel title="Hora" description="La operación usa UTC (Zulu). Elige tu zona para ver también la hora local en todo el sitio, incluidas las gráficas.">
            <TimeSettings profile={profile.data} />
          </Panel>
        </>
      )}

      <Panel
        title="Dispositivos ACARS"
        description="Equipos donde instalaste LAM ACARS. Cada uno envía datos solo de tus vuelos y puedes revocarlo en cualquier momento."
      >
        <AcarsDevicesPanel />
      </Panel>
    </div>
  );
}
