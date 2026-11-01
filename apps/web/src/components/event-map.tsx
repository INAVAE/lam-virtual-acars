import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { greatCirclePoints } from '@/lib/live';
import { mapTileConfig } from '@/lib/map-tiles';
import type { TourAirport } from '@/lib/tours';

const TILES = mapTileConfig();

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Aeropuertos fijos del evento: la ruta si son dos, o el punto de reunión si es uno. */
export function EventMap({ origin, destination, color, theme, height = '300px' }: { origin: TourAirport | null; destination: TourAirport | null; color: string; theme: 'dark' | 'light'; height?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const tilesRef = useRef<L.TileLayer | null>(null);
  // Encuadre pendiente: se repite cuando el contenedor cambia de tamaño (p. ej. al cargar en un teléfono).
  const fitRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { worldCopyJump: true, minZoom: 2, maxZoom: 12, zoomSnap: 0.25 });
    map.setView([22.5, -101.5], 4);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
      fitRef.current?.();
    });
    map.on('dragstart zoomstart', (e) => {
      // Si el piloto mueve el mapa, deja de reencuadrar solo.
      if ((e as L.LeafletEvent & { originalEvent?: Event }).originalEvent) fitRef.current = null;
    });
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      tilesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    tilesRef.current?.remove();
    const options: L.TileLayerOptions & { referrerPolicy?: ReferrerPolicy } = {
      attribution: TILES.attribution,
      maxZoom: TILES.maxZoom,
      referrerPolicy: 'strict-origin-when-cross-origin',
      className: theme === 'dark' ? 'lam-tiles-dark' : 'lam-tiles-light',
    };
    tilesRef.current = L.tileLayer(TILES.url, options).addTo(map);
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (origin && destination) {
      const path = greatCirclePoints(origin.latitude, origin.longitude, destination.latitude, destination.longitude, 40);
      L.polyline(path, { color: '#0b1220', weight: 6, opacity: 0.55, interactive: false }).addTo(layer);
      L.polyline(path, { color, weight: 3.5, opacity: 0.95, interactive: false }).addTo(layer);
    }
    const points: [TourAirport, string][] = [];
    if (origin) points.push([origin, destination ? 'Salida' : 'Salida de todos']);
    if (destination) points.push([destination, origin ? 'Llegada' : 'Llegada de todos']);
    for (const [a, role] of points) {
      L.circleMarker([a.latitude, a.longitude], { radius: 7, color: '#0b1220', weight: 2, fillColor: color, fillOpacity: 1 })
        .bindTooltip(`<strong>${escapeHtml(a.icao)}</strong> · ${escapeHtml(role)}`, { permanent: true, direction: 'right', offset: [8, 0], className: 'lam-tip' })
        .addTo(layer);
    }
    const first = points[0]?.[0];
    fitRef.current =
      points.length === 2
        ? () => map.fitBounds(L.latLngBounds(points.map(([a]) => [a.latitude, a.longitude] as L.LatLngTuple)), { padding: [40, 40], maxZoom: 7 })
        : first
          ? () => map.setView([first.latitude, first.longitude], 5)
          : null;
    fitRef.current?.();
  }, [origin, destination, color]);

  return <div ref={containerRef} style={{ height }} className="lam-map z-0 w-full overflow-hidden rounded-lg border border-line" role="region" aria-label="Mapa del evento" />;
}
