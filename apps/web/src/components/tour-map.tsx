import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { greatCirclePoints } from '@/lib/live';
import { mapTileConfig } from '@/lib/map-tiles';
import { legStateLabels, type LegState, type TourLeg } from '@/lib/tours';

const TILES = mapTileConfig();

const STATE_COLOR: Record<LegState, string> = {
  accepted: '#22c55e',
  in_review: '#38bdf8',
  booked: '#38bdf8',
  repeat: '#ef4444',
  open: '#94a3b8',
};

/** Orden de dibujo: lo completado queda encima de lo pendiente (un leg de regreso no lo tapa). */
const STATE_ORDER: Record<LegState, number> = { open: 0, repeat: 1, booked: 2, in_review: 3, accepted: 4 };

/**
 * Curva un arco hacia un lado: si dos legs unen los mismos aeropuertos (ida y
 * regreso), cada uno se separa del otro y los dos se ven.
 */
export function bowPath(path: readonly [number, number][], amount: number): [number, number][] {
  if (path.length < 3 || amount === 0) return [...path];
  const [lat0, lon0] = path[0]!;
  const [lat1, lon1] = path[path.length - 1]!;
  const dLat = lat1 - lat0;
  const dLon = lon1 - lon0;
  const len = Math.hypot(dLat, dLon) || 1;
  // Perpendicular a la dirección del leg: el regreso queda del otro lado.
  const nLat = -dLon / len;
  const nLon = dLat / len;
  return path.map(([lat, lon], i) => {
    const k = Math.sin((Math.PI * i) / (path.length - 1)) * amount * len;
    return [lat + nLat * k, lon + nLon * k] as [number, number];
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * Legs del tour sobre el mapa, en arco de círculo máximo. Sin avance del piloto
 * se pintan con el color del tour; con avance, cada leg con el color de su estado.
 */
export function TourMap({
  legs,
  color,
  states,
  theme,
  height = '360px',
  onSelect,
}: {
  legs: readonly TourLeg[];
  color: string;
  states?: Readonly<Record<string, LegState>>;
  theme: 'dark' | 'light';
  height?: string;
  onSelect?: (legId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const tilesRef = useRef<L.TileLayer | null>(null);
  // Encuadre pendiente: se repite cuando el contenedor cambia de tamaño (p. ej. al cargar en un teléfono).
  const fitRef = useRef<(() => void) | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { worldCopyJump: true, minZoom: 2, maxZoom: 12, zoomSnap: 0.25 });
    map.setView([22.5, -101.5], 4);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    const observer = new ResizeObserver(() => {
      // El observador puede llegar tarde, cuando el mapa ya no existe.
      if (mapRef.current !== map) return;
      map.invalidateSize({ animate: false });
      if (map.getSize().x > 0 && map.getSize().y > 0) fitRef.current?.();
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
    const bounds: L.LatLngExpression[] = [];
    const airports = new Map<number, { lat: number; lon: number; icao: string; legs: number[] }>();
    // Pares de aeropuertos que se repiten (ida y regreso): esos legs se curvan.
    const pairCount = new Map<string, number>();
    const pairKey = (leg: TourLeg) => [leg.origin.id, leg.destination.id].sort((a, b) => a - b).join('-');
    for (const leg of legs) pairCount.set(pairKey(leg), (pairCount.get(pairKey(leg)) ?? 0) + 1);
    const ordered = [...legs].sort((a, b) => {
      const sa = states?.[a.id];
      const sb = states?.[b.id];
      return (sa ? STATE_ORDER[sa] : 0) - (sb ? STATE_ORDER[sb] : 0) || a.leg_number - b.leg_number;
    });
    for (const leg of ordered) {
      const state = states?.[leg.id];
      const stroke = state ? STATE_COLOR[state] : color;
      const done = state === 'accepted';
      const arc = greatCirclePoints(leg.origin.latitude, leg.origin.longitude, leg.destination.latitude, leg.destination.longitude, 32);
      const path = (pairCount.get(pairKey(leg)) ?? 1) > 1 ? bowPath(arc, 0.12) : arc;
      L.polyline(path, { color: '#0b1220', weight: done ? 8 : 6, opacity: 0.55, interactive: false }).addTo(layer);
      const line = L.polyline(path, { color: stroke, weight: done ? 5 : 3.5, opacity: 0.95, dashArray: state === 'open' || state === 'repeat' ? '7 6' : undefined }).addTo(layer);
      line.bindTooltip(
        `<strong>Leg ${leg.leg_number}</strong> · ${escapeHtml(leg.origin.icao)} → ${escapeHtml(leg.destination.icao)} · ${leg.distance_nm} NM` +
          (state ? `<br>${escapeHtml(legStateLabels[state])}` : ''),
        { sticky: true, className: 'lam-tip' },
      );
      line.on('click', () => selectRef.current?.(leg.id));
      const mid = path[Math.floor(path.length / 2)]!;
      L.marker(mid, {
        interactive: false,
        zIndexOffset: done ? 1000 : 0,
        icon: L.divIcon({
          className: 'lam-leg-icon',
          html: `<div class="lam-ev lam-ev-sm" style="--ev:${stroke}">${leg.leg_number}</div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        }),
      }).addTo(layer);
      for (const a of [leg.origin, leg.destination]) {
        const entry = airports.get(a.id) ?? { lat: a.latitude, lon: a.longitude, icao: a.icao, legs: [] };
        entry.legs.push(leg.leg_number);
        airports.set(a.id, entry);
        bounds.push([a.latitude, a.longitude]);
      }
    }
    for (const a of airports.values()) {
      L.circleMarker([a.lat, a.lon], { radius: 5, color: '#0b1220', weight: 2, fillColor: '#ffffff', fillOpacity: 1 })
        .bindTooltip(`<strong>${escapeHtml(a.icao)}</strong>`, { permanent: true, direction: 'right', offset: [6, 0], className: 'lam-tip' })
        .addTo(layer);
    }
    fitRef.current = bounds.length > 0 ? () => map.fitBounds(L.latLngBounds(bounds), { padding: [36, 36], maxZoom: 7, animate: false }) : null;
    // Sin tamaño todavía (contenedor oculto o aún sin layout): el observador encuadra después.
    if (map.getSize().x > 0 && map.getSize().y > 0) fitRef.current?.();
  }, [legs, color, states]);

  const counts = states ? Object.values(states).reduce<Record<string, number>>((acc, st) => ({ ...acc, [st]: (acc[st] ?? 0) + 1 }), {}) : null;
  return (
    <div className="space-y-2">
      <div ref={containerRef} style={{ height }} className="lam-map z-0 w-full overflow-hidden rounded-lg border border-line" role="region" aria-label="Mapa de los legs del tour" />
      {counts ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Tu avance en el mapa">
          <li className="flex items-center gap-1.5">
            <span className="h-1.5 w-5 rounded-full" style={{ background: STATE_COLOR.accepted }} aria-hidden />
            {`Completados (PIREP aceptado): ${counts.accepted ?? 0} de ${legs.length}`}
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-1.5 w-5 rounded-full" style={{ background: STATE_COLOR.in_review }} aria-hidden />
            {`Reservados o en revisión: ${(counts.in_review ?? 0) + (counts.booked ?? 0)}`}
          </li>
          {counts.repeat ? (
            <li className="flex items-center gap-1.5">
              <span className="w-5 border-t-2 border-dashed" style={{ borderColor: STATE_COLOR.repeat }} aria-hidden />
              {`Por repetir: ${counts.repeat}`}
            </li>
          ) : null}
          <li className="flex items-center gap-1.5">
            <span className="w-5 border-t-2 border-dashed" style={{ borderColor: STATE_COLOR.open }} aria-hidden />
            {`Por volar: ${counts.open ?? 0}`}
          </li>
        </ul>
      ) : null}
    </div>
  );
}
