import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAirlines, useIsOrgAdmin, useMyMemberships, type Airline } from '@/hooks/use-lam-data';
import { readableTextOn, safeAccent } from './color';
import { readStored, writeStored } from './storage';

const STORAGE_KEY = 'lam.selectedAirline';

interface AirlineScope {
  /** Aerolíneas que se pueden elegir en el selector. */
  options: Airline[];
  /** null = vista consolidada de LAM (solo superadministradores) o sin aerolíneas. */
  selected: Airline | null;
  canSeeAll: boolean;
  isOrgAdmin: boolean;
  ready: boolean;
  select: (airlineId: string | null) => void;
}

const AirlineScopeContext = createContext<AirlineScope | null>(null);

export function AirlineScopeProvider({ children }: { children: ReactNode }) {
  const airlines = useAirlines();
  const memberships = useMyMemberships();
  const orgAdmin = useIsOrgAdmin();
  const [selectedId, setSelectedId] = useState<string | null>(() => readStored(STORAGE_KEY));

  const isOrgAdmin = orgAdmin.data === true;
  const ready = airlines.isSuccess && memberships.isSuccess && orgAdmin.isSuccess;

  const options = useMemo(() => {
    const all = airlines.data ?? [];
    if (isOrgAdmin) return all;
    const activeIds = new Set((memberships.data ?? []).filter((m) => m.status === 'active').map((m) => m.airline_id));
    return all.filter((a) => activeIds.has(a.id));
  }, [airlines.data, memberships.data, isOrgAdmin]);

  const selected = useMemo(() => {
    const match = options.find((a) => a.id === selectedId) ?? null;
    if (match) return match;
    // Sin selección válida: el superadministrador ve LAM completo; el resto, su primera aerolínea.
    return isOrgAdmin ? null : (options[0] ?? null);
  }, [options, selectedId, isOrgAdmin]);

  useEffect(() => {
    const root = document.documentElement;
    const accent = safeAccent(selected?.brand_primary_color);
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-fg', readableTextOn(accent));
  }, [selected]);

  const value = useMemo<AirlineScope>(
    () => ({
      options,
      selected,
      canSeeAll: isOrgAdmin,
      isOrgAdmin,
      ready,
      select: (airlineId) => {
        setSelectedId(airlineId);
        writeStored(STORAGE_KEY, airlineId);
      },
    }),
    [options, selected, isOrgAdmin, ready],
  );

  return <AirlineScopeContext.Provider value={value}>{children}</AirlineScopeContext.Provider>;
}

export function useAirlineScope(): AirlineScope {
  const ctx = useContext(AirlineScopeContext);
  if (!ctx) throw new Error('useAirlineScope debe usarse dentro de AirlineScopeProvider');
  return ctx;
}
