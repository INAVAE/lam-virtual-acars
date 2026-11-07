import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { FullPageStatus } from '@/components/full-page-status';
import { useAuth } from '@/lib/auth';
import { AuthLayout } from './auth-layout';

function linkError(): string | null {
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return search.get('error_description') ?? hash.get('error_description');
}

/** Destino de los enlaces de confirmación de correo. supabase-js canjea el código al cargar. */
export function AuthCallbackPage() {
  const { session, loading, welcome } = useAuth();
  const navigate = useNavigate();
  const error = linkError();

  useEffect(() => {
    if (!loading && session) {
      if (welcome) {
        // Cuenta aprobada: primero la contraseña.
        navigate('/restablecer?bienvenida=1', { replace: true });
        return;
      }
      toast.success('Correo confirmado. Bienvenido a LAM.');
      navigate('/', { replace: true });
    }
  }, [loading, session, welcome, navigate]);

  if (loading || session) return <FullPageStatus message={welcome ? 'Abriendo tu invitación…' : 'Confirmando tu cuenta…'} />;

  return (
    <AuthLayout title="No pudimos iniciar tu sesión">
      <div className="flex flex-col gap-4">
        {error ? <p className="text-danger-ink">{error}</p> : null}
        <p>
          Si abriste el enlace en otro navegador o dispositivo, tu correo probablemente ya quedó confirmado. Inicia sesión
          con tu contraseña. Si era una invitación que venció, pide al administrador que te la reenvíe.
        </p>
        <Link to="/entrar" className="font-medium underline underline-offset-4">
          Iniciar sesión
        </Link>
      </div>
    </AuthLayout>
  );
}
