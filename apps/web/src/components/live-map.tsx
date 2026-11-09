import type { LiveFlight } from '@lam/shared-types';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import { logoUrl } from '@/components/airline-logo';
import type { FirData } from '@/hooks/use-map-layers';
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
import {
  facilityColors,
  firFor,
  formatFrequency,
  isLabeledFix,
  labelMode,
  RADAR_MAX_NATIVE_ZOOM,
  radarTileUrl,
  type AtcStation,
  type LabelMode,
  type RadarFrame,
  type RouteFix,
} from '@/lib/map-layers';
import { mapTileConfig } from '@/lib/map-tiles';
import { phaseLabel } from '@/lib/phases';
import { flightCategory, type FlightCategory, type WeatherReport } from '@/lib/weather';

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
  /** Etiqueta fija con el logo de la aerolínea y el callsign de cada avión. */
  labels?: boolean;
  /** Puntos del plan de SimBrief de los vuelos elegidos. */
  routes?: Readonly<Record<string, readonly RouteFix[] | undefined>>;
  showRoutes?: boolean;
  /** Último cuadro de radar de RainViewer (null: capa apagada). */
  radar?: RadarFrame | null;
  /** METAR de los aeropuertos de los vuelos (null: capa apagada). */
  metars?: ReadonlyMap<string, WeatherReport> | null;
  /** Control activo de IVAO agrupado por estación (null: capa apagada). */
  ivao?: { stations: readonly AtcStation[]; fir: FirData | null } | null;
  /** Clic en una estación de control: `${kind}:${code}`. */
  onStationSelect?: (key: string) => void;
}

const CATEGORY_COLORS: Record<FlightCategory, string> = { VFR: '#22c55e', MVFR: '#3b82f6', IFR: '#ef4444', LIFR: '#d946ef' };
const ROUTE_COLOR = '#38bdf8';
const RADAR_ATTRIBUTION = 'Radar: <a href="https://www.rainviewer.com/" target="_blank" rel="noopener noreferrer">RainViewer</a>';
const IVAO_ATTRIBUTION =
  'Control: <a href="https://www.ivao.aero/" target="_blank" rel="noopener noreferrer">IVAO</a> (Whazzup público) · FIR: <a href="https://github.com/vatsimnetwork/vatspy-data-project" target="_blank" rel="noopener noreferrer">VATSpy Data Project</a>, <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a>';
const SHORT_FACILITY: Record<string, string> = { DEL: 'DEL', GND: 'GND', TWR: 'TWR', APP: 'APP', DEP: 'DEP', CTR: 'CTR', FSS: 'FSS', OTHER: 'ATC' };

const TILES = mapTileConfig();
const REMAINING_COLOR = '#ef4444';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Color de la figura: el del evento o el tour si participa; si no, el de la fase. */
export function planeColor(f: LiveFlight): string {
  return f.event?.color ?? f.tour?.color ?? phaseColor(f.phase);
}

/** Etiqueta del avión: logo de la aerolínea y callsign (solo callsign con el mapa alejado). */
function tagHtml(f: LiveFlight, mode: LabelMode): string {
  const logo = mode === 'full' ? logoUrl(f.airline.logo_path) : null;
  return (
    `<div class="lam-tag${mode === 'compact' ? ' is-compact' : ''}">` +
    (logo ? `<img src="${escapeHtml(logo)}" alt="" loading="lazy" decoding="async">` : '') +
    `<span>${escapeHtml(f.callsign)}</span></div>`
  );
}

function planeIcon(f: LiveFlight, selected: boolean, stale: boolean, label: LabelMode | null): L.DivIcon {
  const color = planeColor(f);
  const category = mapCategory(f.map_category);
  const size = MAP_CATEGORY_SIZE[category];
  const heading = Math.round(f.position?.heading_deg ?? 0);
  const special = f.event || f.tour ? ' is-special' : '';
  return L.divIcon({
    className: '',
    html:
      `<div class="lam-live${selected ? ' is-selected' : ''}${stale ? ' is-stale' : ''}${f.is_mine ? ' is-mine' : ''}${special}" style="--c:${color};width:${size}px;height:${size}px">` +
      `<div class="lam-plane" style="transform:rotate(${heading}deg)">${aircraftSvg(category, color)}</div>${label ? tagHtml(f, label) : ''}</div>`,
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
export function LiveMap({
  flights,
  selectedIds,
  focusedId,
  onToggle,
  traces,
  now,
  follow,
  onUserMove,
  fitNonce,
  theme,
  height,
  timeText,
  labels = false,
  routes = {},
  showRoutes = false,
  radar = null,
  metars = null,
  ivao = null,
  onStationSelect,
}: LiveMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tilesRef = useRef<L.TileLayer | null>(null);
  const tracesRef = useRef<L.LayerGroup | null>(null);
  const remainingRef = useRef<L.LayerGroup | null>(null);
  const planesRef = useRef(new Map<string, { marker: L.Marker; iconKey: string }>());
  const traceLayers = useRef(new Map<string, { group: L.LayerGroup; key: string }>());
  const remainingLines = useRef(new Map<string, { line: L.Polyline; link: L.Polyline }>());
  const fittedRef = useRef(false);
  const routesRef = useRef<L.LayerGroup | null>(null);
  const routeLayers = useRef(new Map<string, { group: L.LayerGroup; key: string }>());
  const radarRef = useRef<L.TileLayer | null>(null);
  const metarRef = useRef<L.LayerGroup | null>(null);
  const ivaoRef = useRef<L.LayerGroup | null>(null);
  const [zoom, setZoom] = useState(5);
  const handlers = useRef({ onToggle, onUserMove, timeText, onStationSelect });
  handlers.current = { onToggle, onUserMove, timeText, onStationSelect };
  const label: LabelMode | null = labels ? labelMode(zoom) : null;

  // Mapa (una sola vez)
  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true, worldCopyJump: true, minZoom: 2, maxZoom: 16, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90 });
    map.setView([22.5, -101.5], 5);
    mapRef.current = map;
    // Capas de abajo hacia arriba: radar, control de IVAO, ruta del plan, trayectoria, aviones.
    map.createPane('lam-radar').style.zIndex = '250';
    map.createPane('lam-atc').style.zIndex = '350';
    ivaoRef.current = L.layerGroup().addTo(map);
    routesRef.current = L.layerGroup().addTo(map);
    tracesRef.current = L.layerGroup().addTo(map);
    remainingRef.current = L.layerGroup().addTo(map);
    metarRef.current = L.layerGroup().addTo(map);
    map.on('dragstart', () => handlers.current.onUserMove());
    map.on('zoomend', () => setZoom(map.getZoom()));
    // Sin animación y en el siguiente cuadro: si el contenedor cambia de tamaño durante el
    // encuadre animado (por ejemplo, al aparecer la barra de desplazamiento cuando carga el
    // detalle del vuelo), Leaflet fallaba con «_leaflet_pos» de undefined.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (mapRef.current === map) map.invalidateSize({ pan: false, animate: false });
      });
    });
    observer.observe(containerRef.current);
    const planes = planesRef.current;
    const layers = traceLayers.current;
    const lines = remainingLines.current;
    const routeGroups = routeLayers.current;
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      map.stop();
      map.remove();
      planes.clear();
      layers.clear();
      lines.clear();
      routeGroups.clear();
      mapRef.current = null;
      tilesRef.current = null;
      radarRef.current = null;
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
      const iconKey = `${planeColor(f)}|${f.map_category}|${Math.round(f.position.heading_deg ?? 0)}|${selected}|${stale}|${label ?? ''}|${f.callsign}`;
      const z = f.flight_id === focusedId ? 1200 : selected ? 1000 : f.is_mine ? 500 : 0;
      const existing = planes.get(f.flight_id);
      if (existing) {
        existing.marker.setLatLng([at.latitude, at.longitude]);
        if (existing.iconKey !== iconKey) {
          existing.marker.setIcon(planeIcon(f, selected, stale, label));
          existing.iconKey = iconKey;
        }
        existing.marker.setZIndexOffset(z);
        existing.marker.setTooltipContent(tooltipHtml(f));
      } else {
        const marker = L.marker([at.latitude, at.longitude], { icon: planeIcon(f, selected, stale, label), keyboard: false, zIndexOffset: z, title: f.callsign })
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
  }, [flights, selectedIds, focusedId, now, label]);

  // Encuadre inicial y a pedido: todos los aviones
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const positions = flights.filter((f) => f.position).map((f) => [f.position!.latitude, f.position!.longitude] as [number, number]);
    if (positions.length === 0) return;
    if (fittedRef.current && fitNonce === 0) return;
    fittedRef.current = true;
    if (positions.length === 1) map.setView(positions[0]!, 7, { animate: false });
    else map.fitBounds(L.latLngBounds(positions), { padding: [48, 48], maxZoom: 8, animate: false });
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
      const planned = showRoutes && (routes[id]?.length ?? 0) > 1;
      if (!selectedIds.includes(id) || !f || !f.position || ARRIVED_PHASES.has(f.phase) || planned) {
        parent.removeLayer(entry.line);
        parent.removeLayer(entry.link);
        lines.delete(id);
      }
    }
    for (const id of selectedIds) {
      const f = byId.get(id);
      if (!f?.position || ARRIVED_PHASES.has(f.phase)) continue;
      // Con el plan de SimBrief a la vista, la ruta directa sobra.
      if (showRoutes && (routes[id]?.length ?? 0) > 1) continue;
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
  }, [flights, selectedIds, traces, now, routes, showRoutes]);

  // Ruta del plan de SimBrief de los vuelos elegidos: línea punteada con el nombre de cada punto.
  useEffect(() => {
    const parent = routesRef.current;
    if (!parent) return;
    const groups = routeLayers.current;
    const byId = new Map(flights.map((f) => [f.flight_id, f]));
    for (const [id, entry] of groups) {
      if (!showRoutes || !selectedIds.includes(id) || !byId.has(id) || (routes[id]?.length ?? 0) < 2) {
        parent.removeLayer(entry.group);
        groups.delete(id);
      }
    }
    if (!showRoutes) return;
    for (const id of selectedIds) {
      const f = byId.get(id);
      const fixes = routes[id];
      if (!f || !fixes || fixes.length < 2) continue;
      const key = `${fixes.length}|${fixes[0]!.ident}|${fixes[fixes.length - 1]!.ident}|${theme}`;
      const existing = groups.get(id);
      if (existing?.key === key) continue;
      if (existing) parent.removeLayer(existing.group);
      const group = L.layerGroup();
      const latlngs: L.LatLngExpression[] = [
        [f.origin.latitude, f.origin.longitude],
        ...fixes.map((x) => [x.lat, x.lon] as L.LatLngTuple),
        [f.destination.latitude, f.destination.longitude],
      ];
      L.polyline(latlngs, { color: theme === 'dark' ? '#000' : '#fff', weight: 4, opacity: 0.35, interactive: false }).addTo(group);
      L.polyline(latlngs, { color: ROUTE_COLOR, weight: 2, opacity: 0.95, dashArray: '7 6', interactive: false }).addTo(group);
      for (const x of fixes) {
        if (!isLabeledFix(x) || x.ident === f.origin.icao || x.ident === f.destination.icao) continue;
        L.marker([x.lat, x.lon], {
          icon: L.divIcon({ className: '', html: `<div class="lam-fix"><span></span>${escapeHtml(x.ident)}</div>`, iconSize: [0, 0] }),
          keyboard: false,
        })
          .bindTooltip(`<strong>${escapeHtml(x.ident)}</strong>${x.via && x.via !== 'DCT' ? ` · vía ${escapeHtml(x.via)}` : ''}<br>Plan de ${escapeHtml(f.callsign)}`, {
            className: 'lam-tip',
            direction: 'top',
            offset: [0, -6],
          })
          .addTo(group);
      }
      group.addTo(parent);
      groups.set(id, { group, key });
    }
  }, [flights, selectedIds, routes, showRoutes, theme]);

  // Radar de precipitación (RainViewer, uso personal y educativo; crédito en el mapa).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    radarRef.current?.remove();
    radarRef.current = null;
    if (!radar) return;
    radarRef.current = L.tileLayer(radarTileUrl(radar), {
      pane: 'lam-radar',
      opacity: 0.65,
      maxNativeZoom: RADAR_MAX_NATIVE_ZOOM,
      maxZoom: 16,
      attribution: RADAR_ATTRIBUTION,
    }).addTo(map);
  }, [radar]);

  // METAR de los aeropuertos de los vuelos: punto con el color de la categoría de vuelo.
  useEffect(() => {
    const group = metarRef.current;
    if (!group) return;
    group.clearLayers();
    if (!metars) return;
    const airports = new Map<string, LiveFlight['origin']>();
    for (const f of flights) {
      airports.set(f.origin.icao, f.origin);
      airports.set(f.destination.icao, f.destination);
    }
    for (const [icao, a] of airports) {
      const metar = metars.get(icao)?.metar;
      if (!metar) continue;
      const category = flightCategory(metar);
      const color = category ? CATEGORY_COLORS[category] : '#94a3b8';
      L.circleMarker([a.latitude, a.longitude], { radius: 6, color: theme === 'dark' ? '#0b1220' : '#fff', weight: 2, fillColor: color, fillOpacity: 1 })
        .bindTooltip(
          `<strong>${escapeHtml(icao)}</strong> · ${escapeHtml(category ?? 'sin categoría')}<br><span class="lam-tip-mono">${escapeHtml(metar.raw ?? '')}</span>`,
          { className: 'lam-tip lam-tip-wide', direction: 'top', offset: [0, -6] },
        )
        .addTo(group);
    }
  }, [metars, flights, theme]);

  // Control activo de IVAO: aeropuertos (DEL, GND, TWR, APP, DEP) y FIR (CTR, FSS).
  useEffect(() => {
    const map = mapRef.current;
    const group = ivaoRef.current;
    if (!map || !group) return;
    group.clearLayers();
    if (!ivao) return;
    map.attributionControl.addAttribution(IVAO_ATTRIBUTION);
    const select = (key: string) => (e: L.LeafletEvent) => {
      L.DomEvent.stopPropagation(e as L.LeafletMouseEvent);
      handlers.current.onStationSelect?.(key);
    };
    for (const s of ivao.stations) {
      const key = `${s.kind}:${s.code}`;
      const tip = s.atcs.map((a) => `<strong>${escapeHtml(a.callsign)}</strong> ${escapeHtml(formatFrequency(a.frequency))}`).join('<br>');
      const badges = s.facilities
        .map((x) => `<i style="--f:${facilityColors[x]}">${SHORT_FACILITY[x] ?? 'ATC'}</i>`)
        .join('');
      if (s.kind === 'center') {
        const fir = firFor(s.code, ivao.fir?.index);
        const features = fir ? (ivao.fir?.boundaries.get(fir.boundary) ?? []) : [];
        let labelAt: L.LatLngExpression | null = s.latitude !== null && s.longitude !== null ? [s.latitude, s.longitude] : null;
        if (features.length > 0) {
          L.geoJSON({ type: 'FeatureCollection', features } as unknown as Parameters<typeof L.geoJSON>[0], {
            pane: 'lam-atc',
            style: { color: facilityColors.CTR, weight: 1.5, opacity: 0.9, fillColor: facilityColors.CTR, fillOpacity: 0.07 },
          })
            .bindTooltip(`${escapeHtml(fir!.name)}<br>${tip}`, { className: 'lam-tip', sticky: true })
            .on('click', select(key))
            .addTo(group);
          const p = features[0]!.properties;
          const lat = Number(p?.label_lat);
          const lon = Number(p?.label_lon);
          if (Number.isFinite(lat) && Number.isFinite(lon)) labelAt = [lat, lon];
        } else if (labelAt) {
          L.circle(labelAt, { pane: 'lam-atc', radius: 250_000, color: facilityColors.CTR, weight: 1.5, dashArray: '6 6', fillOpacity: 0.05 })
            .bindTooltip(tip, { className: 'lam-tip', sticky: true })
            .on('click', select(key))
            .addTo(group);
        }
        if (labelAt) {
          L.marker(labelAt, {
            icon: L.divIcon({ className: '', html: `<div class="lam-atc is-center"><b>${escapeHtml(s.code)}</b>${badges}</div>`, iconSize: [0, 0] }),
            keyboard: false,
          })
            .bindTooltip(tip, { className: 'lam-tip', direction: 'top', offset: [0, -10] })
            .on('click', select(key))
            .addTo(group);
        }
        continue;
      }
      if (s.latitude === null || s.longitude === null) continue;
      const at: L.LatLngTuple = [s.latitude, s.longitude];
      const approach = s.facilities.find((x) => x === 'APP' || x === 'DEP');
      if (approach) {
        L.circle(at, { pane: 'lam-atc', radius: 55_000, color: facilityColors[approach], weight: 1.5, fillColor: facilityColors[approach], fillOpacity: 0.08 })
          .bindTooltip(tip, { className: 'lam-tip', sticky: true })
          .on('click', select(key))
          .addTo(group);
      }
      const local = s.facilities.find((x) => x === 'TWR') ?? s.facilities.find((x) => x === 'GND' || x === 'DEL');
      if (local) {
        L.circle(at, { pane: 'lam-atc', radius: 9_000, color: facilityColors[local], weight: 2, fillColor: facilityColors[local], fillOpacity: 0.2 })
          .on('click', select(key))
          .addTo(group);
      }
      L.marker(at, {
        icon: L.divIcon({ className: '', html: `<div class="lam-atc"><b>${escapeHtml(s.code)}</b>${badges}</div>`, iconSize: [0, 0] }),
        keyboard: false,
      })
        .bindTooltip(tip, { className: 'lam-tip', direction: 'top', offset: [0, -10] })
        .on('click', select(key))
        .addTo(group);
    }
    return () => {
      map.attributionControl.removeAttribution(IVAO_ATTRIBUTION);
    };
  }, [ivao]);

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
