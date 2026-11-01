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
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { worldCopyJump: true, minZoom: 2, maxZoom: 12, zoomSnap: 0.25 });
    map.setView([22.5, -101.5], 4);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    const observer = new ResizeObserver(() => map.invalidateSize());
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
    for (const leg of legs) {
      const state = states?.[leg.id];
      const stroke = state ? STATE_COLOR[state] : color;
      const path = greatCirclePoints(leg.origin.latitude, leg.origin.longitude, leg.destination.latitude, leg.destination.longitude, 32);
      L.polyline(path, { color: '#0b1220', weight: 6, opacity: 0.55, interactive: false }).addTo(layer);
      const line = L.polyline(path, { color: stroke, weight: 3.5, opacity: 0.95, dashArray: state === 'open' || state === 'repeat' ? '7 6' : undefined }).addTo(layer);
      line.bindTooltip(
        `<strong>Leg ${leg.leg_number}</strong> · ${escapeHtml(leg.origin.icao)} → ${escapeHtml(leg.destination.icao)} · ${leg.distance_nm} NM` +
          (state ? `<br>${escapeHtml(legStateLabels[state])}` : ''),
        { sticky: true, className: 'lam-tip' },
      );
      line.on('click', () => selectRef.current?.(leg.id));
      const mid = path[Math.floor(path.length / 2)]!;
      L.marker(mid, {
        interactive: false,
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
    if (bounds.length > 0) map.fitBounds(L.latLngBounds(bounds), { padding: [36, 36], maxZoom: 7 });
  }, [legs, color, states]);

  return <div ref={containerRef} style={{ height }} className="lam-map z-0 w-full overflow-hidden rounded-lg border border-line" role="region" aria-label="Mapa de los legs del tour" />;
}
