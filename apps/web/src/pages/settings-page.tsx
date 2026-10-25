import { zodResolver } from '@hookform/resolvers/zod';
import {
  PASSWORD_MIN_LENGTH,
  newPasswordSchema,
  profileUpdateSchema,
  type NewPasswordInput,
  type ProfileUpdateInput,
} from '@lam/validation';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { useAirlines, useMyMemberships, useProfile, useUpdateProfile, type Profile } from '@/hooks/use-lam-data';
import { countryOptions } from '@/lib/countries';
import { describeError } from '@/lib/errors';
import { formatLocalDate, formatPilotNumber } from '@/lib/format';
import { getSupabase } from '@/lib/supabase';

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
  const countries = useMemo(() => countryOptions(), []);

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
      <Field id="displayName" label="Nombre para mostrar" error={errors.displayName?.message}>
        <Input autoComplete="name" {...fieldAria('displayName', errors.displayName?.message)} {...register('displayName')} />
      </Field>
      <Field id="countryCode" label="País" error={errors.countryCode?.message}>
        <Select {...fieldAria('countryCode', errors.countryCode?.message)} {...register('countryCode')}>
          <option value="">Sin especificar</option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
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

function AccountFacts({ profile }: { profile: Profile }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      <div>
        <dt className="text-sm text-muted">Número de piloto</dt>
        <dd className="font-mono text-lg">{formatPilotNumber(profile.pilot_number)}</dd>
      </div>
      <div>
        <dt className="text-sm text-muted">Correo</dt>
        <dd className="break-all">{profile.email}</dd>
      </div>
      <div>
        <dt className="text-sm text-muted">Miembro desde</dt>
        <dd>{formatLocalDate(profile.joined_at)}</dd>
      </div>
      <div>
        <dt className="text-sm text-muted">Estado de la cuenta</dt>
        <dd>
          {profile.account_status === 'active' ? <Badge tone="ok">Activa</Badge> : <Badge tone="danger">Suspendida</Badge>}
        </dd>
      </div>
    </dl>
  );
}

function PasswordForm() {
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<NewPasswordInput>({ resolver: zodResolver(newPasswordSchema) });
  const hint = `Al menos ${PASSWORD_MIN_LENGTH} caracteres, con letras y números.`;

  async function onSubmit(values: NewPasswordInput) {
    setServerError(null);
    const { error } = await getSupabase().auth.updateUser({ password: values.password });
    if (error) {
      setServerError(describeError(error));
      return;
    }
    reset();
    toast.success('Contraseña actualizada');
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 sm:grid-cols-2">
      {serverError ? (
        <Alert tone="danger" className="sm:col-span-2">
          {serverError}
        </Alert>
      ) : null}
      <Field id="newPassword" label="Contraseña nueva" error={errors.password?.message} hint={hint}>
        <Input
          type="password"
          autoComplete="new-password"
          {...fieldAria('newPassword', errors.password?.message, hint)}
          {...register('password')}
        />
      </Field>
      <Field id="newPasswordConfirm" label="Repite la contraseña" error={errors.confirmPassword?.message}>
        <Input
          type="password"
          autoComplete="new-password"
          {...fieldAria('newPasswordConfirm', errors.confirmPassword?.message)}
          {...register('confirmPassword')}
        />
      </Field>
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" variant="secondary" loading={isSubmitting}>
          Cambiar contraseña
        </Button>
      </div>
    </form>
  );
}

function SessionsSection() {
  const [busy, setBusy] = useState(false);

  async function signOutOthers() {
    if (!window.confirm('¿Cerrar la sesión en todos tus otros dispositivos? Esta sesión seguirá abierta.')) return;
    setBusy(true);
    const { error } = await getSupabase().auth.signOut({ scope: 'others' });
    setBusy(false);
    if (error) {
      toast.error(describeError(error));
      return;
    }
    toast.success('Se cerró la sesión en tus otros dispositivos');
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <p className="max-w-prose text-muted">
        Si iniciaste sesión en un equipo que no es tuyo o perdiste un dispositivo, cierra esas sesiones desde aquí.
      </p>
      <Button variant="danger" loading={busy} onClick={signOutOthers}>
        Cerrar otras sesiones
      </Button>
    </div>
  );
}

export function SettingsPage() {
  const profile = useProfile();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-semibold">Settings</h1>
        <p className="mt-1 text-muted">Tu perfil de piloto y la seguridad de tu cuenta.</p>
      </header>

      {profile.isPending ? (
        <Skeleton className="h-64" />
      ) : profile.isError ? (
        <Alert tone="danger">{describeError(profile.error)}</Alert>
      ) : (
        <>
          <Panel title="Cuenta" description="Estos datos los gestiona LAM.">
            <AccountFacts profile={profile.data} />
          </Panel>
          <Panel title="Perfil de piloto">
            <ProfileForm profile={profile.data} />
          </Panel>
        </>
      )}

      <Panel title="Contraseña">
        <PasswordForm />
      </Panel>
      <Panel title="Sesiones">
        <SessionsSection />
      </Panel>
    </div>
  );
}
