import { zodResolver } from '@hookform/resolvers/zod';
import { PASSWORD_MIN_LENGTH, newPasswordSchema, type NewPasswordInput } from '@lam/validation';
import { Camera, ExternalLink, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Avatar } from '@/components/avatar';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useProfile, useUpdateProfile, type Profile } from '@/hooks/use-lam-data';
import { useAvatar } from '@/hooks/use-pilot-profile';
import { useAuth } from '@/lib/auth';
import { countryOptions } from '@/lib/countries';
import { describeError } from '@/lib/errors';
import { formatLocalDate, formatLocalDateTime, formatPilotNumber } from '@/lib/format';
import { getSupabase } from '@/lib/supabase';

// -----------------------------------------------------------------------------
// Datos personales
// -----------------------------------------------------------------------------
function AvatarEditor({ profile }: { profile: Profile }) {
  const avatar = useAvatar();
  const input = useRef<HTMLInputElement>(null);

  async function change(file: File | null) {
    try {
      await avatar.mutateAsync(file);
      toast.success(file ? 'Foto actualizada' : 'Foto quitada');
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Avatar name={profile.display_name} url={profile.avatar_url} size="lg" />
      <div className="space-y-2">
        <p className="text-sm text-muted">PNG, JPG o WebP. Se recorta en cuadro y se reduce a 256 px.</p>
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            aria-label="Elegir foto de perfil"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              e.target.value = '';
              if (file) void change(file);
            }}
          />
          <Button size="sm" loading={avatar.isPending} onClick={() => input.current?.click()}>
            <Camera className="size-4" aria-hidden />
            {profile.avatar_url ? 'Cambiar foto' : 'Subir foto'}
          </Button>
          {profile.avatar_url ? (
            <Button size="sm" variant="ghost" disabled={avatar.isPending} onClick={() => void change(null)}>
              <Trash2 className="size-4" aria-hidden />
              Quitar foto
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const DISCORD = /^[a-z0-9_.]{2,32}$/;

function PersonalForm({ profile }: { profile: Profile }) {
  const update = useUpdateProfile();
  const countries = useMemo(() => countryOptions(), []);
  const initial = useMemo(
    () => ({
      name: profile.display_name,
      country: profile.country_code ?? '',
      vid: profile.ivao_vid ?? '',
      discord: profile.discord_username ?? '',
      bio: profile.bio ?? '',
    }),
    [profile],
  );
  const [v, setV] = useState(initial);
  const [touched, setTouched] = useState(false);
  useEffect(() => setV(initial), [initial]);

  const errors = {
    name: v.name.trim().length < 2 || v.name.trim().length > 80 ? 'Escribe tu nombre (de 2 a 80 caracteres)' : undefined,
    vid: v.vid.trim() && !/^[0-9]{4,8}$/.test(v.vid.trim()) ? 'Solo números, de 4 a 8' : undefined,
    discord: v.discord.trim() && !DISCORD.test(v.discord.trim().replace(/^@/, '').toLowerCase()) ? 'Minúsculas, números, punto o guion bajo (2 a 32)' : undefined,
    bio: v.bio.length > 300 ? 'Usa como máximo 300 caracteres' : undefined,
  };
  const show = (e: string | undefined) => (touched ? e : undefined);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (Object.values(errors).some(Boolean)) return;
    try {
      await update.mutateAsync({
        display_name: v.name.trim(),
        country_code: v.country || null,
        ivao_vid: v.vid.trim() || null,
        discord_username: v.discord.trim().replace(/^@/, '').toLowerCase() || null,
        bio: v.bio.trim() || null,
      });
      toast.success('Datos guardados');
      setTouched(false);
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  const set = (key: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [key]: e.target.value }));

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
      <Field id="acc-name" label="Nombre para mostrar" error={show(errors.name)}>
        <Input autoComplete="name" maxLength={80} value={v.name} onChange={set('name')} {...fieldAria('acc-name', show(errors.name))} />
      </Field>
      <Field id="acc-country" label="País">
        <Select id="acc-country" value={v.country} onChange={set('country')}>
          <option value="">Sin especificar</option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="acc-vid" label="VID de IVAO" error={show(errors.vid)} hint="Aparece en tu perfil con un enlace a IVAO.">
        <Input inputMode="numeric" maxLength={8} className="font-mono" value={v.vid} onChange={set('vid')} {...fieldAria('acc-vid', show(errors.vid), 'Aparece en tu perfil con un enlace a IVAO.')} />
      </Field>
      <Field id="acc-discord" label="Usuario de Discord" error={show(errors.discord)} hint="Para los entrenamientos y eventos en Discord.">
        <Input placeholder="usuario" className="font-mono" maxLength={33} value={v.discord} onChange={set('discord')} {...fieldAria('acc-discord', show(errors.discord), 'Para los entrenamientos y eventos en Discord.')} />
      </Field>
      <Field id="acc-bio" label="Presentación breve" error={show(errors.bio)} hint={`${v.bio.length}/300 · Tu experiencia, los aviones que vuelas o lo que quieras compartir.`}>
        <Textarea id="acc-bio" rows={3} maxLength={300} value={v.bio} onChange={set('bio')} />
      </Field>
      <div className="flex items-end justify-end sm:col-span-2">
        <Button type="submit" loading={update.isPending} disabled={!dirty}>
          Guardar datos
        </Button>
      </div>
    </form>
  );
}

function AccountFacts({ profile }: { profile: Profile }) {
  const { session } = useAuth();
  const lastSignIn = session?.user.last_sign_in_at;
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
      {lastSignIn ? (
        <div>
          <dt className="text-sm text-muted">Sesión iniciada</dt>
          <dd>{formatLocalDateTime(lastSignIn)}</dd>
        </div>
      ) : null}
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


type AccountTab = 'personal' | 'security';

export function AccountPage() {
  const profile = useProfile();
  const [params, setParams] = useSearchParams();
  const tab: AccountTab = params.get('tab') === 'security' ? 'security' : 'personal';
  const setTab = (t: AccountTab) => setParams(t === 'personal' ? {} : { tab: t }, { replace: true });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mi cuenta"
        description="Tus datos personales, tu foto y la seguridad de tu cuenta. SimBrief, la hora y el conector están en Settings."
        actions={
          profile.data ? (
            <Link
              to={`/pilots/${profile.data.pilot_number}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line px-3 text-sm hover:bg-surface-2"
            >
              <ExternalLink className="size-4" aria-hidden />
              Ver mi perfil de piloto
            </Link>
          ) : null
        }
      />
      <Tabs<AccountTab>
        label="Secciones de mi cuenta"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'personal', label: 'Datos personales' },
          { value: 'security', label: 'Contraseña y sesiones' },
        ]}
      />
      {profile.isPending ? (
        <Skeleton className="h-64" />
      ) : profile.isError ? (
        <Alert tone="danger">{describeError(profile.error)}</Alert>
      ) : tab === 'personal' ? (
        <>
          <Panel title="Foto de perfil" description="Se ve en la barra superior y en tu perfil de piloto.">
            <AvatarEditor profile={profile.data} />
          </Panel>
          <Panel title="Datos personales" description="Lo que ven los pilotos de tus aerolíneas en tu perfil (el correo solo lo ve el staff).">
            <PersonalForm profile={profile.data} />
          </Panel>
          <Panel title="Cuenta" description="Estos datos los gestiona LAM. Para cambiar tu correo, escribe al superadministrador.">
            <AccountFacts profile={profile.data} />
          </Panel>
        </>
      ) : (
        <>
          <Panel title="Contraseña" description="Tiene efecto de inmediato. Las sesiones abiertas en otros equipos siguen abiertas hasta que las cierres abajo.">
            <PasswordForm />
          </Panel>
          <Panel title="Sesiones">
            <SessionsSection />
          </Panel>
        </>
      )}
    </div>
  );
}
