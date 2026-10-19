import { zodResolver } from '@hookform/resolvers/zod';
import { PASSWORD_MIN_LENGTH, signUpSchema, type SignUpInput } from '@lam/validation';
import { MailCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { describeError } from '@/lib/errors';
import { getSupabase } from '@/lib/supabase';
import { appUrl } from '@/lib/urls';
import { AuthLayout } from './auth-layout';

const passwordHint = `Al menos ${PASSWORD_MIN_LENGTH} caracteres, con letras y números.`;

export function SignUpPage() {
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpInput>({ resolver: zodResolver(signUpSchema) });

  async function onSubmit(values: SignUpInput) {
    setServerError(null);
    const { data, error } = await getSupabase().auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        emailRedirectTo: appUrl('auth/callback'),
        data: { display_name: values.displayName },
      },
    });
    if (error) {
      setServerError(describeError(error));
      return;
    }
    if (data.session) {
      navigate('/', { replace: true });
      return;
    }
    setSentTo(values.email);
  }

  if (sentTo) {
    return (
      <AuthLayout title="Confirma tu correo">
        <div className="flex flex-col gap-4">
          <MailCheck className="size-10 text-cyan" aria-hidden />
          <p>
            Enviamos un enlace de confirmación a <strong className="font-medium">{sentTo}</strong>. Ábrelo en este mismo
            navegador para activar tu cuenta.
          </p>
          <p className="text-sm text-muted">
            Si no lo ves en unos minutos, revisa la carpeta de correo no deseado.
          </p>
          <Link to="/entrar" className="text-sm font-medium underline underline-offset-4">
            Ir a iniciar sesión
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Crear cuenta de piloto"
      subtitle="Tu cuenta es única en LAM y te permite unirte a una o varias aerolíneas."
      footer={
        <>
          ¿Ya tienes cuenta?{' '}
          <Link to="/entrar" className="font-medium text-ink underline underline-offset-4">
            Iniciar sesión
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        {serverError ? <Alert tone="danger">{serverError}</Alert> : null}
        <Field id="displayName" label="Nombre para mostrar" error={errors.displayName?.message}>
          <Input autoComplete="name" {...fieldAria('displayName', errors.displayName?.message)} {...register('displayName')} />
        </Field>
        <Field id="email" label="Correo" error={errors.email?.message}>
          <Input type="email" autoComplete="email" {...fieldAria('email', errors.email?.message)} {...register('email')} />
        </Field>
        <Field id="password" label="Contraseña" error={errors.password?.message} hint={passwordHint}>
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
        <Button type="submit" loading={isSubmitting} className="mt-1">
          Crear cuenta
        </Button>
      </form>
    </AuthLayout>
  );
}
