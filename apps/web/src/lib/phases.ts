import type { FlightPhase } from '@lam/validation';

/** Nombres de las fases del vuelo tal como las ve el piloto. */
export const phaseLabels: Record<FlightPhase, string> = {
  aircraft_connected: 'Aeronave conectada',
  preflight: 'Prevuelo',
  engines_started: 'Motores encendidos',
  pushback: 'Pushback',
  taxi_out: 'Rodaje de salida',
  takeoff: 'Despegue',
  initial_climb: 'Ascenso inicial',
  climb: 'Ascenso',
  cruise: 'Crucero',
  descent: 'Descenso',
  approach: 'Aproximación',
  landing: 'Aterrizaje',
  taxi_in: 'Rodaje de llegada',
  engines_shutdown: 'Motores apagados',
  flight_completed: 'Vuelo completado',
};

export function phaseLabel(phase: string | null | undefined): string {
  if (!phase) return '—';
  return phaseLabels[phase as FlightPhase] ?? phase;
}
