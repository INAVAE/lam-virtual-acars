import { ShieldOff } from 'lucide-react';
import { useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useProfile } from '@/hooks/use-lam-data';
import { useAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { FullPageStatus } from './full-page-status';
import { Button } from './ui/button';

/** Cuenta con el acceso revocado: no ve nada de la plataforma. */
function AccessRevoked() {
  const [busy, setBusy] = useState(false);
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="max-w-md space-y-4 rounded-md border border-line bg-surface p-6 text-center">
        <ShieldOff className="mx-auto size-8 text-danger-ink" aria-hidden />
        <h1 className="text-xl font-semibold">Tu acceso fue revocado</h1>
        <p className="text-[15px] text-muted">
          Un superadministrador de LAM revocó el acceso de esta cuenta. Si crees que es un error, escribe al staff de tu
          aerolínea.
        </p>
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await getSupabase().auth.signOut();
            setBusy(false);
          }}
        >
          Cerrar sesión
        </Button>
      </div>
    </main>
  );
}

/** Rutas que requieren sesión. Los visitantes van a la página pública. */
export function RequireAuth() {
  const { user, loading, recovering } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageStatus message="Cargando tu sesión…" />;
  if (recovering) return <Navigate to="/restablecer" replace />;
  if (!user) {
    const from = location.pathname === '/' ? undefined : location.pathname;
    return <Navigate to={from ? '/entrar' : '/bienvenida'} replace state={from ? { from } : undefined} />;
  }
  return <SignedIn />;
}

function SignedIn() {
  const profile = useProfile();
  if (profile.data?.account_status === 'suspended') return <AccessRevoked />;
  return <Outlet />;
}

/** Pantallas de acceso: si ya hay sesión, se va al dashboard. */
export function GuestOnly() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageStatus message="Cargando…" />;
  if (user) return <Navigate to="/" replace />;
  return <Outlet />;
}
