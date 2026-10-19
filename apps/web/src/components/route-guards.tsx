import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '@/lib/auth';
import { FullPageStatus } from './full-page-status';

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
  return <Outlet />;
}

/** Pantallas de acceso: si ya hay sesión, se va al dashboard. */
export function GuestOnly() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageStatus message="Cargando…" />;
  if (user) return <Navigate to="/" replace />;
  return <Outlet />;
}
