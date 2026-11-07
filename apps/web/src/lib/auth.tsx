import type { Session, User } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { pendingEmailLink, supabase } from './supabase';

interface AuthState {
  session: Session | null;
  user: User | null;
  /** true mientras se restaura la sesión guardada o se procesa un enlace de correo. */
  loading: boolean;
  /** true si la sesión viene de un enlace de recuperación de contraseña. */
  recovering: boolean;
  clearRecovering: () => void;
  /** true si la sesión viene de la invitación de una cuenta de piloto aprobada: falta elegir contraseña. */
  welcome: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [recovering, setRecovering] = useState(pendingEmailLink?.type === 'recovery');
  const [welcome] = useState(pendingEmailLink?.type === 'invite');

  useEffect(() => {
    if (!supabase) return;
    let active = true;

    const client = supabase;
    // Enlace de invitación o de recuperación con la sesión en el fragmento.
    const opened = pendingEmailLink
      ? client.auth.setSession({ access_token: pendingEmailLink.access_token, refresh_token: pendingEmailLink.refresh_token }).then(() => undefined)
      : Promise.resolve();
    opened
      .catch(() => undefined)
      .then(() => client.auth.getSession())
      .then(({ data }) => {
        if (active) setSession(data.session);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      if (event === 'SIGNED_OUT') setRecovering(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      recovering,
      clearRecovering: () => setRecovering(false),
      welcome,
    }),
    [session, loading, recovering, welcome],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
