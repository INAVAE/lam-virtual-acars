import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import {
  formatZuluTime,
  nearestIndexByPosition,
  nearestIndexByTime,
  pointColor,
  segmentsBy,
  type AnalysisPoint,
  type ColorMode,
  type EventMarker,
} from '@/lib/flight-analysis';
import { formatNumber } from '@/lib/format';
import { phaseLabel } from '@/lib/phases';

export interface MapAirport {
  icao: string;
  name: string;
  latitude: number;
  longitude: number;
  role: 'origin' | 'destination' | 'arrival';
}

export type MapFocus = { target: 'route' | 'origin' | 'destination' | 'arrival' | 'point'; index?: number; nonce: number };

interface FlightMapProps {
  points: readonly AnalysisPoint[];
  times: readonly number[];
  markers: readonly EventMarker[];
  airports: readonly MapAirport[];
  colorMode: ColorMode;
  activeIndex: number | null;
  onHover: (index: number | null) => void;
  onSelect: (index: number) => void;
  theme: 'dark' | 'light';
  focus: MapFocus;
  height: string;
}

// Teselas de OpenStreetMap (sin clave). En modo oscuro se invierten con CSS
// para un mapa nocturno; a zoom alto se ven pistas y calles de rodaje.
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const PLANE_SVG =
  '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M12 2c.8 0 1.4.7 1.4 1.6v5.6l7.6 4.4v2l-7.6-2.3v4.6l2.2 1.7v1.6L12 20.1l-3.6 1.1v-1.6l2.2-1.7v-4.6L3 15.6v-2l7.6-4.4V3.6C10.6 2.7 11.2 2 12 2z" fill="currentColor" stroke="#0b1220" stroke-width="0.8"/></svg>';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function pointSummary(p: AnalysisPoint): string {
  const rows = [
    `<strong>${escapeHtml(phaseLabel(p.phase))}</strong> · ${formatZuluTime(p.sampled_at)}`,
    `${formatNumber(p.altitude_ft)} ft · VS ${p.vs_fpm === null ? '—' : formatNumber(p.vs_fpm)} fpm`,
    `IAS ${p.ias_kt ?? '—'} kt · GS ${p.gs_kt ?? '—'} kt${p.heading_deg === null ? '' : ` · ${String(Math.round(p.heading_deg)).padStart(3, '0')}°`}`,
  ];
  return rows.join('<br>');
}

/**
 * Mapa interactivo de la traza (Leaflet): tramos coloreados por fase o por
 * altitud, aeropuertos, eventos y el punto activo sincronizado con las gráficas.
 */
export function FlightMap({ points, times, markers, airports, colorMode, activeIndex, onHover, onSelect, theme, focus, height }: FlightMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tilesRef = useRef<L.TileLayer | null>(null);
  const trackRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const activeRef = useRef<L.Marker | null>(null);
  const fittedRef = useRef(false);
  const handlers = useRef({ onHover, onSelect });
  handlers.current = { onHover, onSelect };

  // Mapa (una sola vez)
  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: true,
      worldCopyJump: true,
      minZoom: 2,
      maxZoom: 18,
      // Zoom fraccionario: el encuadre aprovecha todo el mapa y la rueda es más suave.
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 90,
    });
    map.setView([19.43, -99.07], 6);
    mapRef.current = map;
    trackRef.current = L.layerGroup().addTo(map);
    markersRef.current = L.layerGroup().addTo(map);
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      tilesRef.current = null;
      activeRef.current = null;
      fittedRef.current = false;
    };
  }, []);

  // Teselas según el tema
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    tilesRef.current?.remove();
    tilesRef.current = L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19, className: theme === 'dark' ? 'lam-tiles-dark' : 'lam-tiles-light' }).addTo(map);
  }, [theme]);

  // Traza
  useEffect(() => {
    const map = mapRef.current;
    const group = trackRef.current;
    if (!map || !group) return;
    group.clearLayers();
    if (points.length < 2) return;
    const latlngs = points.map((p) => L.latLng(p.latitude, p.longitude));

    // Contorno oscuro para que la línea se lea sobre cualquier tesela.
    L.polyline(latlngs, { color: theme === 'dark' ? '#000' : '#fff', weight: 7, opacity: 0.55, interactive: false, lineJoin: 'round' }).addTo(group);
    for (const s of segmentsBy(points, colorMode)) {
      L.polyline(latlngs.slice(s.from, s.to + 1), { color: s.color, weight: 4, opacity: 1, interactive: false, lineJoin: 'round', lineCap: 'round' }).addTo(group);
    }
    // Línea invisible y ancha para detectar el puntero.
    const hit = L.polyline(latlngs, { color: '#000', weight: 22, opacity: 0, lineJoin: 'round' }).addTo(group);
    hit.on('mousemove', (e: L.LeafletMouseEvent) => handlers.current.onHover(nearestIndexByPosition(points, e.latlng.lat, e.latlng.lng)));
    hit.on('mouseout', () => handlers.current.onHover(null));
    hit.on('click', (e: L.LeafletMouseEvent) => handlers.current.onSelect(nearestIndexByPosition(points, e.latlng.lat, e.latlng.lng)));

    if (!fittedRef.current) {
      map.fitBounds(L.latLngBounds(latlngs), { padding: [36, 36] });
      fittedRef.current = true;
    }
  }, [points, colorMode, theme]);

  // Aeropuertos y eventos
  useEffect(() => {
    const group = markersRef.current;
    if (!group) return;
    group.clearLayers();

    for (const a of airports) {
      const tone = a.role === 'origin' ? 'lam-ap-origin' : a.role === 'arrival' ? 'lam-ap-arrival' : 'lam-ap-destination';
      L.marker([a.latitude, a.longitude], {
        icon: L.divIcon({ className: '', html: `<div class="lam-ap ${tone}"><span></span>${escapeHtml(a.icao)}</div>`, iconSize: [0, 0] }),
        keyboard: false,
      })
        .bindTooltip(`<strong>${escapeHtml(a.icao)}</strong> · ${escapeHtml(a.name)}<br>${a.role === 'origin' ? 'Salida' : a.role === 'arrival' ? 'Llegada real' : 'Destino'}`, {
          className: 'lam-tip',
          direction: 'top',
          offset: [0, -10],
        })
        .addTo(group);
    }

    for (const m of markers) {
      let lat = m.latitude;
      let lon = m.longitude;
      if (lat === null || lon === null) {
        const i = nearestIndexByTime(times, m.time);
        if (i < 0) continue;
        lat = points[i]!.latitude;
        lon = points[i]!.longitude;
      }
      L.marker([lat, lon], {
        icon: L.divIcon({
          className: '',
          html: `<div class="lam-ev" style="--ev:${m.color}">${escapeHtml(m.glyph)}</div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
        keyboard: false,
        zIndexOffset: m.kind === 'takeoff' || m.kind === 'touchdown' ? 500 : 0,
      })
        .bindTooltip(`<strong>${escapeHtml(m.label)}</strong> · ${formatZuluTime(m.time)}${m.detail ? `<br>${escapeHtml(m.detail)}` : ''}`, {
          className: 'lam-tip',
          direction: 'top',
          offset: [0, -10],
        })
        .on('click', () => {
          const i = nearestIndexByTime(times, m.time);
          if (i >= 0) handlers.current.onSelect(i);
        })
        .addTo(group);
    }
  }, [airports, markers, points, times]);

  // Punto activo (sincronizado con las gráficas)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const p = activeIndex !== null ? points[activeIndex] : undefined;
    if (!p) {
      activeRef.current?.remove();
      activeRef.current = null;
      return;
    }
    const icon = L.divIcon({
      className: '',
      html: `<div class="lam-plane" style="color:${pointColor(p, colorMode)};transform:rotate(${Math.round(p.heading_deg ?? 0)}deg)">${PLANE_SVG}</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
    if (!activeRef.current) {
      activeRef.current = L.marker([p.latitude, p.longitude], { icon, interactive: false, keyboard: false, zIndexOffset: 1000 })
        .bindTooltip('', { className: 'lam-tip', direction: 'right', offset: [16, 0], permanent: true })
        .addTo(map);
    } else {
      activeRef.current.setLatLng([p.latitude, p.longitude]).setIcon(icon);
    }
    activeRef.current.setTooltipContent(pointSummary(p));
  }, [activeIndex, points, colorMode]);

  // Encuadres pedidos por los botones
  useEffect(() => {
    const map = mapRef.current;
    if (!map || focus.nonce === 0) return;
    if (focus.target === 'route') {
      if (points.length > 1) map.fitBounds(L.latLngBounds(points.map((p) => [p.latitude, p.longitude] as [number, number])), { padding: [36, 36] });
      return;
    }
    if (focus.target === 'point') {
      const p = focus.index !== undefined ? points[focus.index] : undefined;
      if (p) map.setView([p.latitude, p.longitude], Math.max(map.getZoom(), 11));
      return;
    }
    const airport = airports.find((a) => a.role === focus.target);
    if (airport) map.setView([airport.latitude, airport.longitude], 14);
  }, [focus, airports, points]);

  return <div ref={containerRef} className="lam-map w-full rounded-md border border-line" style={{ height }} role="region" aria-label="Mapa de la trayectoria" />;
}
