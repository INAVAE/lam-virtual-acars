import type { LiveFlight, LiveTrackPoint } from '@lam/shared-types';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { PLANE_SVG } from '@/components/flight-map';
import { formatWind, phaseColor } from '@/lib/flight-analysis';
import { formatNumber } from '@/lib/format';
import { ageSeconds, extrapolate, greatCirclePoints, STALE_SECONDS } from '@/lib/live';
import { mapTileConfig } from '@/lib/map-tiles';
import { phaseLabel } from '@/lib/phases';

interface LiveMapProps {
  flights: readonly LiveFlight[];
  selectedId: string | null;
  onSelect: (flightId: string | null) => void;
  track: readonly LiveTrackPoint[];
  /** Hora actual (ms) para estimar la posición entre lecturas. */
  now: number;
  follow: boolean;
  /** El piloto movió el mapa a mano: deja de seguir al avión. */
  onUserMove: () => void;
  /** Cambia para pedir un encuadre de todos los vuelos. */
  fitNonce: number;
  theme: 'dark' | 'light';
  height: string;
}

const TILES = mapTileConfig();

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function planeIcon(f: LiveFlight, selected: boolean, stale: boolean): L.DivIcon {
  const color = phaseColor(f.phase);
  const heading = Math.round(f.position?.heading_deg ?? 0);
  return L.divIcon({
    className: '',
    html:
      `<div class="lam-live${selected ? ' is-selected' : ''}${stale ? ' is-stale' : ''}${f.is_mine ? ' is-mine' : ''}" style="--c:${color}">` +
      `<div class="lam-plane" style="color:${color};transform:rotate(${heading}deg)">${PLANE_SVG}</div></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function tooltipHtml(f: LiveFlight): string {
  const p = f.position;
  const alt = p ? (p.on_ground ? 'en tierra' : `${formatNumber(p.altitude_ft)} ft`) : 'sin posición';
  const wind = p?.wind_kt != null ? `<br>Viento ${escapeHtml(formatWind(p.wind_dir_deg, p.wind_kt))}` : '';
  return `<strong>${escapeHtml(f.callsign)}</strong> ${escapeHtml(f.origin.icao)}→${escapeHtml(f.destination.icao)}<br>${escapeHtml(phaseLabel(f.phase))} · ${alt}${p?.gs_kt ? ` · ${p.gs_kt} kt` : ''}${wind}`;
}

/**
 * Mapa de los vuelos en curso. Cada avión se dibuja con su rumbo y el color de
 * su fase; entre lecturas se estima su posición con la velocidad y el rumbo.
 * El vuelo elegido muestra su ruta directa, sus aeropuertos y la traza volada.
 */
export function LiveMap({ flights, selectedId, onSelect, track, now, follow, onUserMove, fitNonce, theme, height }: LiveMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tilesRef = useRef<L.TileLayer | null>(null);
  const routeRef = useRef<L.LayerGroup | null>(null);
  const trackRef = useRef<L.LayerGroup | null>(null);
  const planesRef = useRef(new Map<string, { marker: L.Marker; iconKey: string }>());
  const fittedRef = useRef(false);
  const handlers = useRef({ onSelect, onUserMove });
  handlers.current = { onSelect, onUserMove };

  // Mapa (una sola vez)
  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true, worldCopyJump: true, minZoom: 2, maxZoom: 16, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90 });
    map.setView([22.5, -101.5], 5);
    mapRef.current = map;
    routeRef.current = L.layerGroup().addTo(map);
    trackRef.current = L.layerGroup().addTo(map);
    map.on('dragstart', () => handlers.current.onUserMove());
    map.on('click', () => handlers.current.onSelect(null));
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(containerRef.current);
    const planes = planesRef.current;
    return () => {
      observer.disconnect();
      map.remove();
      planes.clear();
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
      const selected = f.flight_id === selectedId;
      const iconKey = `${f.phase}|${Math.round(f.position.heading_deg ?? 0)}|${selected}|${stale}`;
      const existing = planes.get(f.flight_id);
      if (existing) {
        existing.marker.setLatLng([at.latitude, at.longitude]);
        if (existing.iconKey !== iconKey) {
          existing.marker.setIcon(planeIcon(f, selected, stale));
          existing.iconKey = iconKey;
        }
        existing.marker.setZIndexOffset(selected ? 1000 : f.is_mine ? 500 : 0);
        existing.marker.setTooltipContent(tooltipHtml(f));
      } else {
        const marker = L.marker([at.latitude, at.longitude], {
          icon: planeIcon(f, selected, stale),
          keyboard: false,
          zIndexOffset: selected ? 1000 : f.is_mine ? 500 : 0,
          title: f.callsign,
        })
          .bindTooltip(tooltipHtml(f), { className: 'lam-tip', direction: 'right', offset: [14, 0] })
          .on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            handlers.current.onSelect(f.flight_id);
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
  }, [flights, selectedId, now]);

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

  // Ruta directa y aeropuertos del vuelo elegido
  const selected = flights.find((f) => f.flight_id === selectedId) ?? null;
  const routeKey = selected ? `${selected.flight_id}|${theme}` : '';
  useEffect(() => {
    const group = routeRef.current;
    if (!group) return;
    group.clearLayers();
    if (!selected) return;
    const { origin: o, destination: d } = selected;
    L.polyline(greatCirclePoints(o.latitude, o.longitude, d.latitude, d.longitude), {
      color: theme === 'dark' ? '#e2e8f0' : '#334155',
      weight: 1.5,
      opacity: 0.7,
      dashArray: '6 6',
      interactive: false,
    }).addTo(group);
    for (const [a, tone, role] of [
      [o, 'lam-ap-origin', 'Salida'],
      [d, 'lam-ap-destination', 'Destino'],
    ] as const) {
      L.marker([a.latitude, a.longitude], {
        icon: L.divIcon({ className: '', html: `<div class="lam-ap ${tone}"><span></span>${escapeHtml(a.icao)}</div>`, iconSize: [0, 0] }),
        keyboard: false,
      })
        .bindTooltip(`<strong>${escapeHtml(a.icao)}</strong> · ${escapeHtml(a.name)}<br>${role}`, { className: 'lam-tip', direction: 'top', offset: [0, -10] })
        .addTo(group);
    }
    // routeKey resume selected y theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  // Traza volada del vuelo elegido, por fase, hasta la posición actual
  const lastLat = selected?.position?.latitude;
  const lastLon = selected?.position?.longitude;
  useEffect(() => {
    const group = trackRef.current;
    if (!group) return;
    group.clearLayers();
    if (!selected || track.length === 0) return;
    const casing = theme === 'dark' ? '#000' : '#fff';
    const latlngs = track.map((p) => L.latLng(p[0], p[1]));
    L.polyline(latlngs, { color: casing, weight: 6, opacity: 0.5, interactive: false }).addTo(group);
    let start = 0;
    for (let i = 1; i <= track.length; i++) {
      if (i === track.length || track[i]![3] !== track[start]![3]) {
        L.polyline(latlngs.slice(start, Math.min(i + 1, track.length)), {
          color: phaseColor(track[start]![3]),
          weight: 3.5,
          interactive: false,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(group);
        start = i;
      }
    }
    if (lastLat !== undefined && lastLon !== undefined) {
      L.polyline([latlngs[latlngs.length - 1]!, L.latLng(lastLat, lastLon)], {
        color: phaseColor(selected.phase),
        weight: 2.5,
        dashArray: '3 5',
        interactive: false,
      }).addTo(group);
    }
    // selected se resume en su id y su última posición.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, selectedId, lastLat, lastLon, theme]);

  // Seguir al avión elegido
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !follow || !selected?.position) return;
    const at = extrapolate(selected.position, now);
    map.panTo([at.latitude, at.longitude], { animate: true, duration: 0.8 });
    // Se reevalúa en cada tic: now cambia cada segundo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow, selectedId, now]);

  return <div ref={containerRef} className="lam-map w-full rounded-md border border-line" style={{ height }} role="region" aria-label="Mapa de vuelos en curso" />;
}
