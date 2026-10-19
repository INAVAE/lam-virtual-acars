import { zodResolver } from '@hookform/resolvers/zod';
import { passwordResetRequestSchema, type PasswordResetRequestInput } from '@lam/validation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { describeError } from '@/lib/errors';
import { getSupabase } from '@/lib/supabase';
import { appUrl } from '@/lib/urls';
import { AuthLayout } from './auth-layout';

export function ForgotPasswordPage() {
  const [serverError, setServerError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PasswordResetRequestInput>({ resolver: zodResolver(passwordResetRequestSchema) });

  async function onSubmit(values: PasswordResetRequestInput) {
    setServerError(null);
    const { error } = await getSupabase().auth.resetPasswordForEmail(values.email, {
      redirectTo: appUrl('restablecer'),
    });
    if (error) {
      setServerError(describeError(error));
      return;
    }
    setSent(true);
  }

  return (
    <AuthLayout
      title="Recuperar contraseña"
      subtitle="Te enviaremos un enlace para elegir una contraseña nueva."
      footer={
        <Link to="/entrar" className="font-medium text-ink underline underline-offset-4">
          Volver a iniciar sesión
        </Link>
      }
    >
      {sent ? (
        <Alert tone="ok">
          Si existe una cuenta con ese correo, recibirás el enlace en unos minutos. Ábrelo en este mismo navegador.
        </Alert>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {serverError ? <Alert tone="danger">{serverError}</Alert> : null}
          <Field id="email" label="Correo" error={errors.email?.message}>
            <Input type="email" autoComplete="email" {...fieldAria('email', errors.email?.message)} {...register('email')} />
          </Field>
          <Button type="submit" loading={isSubmitting}>
            Enviar enlace
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
