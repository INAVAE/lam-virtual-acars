import type { ReactNode } from 'react';
import { useAirlineScope } from '@/lib/airline-scope';
import type { Airline } from '@/hooks/use-lam-data';
import { Skeleton } from './ui/skeleton';

/**
 * Las pantallas de una sola aerolínea (pilotos, flota, rutas) necesitan una
 * aerolínea seleccionada. En la vista consolidada de LAM se pide elegir una.
 */
export function ScopeRequired({ children }: { children: (airline: Airline) => ReactNode }) {
  const { selected, ready, options } = useAirlineScope();
  if (!ready) return <Skeleton className="h-64" />;
  if (!selected) {
    return (
      <div className="rounded-lg border border-dashed border-line px-6 py-12 text-center">
        <p className="font-display text-lg font-semibold">Elige una aerolínea</p>
        <p className="mx-auto mt-1 max-w-md text-muted">
          {options.length > 0
            ? 'Esta sección trabaja con una aerolínea a la vez. Elígela en el selector de la parte superior.'
            : 'Todavía no perteneces a ninguna aerolínea activa.'}
        </p>
      </div>
    );
  }
  return <>{children(selected)}</>;
}
