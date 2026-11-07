import { zodResolver } from '@hookform/resolvers/zod';
import { PASSWORD_MIN_LENGTH, newPasswordSchema, type NewPasswordInput } from '@lam/validation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { FullPageStatus } from '@/components/full-page-status';
import { useAuth } from '@/lib/auth';
import { describeError } from '@/lib/errors';
import { getSupabase } from '@/lib/supabase';
import { AuthLayout } from './auth-layout';

const passwordHint = `Al menos ${PASSWORD_MIN_LENGTH} caracteres, con letras y números.`;

export function ResetPasswordPage() {
  const { session, loading, clearRecovering } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const welcome = params.get('bienvenida') === '1';
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<NewPasswordInput>({ resolver: zodResolver(newPasswordSchema) });

  if (loading) return <FullPageStatus message="Verificando el enlace…" />;

  if (!session) {
    return (
      <AuthLayout title="El enlace no es válido">
        <div className="flex flex-col gap-4">
          <p>
            El enlace para cambiar la contraseña expiró, ya se usó o se abrió en otro navegador. Pide uno nuevo y ábrelo
            en este navegador.
          </p>
          <Link to="/recuperar" className="font-medium underline underline-offset-4">
            Pedir un enlace nuevo
          </Link>
        </div>
      </AuthLayout>
    );
  }

  async function onSubmit(values: NewPasswordInput) {
    setServerError(null);
    const { error } = await getSupabase().auth.updateUser({ password: values.password });
    if (error) {
      setServerError(describeError(error));
      return;
    }
    clearRecovering();
    toast.success(welcome ? 'Bienvenido a LAM. Ahora solicita unirte a una aerolínea desde «Mis aerolíneas».' : 'Contraseña actualizada');
    navigate('/', { replace: true });
  }

  return (
    <AuthLayout
      title={welcome ? 'Crea tu contraseña' : 'Elige una contraseña nueva'}
      subtitle={welcome ? `Tu cuenta de piloto fue aprobada. Elige la contraseña con la que entrarás como ${session.user.email ?? ''}.` : (session.user.email ?? undefined)}
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        {serverError ? <Alert tone="danger">{serverError}</Alert> : null}
        <Field id="password" label="Contraseña nueva" error={errors.password?.message} hint={passwordHint}>
          <Input
            type="password"
            autoComplete="new-password"
            {...fieldAria('password', errors.password?.message, passwordHint)}
            {...register('password')}
          />
        </Field>
        <Field id="confirmPassword" label="Repite la contraseña" error={errors.confirmPassword?.message}>
          <Input
            type="password"
            autoComplete="new-password"
            {...fieldAria('confirmPassword', errors.confirmPassword?.message)}
            {...register('confirmPassword')}
          />
        </Field>
        <Button type="submit" loading={isSubmitting}>
          {welcome ? 'Crear contraseña y entrar' : 'Guardar contraseña'}
        </Button>
      </form>
    </AuthLayout>
  );
}
