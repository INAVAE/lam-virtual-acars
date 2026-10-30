import type { BookFlightResult, RouteAircraftOption } from '@lam/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';

/** Aeronaves de la ruta con el motivo por el que no se pueden reservar (lo decide la base de datos). */
export function useRouteAircraftOptions(routeId: string | null) {
  return useQuery({
    queryKey: ['route-aircraft-options', routeId],
    enabled: Boolean(routeId),
    staleTime: 0,
    queryFn: async (): Promise<RouteAircraftOption[]> => {
      const { data, error } = await getSupabase().rpc('route_aircraft_options', { p_route_id: routeId! });
      if (error) throw error;
      return data;
    },
  });
}

function invalidateOperations(queryClient: ReturnType<typeof useQueryClient>) {
  for (const key of ['my-flights', 'route-aircraft-options', 'fleet', 'dashboard-summary', 'airline-bookings']) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export function useBookFlight() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ routeId, aircraftId, callsign }: { routeId: string; aircraftId: string; callsign: string }) => {
      const { data, error } = await getSupabase().rpc('book_flight', {
        p_route_id: routeId,
        p_aircraft_id: aircraftId,
        p_callsign: callsign,
      });
      if (error) throw error;
      return data as unknown as BookFlightResult;
    },
    onSettled: () => invalidateOperations(queryClient),
  });
}

export function useCancelBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await getSupabase().rpc('cancel_booking', { p_booking_id: bookingId });
      if (error) throw error;
    },
    onSettled: () => invalidateOperations(queryClient),
  });
}

const FLIGHT_SELECT =
  'id, booking_id, airline_id, user_id, aircraft_id, aircraft_registration, airline_icao, flight_number, callsign, planned_distance_nm, planned_minutes, scheduled_departure_at, operation_type, network, flight_plan_remarks, status, created_at, started_at, completed_at, cancelled_at, airline:airlines!flights_airline_id_fkey(name, slug, logo_path, brand_primary_color), type:aircraft_types!flights_aircraft_type_id_fkey(icao_code, manufacturer, model), origin:airports!flights_origin_airport_id_fkey(icao_code, name, city), destination:airports!flights_destination_airport_id_fkey(icao_code, name, city), booking:flight_bookings!flights_booking_id_fkey(id, status, expires_at, closed_at), ofp:simbrief_ofps!simbrief_ofps_flight_id_fkey(*), session:flight_sessions!flight_sessions_flight_id_fkey(id, status, phase, started_at, last_contact_at, sim_aircraft_title, end_reason), live:flight_positions_live!flight_positions_live_flight_id_fkey(altitude_ft, gs_kt, ias_kt, vs_fpm, on_ground, sampled_at), pirep:pireps!pireps_flight_id_fkey(id, status, score)' as const;

export type FlightView = 'upcoming' | 'history';

/** Vuelos propios. "upcoming": reservados o en vuelo; "history": el resto. */
export function useMyFlights(view: FlightView, airlineId: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-flights', user?.id, view, airlineId],
    enabled: Boolean(user),
    // Con un vuelo en curso, la fase y la posición se refrescan cada 15 s.
    refetchInterval: (query) =>
      view === 'upcoming' && (query.state.data ?? []).some((f) => f.status === 'in_progress') ? 15_000 : false,
    queryFn: async () => {
      let query = getSupabase()
        .from('flights')
        .select(FLIGHT_SELECT)
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(view === 'upcoming' ? 20 : 100);
      query = view === 'upcoming' ? query.in('status', ['scheduled', 'in_progress']) : query.in('status', ['completed', 'cancelled']);
      if (airlineId) query = query.eq('airline_id', airlineId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export type MyFlight = NonNullable<ReturnType<typeof useMyFlights>['data']>[number];

/** Reservas activas de la aerolínea (vista del staff). */
export function useAirlineActiveFlights(airlineId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['airline-bookings', airlineId],
    enabled: Boolean(airlineId) && enabled,
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('flights')
        .select(
          'id, callsign, airline_icao, flight_number, aircraft_registration, status, scheduled_departure_at, created_at, pilot:profiles!flights_user_id_fkey(display_name, pilot_number), type:aircraft_types!flights_aircraft_type_id_fkey(icao_code), origin:airports!flights_origin_airport_id_fkey(icao_code), destination:airports!flights_destination_airport_id_fkey(icao_code), booking:flight_bookings!flights_booking_id_fkey(id, status, expires_at)',
        )
        .eq('airline_id', airlineId!)
        .in('status', ['scheduled', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });
}

export type AirlineActiveFlight = NonNullable<ReturnType<typeof useAirlineActiveFlights>['data']>[number];

interface FunctionErrorBody {
  code?: string;
  error?: string;
}

export class SimbriefImportError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

/** Importa el último OFP de SimBrief del piloto al vuelo indicado. */
export function useImportOfp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (flightId: string) => {
      const { error } = await getSupabase().functions.invoke('simbrief-ofp', { body: { flight_id: flightId } });
      if (error) {
        // El cuerpo de la respuesta trae el motivo en español y un código.
        const context = (error as { context?: Response }).context;
        if (context && typeof context.json === 'function') {
          const body = (await context.json().catch(() => null)) as FunctionErrorBody | null;
          if (body?.error) throw new SimbriefImportError(body.error, body.code ?? 'unknown');
        }
        throw error;
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['my-flights'] }),
  });
}
