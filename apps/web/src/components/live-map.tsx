import type { LiveFlight } from '@lam/shared-types';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { aircraftSvg, MAP_CATEGORY_SIZE, mapCategory } from '@/lib/aircraft-icons';
import {
  eventMarkers,
  formatWind,
  formatWindComponents,
  nearestIndexByPosition,
  phaseColor,
  pointWind,
  segmentsBy,
  type AnalysisPoint,
} from '@/lib/flight-analysis';
import { formatNumber } from '@/lib/format';
import { ageSeconds, ARRIVED_PHASES, extrapolate, greatCirclePoints, STALE_SECONDS, type LiveTrace } from '@/lib/live';
import { mapTileConfig } from '@/lib/map-tiles';
import { phaseLabel } from '@/lib/phases';

interface LiveMapProps {
  flights: readonly LiveFlight[];
  /** Vuelos elegidos: cada uno muestra su trayectoria y su ruta faltante. */
  selectedIds: readonly string[];
  /** El elegido más reciente (el que sigue la cámara y muestra el detalle). */
  focusedId: string | null;
  /** Clic en un avión: lo agrega o lo quita de la selección. */
  onToggle: (flightId: string) => void;
  traces: Readonly<Record<string, LiveTrace | undefined>>;
  /** Hora actual (ms) para estimar la posición entre lecturas. */
  now: number;
  follow: boolean;
  /** El piloto movió el mapa a mano: deja de seguir al avión. */
  onUserMove: () => void;
  /** Cambia para pedir un encuadre de todos los vuelos. */
  fitNonce: number;
  theme: 'dark' | 'light';
  height: string;
  /** Hora para los recuadros (UTC y local). */
  timeText: (value: string) => string;
}

const TILES = mapTileConfig();
const REMAINING_COLOR = '#ef4444';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Color de la figura: el del evento o el tour si participa; si no, el de la fase. */
export function planeColor(f: LiveFlight): string {
  return f.event?.color ?? f.tour?.color ?? phaseColor(f.phase);
}

function planeIcon(f: LiveFlight, selected: boolean, stale: boolean): L.DivIcon {
  const color = planeColor(f);
  const category = mapCategory(f.map_category);
  const size = MAP_CATEGORY_SIZE[category];
  const heading = Math.round(f.position?.heading_deg ?? 0);
  const special = f.event || f.tour ? ' is-special' : '';
  return L.divIcon({
    className: '',
    html:
      `<div class="lam-live${selected ? ' is-selected' : ''}${stale ? ' is-stale' : ''}${f.is_mine ? ' is-mine' : ''}${special}" style="--c:${color};width:${size}px;height:${size}px">` +
      `<div class="lam-plane" style="transform:rotate(${heading}deg)">${aircraftSvg(category, color)}</div></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function tooltipHtml(f: LiveFlight): string {
  const p = f.position;
  const alt = p ? (p.on_ground ? 'en tierra' : `${formatNumber(p.altitude_ft)} ft`) : 'sin posición';
  const wind = p?.wind_kt != null ? `<br>Viento ${escapeHtml(formatWind(p.wind_dir_deg, p.wind_kt))}` : '';
  const tag = f.event
    ? `<br><span style="color:${f.event.color}">Evento ${escapeHtml(f.event.folio)} · ${escapeHtml(f.event.name)}</span>`
    : f.tour
      ? `<br><span style="color:${f.tour.color}">Tour ${escapeHtml(f.tour.code)} · Leg ${f.tour.leg}/${f.tour.legs}</span>`
      : '';
  return `<strong>${escapeHtml(f.callsign)}</strong> ${escapeHtml(f.origin.icao)}→${escapeHtml(f.destination.icao)} · ${escapeHtml(f.aircraft_type)}<br>${escapeHtml(phaseLabel(f.phase))} · ${alt}${p?.gs_kt ? ` · ${p.gs_kt} kt` : ''}${wind}${tag}`;
}

function pointHtml(f: LiveFlight, p: AnalysisPoint, timeText: (v: string) => string): string {
  const c = pointWind(p);
  const rows = [
    `<strong>${escapeHtml(f.callsign)}</strong> · ${escapeHtml(phaseLabel(p.phase))} · ${escapeHtml(timeText(p.sampled_at))}`,
    `${formatNumber(p.altitude_ft)} ft · VS ${p.vs_fpm === null ? '—' : formatNumber(p.vs_fpm)} fpm`,
    `IAS ${p.ias_kt ?? '—'} kt · GS ${p.gs_kt ?? '—'} kt${p.heading_deg === null ? '' : ` · ${String(Math.round(p.heading_deg)).padStart(3, '0')}°`}`,
  ];
  if (p.wind_kt != null) rows.push(`Viento ${escapeHtml(formatWind(p.wind_dir_deg, p.wind_kt))}${c ? ` · ${escapeHtml(formatWindComponents(c))}` : ''}`);
  if (p.fuel_kg != null) rows.push(`Combustible ${formatNumber(p.fuel_kg)} kg`);
  return rows.join('<br>');
}

/**
 * Mapa de los vuelos en curso. Cada avión se dibuja con la figura de su categoría
 * y el color de su fase (o de su evento o tour). Los vuelos elegidos muestran su
 * trayectoria volada por fases, con eventos y datos de cada punto, y en rojo
 * punteado la ruta directa que les falta hasta el destino.
 */
export function LiveMap({ flights, selectedIds, focusedId, onToggle, traces, now, follow, onUserMove, fitNonce, theme, height, timeText }: LiveMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tilesRef = useRef<L.TileLayer | null>(null);
  const tracesRef = useRef<L.LayerGroup | null>(null);
  const remainingRef = useRef<L.LayerGroup | null>(null);
  const planesRef = useRef(new Map<string, { marker: L.Marker; iconKey: string }>());
  const traceLayers = useRef(new Map<string, { group: L.LayerGroup; key: string }>());
  const remainingLines = useRef(new Map<string, { line: L.Polyline; link: L.Polyline }>());
  const fittedRef = useRef(false);
  const handlers = useRef({ onToggle, onUserMove, timeText });
  handlers.current = { onToggle, onUserMove, timeText };

  // Mapa (una sola vez)
  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true, worldCopyJump: true, minZoom: 2, maxZoom: 16, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90 });
    map.setView([22.5, -101.5], 5);
    mapRef.current = map;
    tracesRef.current = L.layerGroup().addTo(map);
    remainingRef.current = L.layerGroup().addTo(map);
    map.on('dragstart', () => handlers.current.onUserMove());
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(containerRef.current);
    const planes = planesRef.current;
    const layers = traceLayers.current;
    const lines = remainingLines.current;
    return () => {
      observer.disconnect();
      map.remove();
      planes.clear();
      layers.clear();
      lines.clear();
      mapRef.current = null;
      tilesRef.current = null;
      fittedRef.current = false;
    };
  }, []);

  // Teselas según el tema (OpenStreetMap, con atribución: ADR 0007)
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

  // Aviones (posición estimada en cada tic)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const planes = planesRef.current;
    const seen = new Set<string>();
    for (const f of flights) {
      if (!f.position) continue;
      seen.add(f.flight_id);
      const stale = ageSeconds(f.last_contact_at, now) >= STALE_SECONDS;
      const at = extrapolate(f.position, now);
      const selected = selectedIds.includes(f.flight_id);
      const iconKey = `${planeColor(f)}|${f.map_category}|${Math.round(f.position.heading_deg ?? 0)}|${selected}|${stale}`;
      const z = f.flight_id === focusedId ? 1200 : selected ? 1000 : f.is_mine ? 500 : 0;
      const existing = planes.get(f.flight_id);
      if (existing) {
        existing.marker.setLatLng([at.latitude, at.longitude]);
        if (existing.iconKey !== iconKey) {
          existing.marker.setIcon(planeIcon(f, selected, stale));
          existing.iconKey = iconKey;
        }
        existing.marker.setZIndexOffset(z);
        existing.marker.setTooltipContent(tooltipHtml(f));
      } else {
        const marker = L.marker([at.latitude, at.longitude], { icon: planeIcon(f, selected, stale), keyboard: false, zIndexOffset: z, title: f.callsign })
          .bindTooltip(tooltipHtml(f), { className: 'lam-tip', direction: 'right', offset: [14, 0] })
          .on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            handlers.current.onToggle(f.flight_id);
          })
          .addTo(map);
        planes.set(f.flight_id, { marker, iconKey });
      }
    }
    for (const [id, entry] of planes) {
      if (!seen.has(id)) {
        entry.marker.remove();
        planes.delete(id);
      }
    }
  }, [flights, selectedIds, focusedId, now]);

  // Encuadre inicial y a pedido: todos los aviones
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const positions = flights.filter((f) => f.position).map((f) => [f.position!.latitude, f.position!.longitude] as [number, number]);
    if (positions.length === 0) return;
    if (fittedRef.current && fitNonce === 0) return;
    fittedRef.current = true;
    if (positions.length === 1) map.setView(positions[0]!, 7);
    else map.fitBounds(L.latLngBounds(positions), { padding: [48, 48], maxZoom: 8 });
    // fitNonce pide un nuevo encuadre; flights solo cuenta la primera vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitNonce, flights.length > 0]);

  // Trayectorias de los vuelos elegidos: por fase, con eventos y datos de cada punto
  useEffect(() => {
    const parent = tracesRef.current;
    if (!parent) return;
    const layers = traceLayers.current;
    const byId = new Map(flights.map((f) => [f.flight_id, f]));
    for (const [id, entry] of layers) {
      if (!selectedIds.includes(id) || !byId.has(id)) {
        parent.removeLayer(entry.group);
        layers.delete(id);
      }
    }
    for (const id of selectedIds) {
      const f = byId.get(id);
      if (!f) continue;
      const trace = traces[id];
      const points = trace?.points ?? [];
      const key = `${points.length}|${trace?.events.length ?? 0}|${theme}`;
      const existing = layers.get(id);
      if (existing?.key === key) continue;
      if (existing) parent.removeLayer(existing.group);
      const group = L.layerGroup();

      // Aeropuertos del vuelo
      for (const [a, tone, role] of [
        [f.origin, 'lam-ap-origin', 'Salida'],
        [f.destination, 'lam-ap-destination', 'Destino'],
      ] as const) {
        L.marker([a.latitude, a.longitude], {
          icon: L.divIcon({ className: '', html: `<div class="lam-ap ${tone}"><span></span>${escapeHtml(a.icao)}</div>`, iconSize: [0, 0] }),
          keyboard: false,
        })
          .bindTooltip(`<strong>${escapeHtml(a.icao)}</strong> · ${escapeHtml(a.name)}<br>${role} de ${escapeHtml(f.callsign)}`, {
            className: 'lam-tip',
            direction: 'top',
            offset: [0, -10],
          })
          .addTo(group);
      }

      if (points.length > 1) {
        const latlngs = points.map((p) => L.latLng(p.latitude, p.longitude));
        L.polyline(latlngs, { color: theme === 'dark' ? '#000' : '#fff', weight: 6, opacity: 0.5, interactive: false, lineJoin: 'round' }).addTo(group);
        for (const s of segmentsBy(points, 'phase')) {
          L.polyline(latlngs.slice(s.from, s.to + 1), { color: s.color, weight: 3.5, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(group);
        }
        // Línea invisible y ancha: recuadro con los datos del punto más cercano.
        const hit: L.Polyline = L.polyline(latlngs, { color: '#000', weight: 18, opacity: 0, lineJoin: 'round' })
          .bindTooltip('', { className: 'lam-tip', sticky: true, direction: 'top', offset: [0, -12] })
          .on('mousemove', (e: L.LeafletMouseEvent) => {
            const i = nearestIndexByPosition(points, e.latlng.lat, e.latlng.lng);
            if (i >= 0) hit.setTooltipContent(pointHtml(f, points[i]!, handlers.current.timeText));
          })
          .addTo(group);
        // Eventos del vuelo (calzos, despegue, motores, APU, actitud…)
        for (const m of eventMarkers(trace?.events ?? [])) {
          if (m.latitude === null || m.longitude === null) continue;
          L.marker([m.latitude, m.longitude], {
            icon: L.divIcon({ className: '', html: `<div class="lam-ev lam-ev-sm" style="--ev:${m.color}">${escapeHtml(m.glyph)}</div>`, iconSize: [16, 16], iconAnchor: [8, 8] }),
            keyboard: false,
          })
            .bindTooltip(
              `<strong>${escapeHtml(m.label)}</strong> · ${escapeHtml(f.callsign)}<br>${escapeHtml(handlers.current.timeText(new Date(m.time).toISOString()))}${m.detail ? `<br>${escapeHtml(m.detail)}` : ''}`,
              { className: 'lam-tip', direction: 'top', offset: [0, -8] },
            )
            .addTo(group);
        }
      }
      group.addTo(parent);
      layers.set(id, { group, key });
    }
  }, [flights, selectedIds, traces, theme]);

  // Ruta faltante (rojo punteado) desde la posición estimada hasta el destino, en cada tic
  useEffect(() => {
    const parent = remainingRef.current;
    if (!parent) return;
    const lines = remainingLines.current;
    const byId = new Map(flights.map((f) => [f.flight_id, f]));
    for (const [id, entry] of lines) {
      const f = byId.get(id);
      if (!selectedIds.includes(id) || !f || !f.position || ARRIVED_PHASES.has(f.phase)) {
        parent.removeLayer(entry.line);
        parent.removeLayer(entry.link);
        lines.delete(id);
      }
    }
    for (const id of selectedIds) {
      const f = byId.get(id);
      if (!f?.position || ARRIVED_PHASES.has(f.phase)) continue;
      const at = extrapolate(f.position, now);
      const route = greatCirclePoints(at.latitude, at.longitude, f.destination.latitude, f.destination.longitude, 64);
      const pts = traces[id]?.points ?? [];
      const last = pts[pts.length - 1];
      // Tramo entre el último punto de la traza y la posición actual (aún no llega en el lote).
      const link: L.LatLngExpression[] = last
        ? [
            [last.latitude, last.longitude],
            [at.latitude, at.longitude],
          ]
        : [];
      const entry = lines.get(id);
      if (entry) {
        entry.line.setLatLngs(route);
        entry.link.setLatLngs(link);
        entry.link.setStyle({ color: phaseColor(f.phase) });
      } else {
        const line = L.polyline(route, { color: REMAINING_COLOR, weight: 2.25, opacity: 0.9, dashArray: '6 7', interactive: false }).addTo(parent);
        const linkLine = L.polyline(link, { color: phaseColor(f.phase), weight: 3, dashArray: '2 5', interactive: false }).addTo(parent);
        lines.set(id, { line, link: linkLine });
      }
    }
  }, [flights, selectedIds, traces, now]);

  // Seguir al avión enfocado
  useEffect(() => {
    const map = mapRef.current;
    const f = flights.find((x) => x.flight_id === focusedId);
    if (!map || !follow || !f?.position) return;
    const at = extrapolate(f.position, now);
    map.panTo([at.latitude, at.longitude], { animate: true, duration: 0.8 });
    // Se reevalúa en cada tic: now cambia cada segundo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow, focusedId, now]);

  return <div ref={containerRef} className="lam-map w-full rounded-md border border-line" style={{ height }} role="region" aria-label="Mapa de vuelos en curso" />;
}
