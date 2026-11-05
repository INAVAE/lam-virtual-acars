import { useQueries, useQuery } from '@tanstack/react-query';
import { cleanFixes, latestRadarFrame, type FirIndex, type FlightRoute, type IvaoAtcResponse, type RadarFrame } from '@/lib/map-layers';
import { getSupabase } from '@/lib/supabase';

/** Puntos del plan de SimBrief de los vuelos elegidos en el mapa. */
export function useFlightRoutes(flightIds: readonly string[], enabled: boolean) {
  return useQueries({
    queries: flightIds.map((id) => ({
      queryKey: ['live-route', id],
      enabled,
      staleTime: 5 * 60_000,
      queryFn: async (): Promise<FlightRoute> => {
        const { data, error } = await getSupabase().rpc('get_live_flight_route', { p_flight_id: id });
        if (error) throw error;
        const v = (data ?? {}) as { fixes?: unknown; route?: unknown };
        return { fixes: cleanFixes(v.fixes), route: typeof v.route === 'string' ? v.route : null };
      },
    })),
  });
}

/**
 * Controladores conectados a IVAO. El servidor descarga el Whazzup público cada
 * 30 s mientras alguien mira el mapa; aquí se lee con la misma frecuencia.
 */
export function useIvaoAtc(enabled: boolean) {
  return useQuery({
    queryKey: ['ivao-atc'],
    enabled,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<IvaoAtcResponse> => {
      const { data, error } = await getSupabase().rpc('get_ivao_atc');
      if (error) throw error;
      const v = (data ?? {}) as Partial<IvaoAtcResponse>;
      return {
        fetched_at: v.fetched_at ?? null,
        ivao_updated_at: v.ivao_updated_at ?? null,
        stale: v.stale ?? true,
        error: v.error ?? null,
        atcs: Array.isArray(v.atcs) ? v.atcs : [],
      };
    },
  });
}

/** Elemento de Boundaries.geojson (VATSpy Data Project). */
export interface FirFeature {
  type: 'Feature';
  properties: { id?: string; label_lat?: string; label_lon?: string; oceanic?: string } | null;
  geometry: unknown;
}

export interface FirData {
  index: FirIndex;
  /** Límite de cada FIR por id, del VATSpy Data Project (CC BY-SA 4.0). */
  boundaries: Map<string, FirFeature[]>;
}

/** Límites de FIR, servidos con el sitio (public/data/vatspy). Se descargan una vez y solo si hay CTR o FSS. */
export function useFirData(enabled: boolean) {
  return useQuery({
    queryKey: ['fir-data'],
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    queryFn: async (): Promise<FirData> => {
      const base = `${import.meta.env.BASE_URL}data/vatspy/`;
      const [index, geo] = await Promise.all([
        fetch(`${base}fir-index.json`).then((r) => (r.ok ? (r.json() as Promise<FirIndex>) : Promise.reject(new Error('Sin índice de FIR')))),
        fetch(`${base}Boundaries.geojson`).then((r) =>
          r.ok ? (r.json() as Promise<{ features: FirFeature[] }>) : Promise.reject(new Error('Sin límites de FIR')),
        ),
      ]);
      const boundaries = new Map<string, FirFeature[]>();
      for (const f of geo.features ?? []) {
        const id = f.properties?.id;
        if (typeof id === 'string') boundaries.set(id, [...(boundaries.get(id) ?? []), f]);
      }
      return { index, boundaries };
    },
  });
}

/** Último cuadro del radar de RainViewer (se publica cada 10 minutos). */
export function useRadarFrame(enabled: boolean) {
  return useQuery({
    queryKey: ['radar-frame'],
    enabled,
    refetchInterval: 10 * 60_000,
    refetchIntervalInBackground: false,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<RadarFrame | null> => {
      const r = await fetch('https://api.rainviewer.com/public/weather-maps.json');
      if (!r.ok) throw new Error('El radar no está disponible');
      return latestRadarFrame(await r.json());
    },
  });
}
