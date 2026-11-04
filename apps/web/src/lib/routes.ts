/** Ruta registrada por un piloto que aún no tiene un PIREP aceptado que llegó a su destino. */
export function isPendingRoute(route: { activated_at: string | null }): boolean {
  return route.activated_at === null;
}

export interface RouteTypeUsage {
  aircraftTypeId: number;
  icao: string;
  flights: number;
  lastFlightAt: string;
}

/** Tipos volados en una ruta, del más usado al menos usado: "B738 ×3 · A20N". */
export function formatTypeUsage(usage: readonly RouteTypeUsage[] | undefined): string | null {
  if (!usage || usage.length === 0) return null;
  return usage.map((u) => (u.flights > 1 ? `${u.icao} ×${u.flights}` : u.icao)).join(' · ');
}

/** Duración que la base calcula si no se da: 430 kt de crucero más 30 minutos. */
export function estimatedRouteMinutes(distanceNm: number): number {
  return Math.min(1440, Math.max(10, Math.round((distanceNm / 430) * 60 + 30)));
}
