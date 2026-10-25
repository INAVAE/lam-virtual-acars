import { useMyMemberships } from '@/hooks/use-lam-data';
import { useAirlineScope } from './airline-scope';

export interface AirlinePermissions {
  isOrgAdmin: boolean;
  /** Puede editar la aerolínea, su flota, rutas y miembros. */
  canManage: boolean;
  /** Puede supervisar (administrador o jefe de operaciones). */
  canStaff: boolean;
  isMember: boolean;
  /** Tiene membresía activa propia (requisito para reservar, aun siendo superadministrador). */
  hasMembership: boolean;
}

/**
 * Permisos de quien usa la web sobre una aerolínea. Solo sirven para mostrar
 * u ocultar controles: la base de datos aplica las reglas reales con RLS.
 */
export function useAirlinePermissions(airlineId: string | null | undefined): AirlinePermissions {
  const { isOrgAdmin } = useAirlineScope();
  const memberships = useMyMemberships();
  const membership = airlineId
    ? memberships.data?.find((m) => m.airline_id === airlineId && m.status === 'active')
    : undefined;
  const roles = membership?.roles ?? [];
  const isAdmin = roles.includes('airline_admin');
  return {
    isOrgAdmin,
    canManage: isOrgAdmin || isAdmin,
    canStaff: isOrgAdmin || isAdmin || roles.includes('ops_chief'),
    isMember: isOrgAdmin || Boolean(membership),
    hasMembership: Boolean(membership),
  };
}
