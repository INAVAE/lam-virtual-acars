import { zodResolver } from '@hookform/resolvers/zod';
import { signInSchema, type SignInInput } from '@lam/validation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { describeError } from '@/lib/errors';
import { getSupabase } from '@/lib/supabase';
import { AuthLayout } from './auth-layout';

export function SignInPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInInput>({ resolver: zodResolver(signInSchema) });

  async function onSubmit(values: SignInInput) {
    setServerError(null);
    const { error } = await getSupabase().auth.signInWithPassword(values);
    if (error) {
      setServerError(describeError(error));
      return;
    }
    navigate(from, { replace: true });
  }

  return (
    <AuthLayout
      title="Iniciar sesión"
      subtitle="Entra con el correo de tu cuenta de piloto."
      footer={
        <>
          ¿Aún no tienes cuenta?{' '}
          <Link to="/registro" className="font-medium text-ink underline underline-offset-4">
            Crear cuenta
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        {serverError ? <Alert tone="danger">{serverError}</Alert> : null}
        <Field id="email" label="Correo" error={errors.email?.message}>
          <Input type="email" autoComplete="email" {...fieldAria('email', errors.email?.message)} {...register('email')} />
        </Field>
        <Field id="password" label="Contraseña" error={errors.password?.message}>
          <Input
            type="password"
            autoComplete="current-password"
            {...fieldAria('password', errors.password?.message)}
            {...register('password')}
          />
        </Field>
        <div className="flex justify-end">
          <Link to="/recuperar" className="text-sm text-muted underline underline-offset-4 hover:text-ink">
            Olvidé mi contraseña
          </Link>
        </div>
        <Button type="submit" loading={isSubmitting} className="mt-1">
          Iniciar sesión
        </Button>
      </form>
    </AuthLayout>
  );
}
