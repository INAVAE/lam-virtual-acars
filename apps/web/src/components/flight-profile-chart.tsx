import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  formatAngle,
  formatElapsed,
  formatWind,
  formatWindComponents,
  formatLatLon,
  fuelFlowAt,
  nearestIndexByTime,
  niceTicks,
  pathAngleAt,
  pathAngleLegs,
  PHASE_GROUPS,
  phaseColor,
  pointWind,
  segmentsBy,
  type AngleLegKind,
  type AnalysisPoint,
  type EventMarker,
  type FuelSeries,
  type PhaseSpan,
  type ShearEvent,
} from '@/lib/flight-analysis';
import { formatNumber } from '@/lib/format';
import { phaseLabel } from '@/lib/phases';
import { useTimePrefs } from '@/lib/time-context';

interface FlightProfileChartProps {
  points: readonly AnalysisPoint[];
  times: readonly number[];
  distances: readonly number[];
  spans: readonly PhaseSpan[];
  markers: readonly EventMarker[];
  /** Combustible por punto (kg) y si es aproximado. */
  fuel: FuelSeries;
  /** Reserva final del plan de SimBrief (kg), para la línea de referencia. */
  reserveKg: number | null;
  /** Intervalos con la APU en marcha (ms). */
  apu: readonly { start: number; end: number }[];
  /** Episodios de cizalladura a baja altura. */
  shear?: readonly ShearEvent[];
  activeIndex: number | null;
  pinned: boolean;
  onHover: (index: number | null) => void;
  /** Clic: fija el punto o lo suelta si ya estaba fijado. */
  onSelect: (index: number | null) => void;
  /** Teclado: fija exactamente este punto (null suelta). */
  onPin: (index: number | null) => void;
}

// Geometría (px). Una sola SVG para que el cursor cruce las dos gráficas.
const LEFT = 56;
const RIGHT = 16;
const RIBBON = { top: 0, h: 8 };
const EVENTS = { top: 14, h: 22 };
const ALT = { top: 44, h: 170 };
const SPD = { top: 252, h: 150 };
const FUEL = { top: 440, h: 120 };

const IAS_COLOR = '#fbbf24';
const GS_COLOR = '#94a3b8';
const FUEL_COLOR = '#a3e635';
const RESERVE_COLOR = '#ef4444';
const APU_COLOR = '#06b6d4';
const WIND_COLOR = '#2dd4bf';
const HEADWIND_COLOR = '#22c55e';
const TAILWIND_COLOR = '#f97316';
const SHEAR_COLOR = '#a855f7';
/** Alto de la franja de flechas de viento bajo la gráfica de velocidad. */
const WIND_ROW = 26;

const LEG_TEXT: Record<AngleLegKind, { prefix: string; title: string; color: string }> = {
  climb: { prefix: '↗', title: 'Ascenso', color: PHASE_GROUPS.climb.color },
  descent: { prefix: '↘', title: 'Descenso', color: PHASE_GROUPS.descent.color },
  approach: { prefix: 'APP', title: 'Aproximación', color: PHASE_GROUPS.approach.color },
};
/** Senda de referencia de una aproximación de precisión (°) y tolerancia para marcarla en verde. */
const GLIDE_REF = 3;
const GLIDE_TOL = 0.5;

function pathFor(xs: number[], ys: (number | null)[], from = 0, to = xs.length - 1): string {
  let d = '';
  let pen = false;
  for (let i = from; i <= to; i++) {
    const y = ys[i];
    if (y === null || y === undefined || !Number.isFinite(y)) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${xs[i]!.toFixed(1)} ${y.toFixed(1)}`;
    pen = true;
  }
  return d;
}

/**
 * Perfil del vuelo: altitud (coloreada por fase) y velocidades IAS/GS en el
 * tiempo, con fondo por etapa, eventos y un cursor que muestra todos los
 * datos del punto. El cursor se sincroniza con el mapa.
 */
export function FlightProfileChart({ points, times, distances, spans, markers, fuel, reserveKg, apu, shear = [], activeIndex, pinned, onHover, onSelect, onPin }: FlightProfileChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hoveredMarker, setHoveredMarker] = useState<EventMarker | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => setWidth(Math.max(320, Math.round(entries[0]!.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const hasFuel = fuel.values.some((v) => v !== null);
  const hasWind = points.some((p) => p.wind_kt != null);
  // La franja de viento empuja hacia abajo la gráfica de combustible.
  const windRow = hasWind ? WIND_ROW : 0;
  const F = { top: FUEL.top + windRow, h: FUEL.h };
  const bottom = hasFuel ? F.top + F.h : SPD.top + SPD.h + windRow;
  const { dual } = useTimePrefs();
  const hasSecondaryTime = dual(0).secondary !== '';
  const AXIS_Y = bottom + 18;
  const HEIGHT = AXIS_Y + (hasSecondaryTime ? 20 : 8);
  // Las etiquetas de los extremos se alinean hacia dentro para no cortarse.
  const tickAnchor = (px: number) => (px > width - RIGHT - 36 ? 'end' : px < LEFT + 36 ? 'start' : 'middle');
  const t0 = times[0] ?? 0;
  const t1 = times[times.length - 1] ?? 1;
  const plotW = width - LEFT - RIGHT;
  const x = (t: number) => LEFT + ((t - t0) / Math.max(t1 - t0, 1)) * plotW;

  const geo = useMemo(() => {
    const altMax = niceTicks(Math.max(1000, ...points.map((p) => p.altitude_ft)));
    const spdMax = niceTicks(Math.max(100, ...points.map((p) => Math.max(p.ias_kt ?? 0, p.gs_kt ?? 0))));
    const altTop = altMax[altMax.length - 1]!;
    const spdTop = spdMax[spdMax.length - 1]!;
    const yAlt = (v: number) => ALT.top + ALT.h - (Math.max(0, v) / altTop) * ALT.h;
    const ySpd = (v: number) => SPD.top + SPD.h - (Math.max(0, v) / spdTop) * SPD.h;
    const xs = times.map((t) => LEFT + ((t - t0) / Math.max(t1 - t0, 1)) * plotW);
    const altYs = points.map((p) => yAlt(p.altitude_ft));
    const fuelMax = niceTicks(Math.max(1000, ...fuel.values.map((v) => v ?? 0), reserveKg ?? 0), 3);
    const fuelTop = fuelMax[fuelMax.length - 1]!;
    const yFuel = (v: number) => F.top + F.h - (Math.max(0, v) / fuelTop) * F.h;
    return {
      fuelTicks: fuelMax,
      yFuel,
      fuelPath: pathFor(xs, fuel.values.map((v) => (v === null ? null : yFuel(v)))),
      altTicks: altMax,
      spdTicks: spdMax,
      yAlt,
      ySpd,
      xs,
      altYs,
      altSegments: segmentsBy(points, 'phase').map((s) => ({ color: s.color, d: pathFor(xs, altYs, s.from, s.to) })),
      altArea: xs.length > 1 ? `${pathFor(xs, altYs)} L${xs[xs.length - 1]!.toFixed(1)} ${ALT.top + ALT.h} L${xs[0]!.toFixed(1)} ${ALT.top + ALT.h} Z` : '',
      ias: pathFor(xs, points.map((p) => (p.ias_kt === null ? null : ySpd(p.ias_kt)))),
      gs: pathFor(xs, points.map((p) => (p.gs_kt === null ? null : ySpd(p.gs_kt)))),
      wind: pathFor(xs, points.map((p) => (p.wind_kt == null || p.on_ground ? null : ySpd(p.wind_kt)))),
      // Ángulo promedio de cada tramo de ascenso, descenso y aproximación: cuerda y etiqueta.
      angleLegs: pathAngleLegs(points, distances).map((l) => ({
        ...l,
        x1: xs[l.from]!,
        y1: altYs[l.from]!,
        x2: xs[l.to]!,
        y2: altYs[l.to]!,
      })),
      boundaries: segmentsBy(points, 'phase')
        .slice(1)
        .map((s) => ({ x: xs[s.from]!, y: altYs[s.from]!, color: s.color, phase: points[s.from]!.phase })),
    };
  }, [points, times, distances, t0, t1, plotW, fuel, reserveKg, F.top, F.h]);

  // Flechas de viento: una cada ~44 px, apuntando hacia donde sopla.
  const windArrows = useMemo(() => {
    if (!hasWind) return [];
    const out: { x: number; rot: number; color: string; title: string }[] = [];
    for (let px = LEFT + 22; px <= width - RIGHT - 10; px += 44) {
      const i = nearestIndexByTime(times, t0 + ((px - LEFT) / Math.max(plotW, 1)) * (t1 - t0));
      const p = i >= 0 ? points[i] : undefined;
      if (!p || p.wind_kt == null || p.wind_dir_deg == null) continue;
      const c = pointWind(p);
      out.push({
        x: px,
        rot: (p.wind_dir_deg + 180) % 360,
        color: c && c.head < 0 ? TAILWIND_COLOR : HEADWIND_COLOR,
        title: `Viento ${formatWind(p.wind_dir_deg, p.wind_kt)}${c ? ` · ${formatWindComponents(c)}` : ''}`,
      });
    }
    return out;
  }, [hasWind, points, times, t0, t1, plotW, width]);

  const timeTicks = useMemo(() => {
    const span = t1 - t0;
    const stepMin = [5, 10, 15, 30, 60, 120].find((m) => span / (m * 60_000) <= Math.max(3, Math.floor(plotW / 110))) ?? 240;
    const step = stepMin * 60_000;
    const first = Math.ceil(t0 / step) * step;
    const out: number[] = [];
    for (let t = first; t <= t1; t += step) out.push(t);
    return out;
  }, [t0, t1, plotW]);

  function indexAt(clientX: number): number {
    const rect = (wrapRef.current as HTMLDivElement).getBoundingClientRect();
    const px = clientX - rect.left;
    const t = t0 + ((px - LEFT) / Math.max(plotW, 1)) * (t1 - t0);
    return nearestIndexByTime(times, t);
  }

  function onMove(e: PointerEvent<SVGRectElement>) {
    if (pinned) return;
    onHover(indexAt(e.clientX));
  }

  function onKey(e: KeyboardEvent<SVGSVGElement>) {
    if (points.length === 0) return;
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const current = activeIndex ?? (e.key === 'ArrowRight' ? -1 : points.length);
      const next = Math.min(points.length - 1, Math.max(0, current + (e.key === 'ArrowRight' ? step : -step)));
      onPin(next);
    } else if (e.key === 'Escape') {
      onPin(null);
    }
  }

  const active = activeIndex !== null ? points[activeIndex] : undefined;
  const ax = activeIndex !== null ? geo.xs[activeIndex] : undefined;
  const angle = active ? pathAngleAt(active) : null;
  const flow = activeIndex !== null && hasFuel ? fuelFlowAt(fuel.values, times, activeIndex) : null;
  const apuOn = activeIndex !== null && apu.some((r) => times[activeIndex]! >= r.start && times[activeIndex]! <= r.end);
  const nearMarkers = active ? markers.filter((m) => Math.abs(m.time - times[activeIndex!]!) <= 30_000) : [];
  const tooltipLeft = ax !== undefined && ax > width - 250 ? ax - 236 : (ax ?? 0) + 14;

  if (points.length < 2) return <p className="text-sm text-muted">No hay suficientes puntos para graficar.</p>;

  return (
    <div ref={wrapRef} className="relative select-none">
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label="Perfil de altitud y velocidad. Usa las flechas para recorrer los puntos y Escape para soltar."
        tabIndex={0}
        onKeyDown={onKey}
        className="block rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan"
      >
        {/* Cinta de fases */}
        {spans.map((s, i) => (
          <rect key={`r${i}`} x={x(s.start)} y={RIBBON.top} width={Math.max(1, x(s.end) - x(s.start))} height={RIBBON.h} fill={PHASE_GROUPS[s.group].color} rx={1}>
            <title>{PHASE_GROUPS[s.group].label}</title>
          </rect>
        ))}

        {/* Fondo por etapa */}
        {spans.map((s, i) => (
          <g key={`b${i}`} opacity={0.08}>
            <rect x={x(s.start)} y={ALT.top} width={Math.max(1, x(s.end) - x(s.start))} height={ALT.h} fill={PHASE_GROUPS[s.group].color} />
            <rect x={x(s.start)} y={SPD.top} width={Math.max(1, x(s.end) - x(s.start))} height={SPD.h} fill={PHASE_GROUPS[s.group].color} />
          </g>
        ))}

        {/* Rejilla y ejes */}
        {geo.altTicks.map((v) => (
          <g key={`a${v}`}>
            <line x1={LEFT} x2={width - RIGHT} y1={geo.yAlt(v)} y2={geo.yAlt(v)} stroke="var(--border)" strokeDasharray="2 4" />
            <text x={LEFT - 6} y={geo.yAlt(v) + 4} textAnchor="end" className="fill-muted font-mono text-[10px]">
              {v >= 1000 ? `${v / 1000}k` : v}
            </text>
          </g>
        ))}
        {geo.spdTicks.map((v) => (
          <g key={`s${v}`}>
            <line x1={LEFT} x2={width - RIGHT} y1={geo.ySpd(v)} y2={geo.ySpd(v)} stroke="var(--border)" strokeDasharray="2 4" />
            <text x={LEFT - 6} y={geo.ySpd(v) + 4} textAnchor="end" className="fill-muted font-mono text-[10px]">
              {v}
            </text>
          </g>
        ))}
        <text x={8} y={ALT.top + ALT.h / 2} transform={`rotate(-90 8 ${ALT.top + ALT.h / 2})`} textAnchor="middle" dominantBaseline="hanging" className="fill-muted text-[10px] uppercase tracking-wide">
          Altitud (ft)
        </text>
        <text x={8} y={SPD.top + SPD.h / 2} transform={`rotate(-90 8 ${SPD.top + SPD.h / 2})`} textAnchor="middle" dominantBaseline="hanging" className="fill-muted text-[10px] uppercase tracking-wide">
          Velocidad (kt)
        </text>
        {timeTicks.map((t) => (
          <g key={`t${t}`}>
            <line x1={x(t)} x2={x(t)} y1={ALT.top} y2={bottom} stroke="var(--border)" strokeOpacity={0.5} />
            <text x={x(t)} y={AXIS_Y} textAnchor={tickAnchor(x(t))} className="fill-muted font-mono text-[10px]">
              {dual(t).primary}
            </text>
            {hasSecondaryTime ? (
              <text x={x(t)} y={AXIS_Y + 12} textAnchor={tickAnchor(x(t))} className="fill-muted font-mono text-[9px]" opacity={0.7}>
                {dual(t).secondary}
              </text>
            ) : null}
          </g>
        ))}

        {/* Altitud por fase */}
        <path d={geo.altArea} fill="var(--accent)" opacity={0.12} />
        {geo.altSegments.map((s, i) => (
          <path key={`p${i}`} d={s.d} fill="none" stroke={s.color} strokeWidth={2.25} strokeLinejoin="round" />
        ))}
        {geo.angleLegs.map((l, i) => {
          const t = LEG_TEXT[l.kind];
          const label = `${t.prefix} ${formatAngle(l.angleDeg)}`;
          const w = label.length * 6.2 + 12;
          if (l.x2 - l.x1 < Math.min(w, 40)) return null;
          const mx = Math.min(Math.max((l.x1 + l.x2) / 2, LEFT + w / 2), width - RIGHT - w / 2);
          // Debajo de la cuerda: en un ascenso la curva real suele quedar arriba.
          const my = Math.min(Math.max((l.y1 + l.y2) / 2 + 14, ALT.top + 10), ALT.top + ALT.h - 10);
          const onGlide = l.kind === 'approach' && Math.abs(Math.abs(l.angleDeg) - GLIDE_REF) <= GLIDE_TOL;
          return (
            <g key={`leg${i}`} data-testid="angle-leg">
              <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={t.color} strokeOpacity={0.55} strokeDasharray="2 3" />
              <g transform={`translate(${mx} ${my})`}>
                <title>
                  {`${t.title} promedio ${formatAngle(l.angleDeg)} · ${formatNumber(Math.abs(Math.round(l.altitudeFt)))} ft en ${formatNumber(Math.round(l.distanceNm))} NM`}
                  {l.kind === 'approach' ? ` · referencia ${GLIDE_REF}°` : ''}
                </title>
                <rect x={-w / 2} y={-8} width={w} height={16} rx={8} fill="var(--surface)" fillOpacity={0.92} stroke={t.color} />
                <text y={3.5} textAnchor="middle" className="font-mono text-[10px] font-semibold" fill={onGlide ? '#22c55e' : 'var(--text)'}>
                  {label}
                </text>
              </g>
            </g>
          );
        })}
        {geo.boundaries.map((b, i) => (
          <circle key={`c${i}`} cx={b.x} cy={b.y} r={3.5} fill={b.color} stroke="var(--surface)" strokeWidth={1.5}>
            <title>{phaseLabel(b.phase)}</title>
          </circle>
        ))}

        {/* Velocidades */}
        <path d={geo.gs} fill="none" stroke={GS_COLOR} strokeWidth={1.5} strokeDasharray="5 3" />
        <path d={geo.ias} fill="none" stroke={IAS_COLOR} strokeWidth={2} strokeLinejoin="round" />
        {hasWind ? <path d={geo.wind} fill="none" stroke={WIND_COLOR} strokeWidth={1.5} strokeDasharray="1.5 3" strokeLinecap="round" /> : null}

        {/* Cizalladura: franja en altitud y velocidad */}
        {shear.map((e, i) => {
          const sx = x(e.start - 5_000);
          const w = Math.max(6, x(e.end + 5_000) - sx);
          return (
            <g key={`sh${i}`} pointerEvents="none">
              <rect x={sx} y={ALT.top} width={w} height={ALT.h} fill={SHEAR_COLOR} opacity={0.14} />
              <rect x={sx} y={SPD.top} width={w} height={SPD.h} fill={SHEAR_COLOR} opacity={0.14} />
              <text x={sx + w / 2} y={SPD.top + 12} textAnchor={tickAnchor(sx + w / 2)} className="font-mono text-[10px] font-semibold" fill={SHEAR_COLOR}>
                ≋ {e.changeKt > 0 ? '+' : '−'}
                {Math.abs(Math.round(e.changeKt))} kt
              </text>
            </g>
          );
        })}

        {/* Viento: flechas hacia donde sopla (verde de cabeza, naranja de cola) */}
        {hasWind ? (
          <g>
            <text x={LEFT - 6} y={SPD.top + SPD.h + WIND_ROW / 2 + 4} textAnchor="end" className="text-[10px] font-semibold" fill={WIND_COLOR}>
              Viento
            </text>
            {windArrows.map((a, i) => (
              <g key={`w${i}`} transform={`translate(${a.x} ${SPD.top + SPD.h + WIND_ROW / 2 + 1}) rotate(${a.rot})`}>
                <title>{a.title}</title>
                <path d="M0 7 L0 -6 M-3.5 -2 L0 -7 L3.5 -2" fill="none" stroke={a.color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
              </g>
            ))}
          </g>
        ) : null}

        <g transform={`translate(${width - RIGHT - (hasWind ? 220 : 150)} ${SPD.top - 10})`} className="text-[10px]">
          <line x1={0} x2={16} y1={0} y2={0} stroke={IAS_COLOR} strokeWidth={2} />
          <text x={20} y={3} className="fill-muted">
            IAS
          </text>
          <line x1={56} x2={72} y1={0} y2={0} stroke={GS_COLOR} strokeWidth={1.5} strokeDasharray="5 3" />
          <text x={76} y={3} className="fill-muted">
            GS
          </text>
          {hasWind ? (
            <>
              <line x1={112} x2={128} y1={0} y2={0} stroke={WIND_COLOR} strokeWidth={1.5} strokeDasharray="1.5 3" strokeLinecap="round" />
              <text x={132} y={3} className="fill-muted">
                Viento
              </text>
            </>
          ) : null}
        </g>

        {/* Combustible */}
        {hasFuel ? (
          <g>
            {apu.length > 0 ? (
              <g>
                <text x={LEFT - 6} y={F.top - 10} textAnchor="end" className="text-[10px] font-semibold" fill={APU_COLOR}>
                  APU
                </text>
                <line x1={LEFT} x2={width - RIGHT} y1={F.top - 13} y2={F.top - 13} stroke="var(--border)" />
                {apu.map((r, i) => (
                  <rect key={`apu${i}`} x={x(r.start)} y={F.top - 16} width={Math.max(2, x(r.end) - x(r.start))} height={6} rx={3} fill={APU_COLOR}>
                    <title>
                      APU en marcha {dual(r.start).primary}–{dual(r.end).primary}
                      {dual(r.start).secondary ? ` (${dual(r.start).secondary}–${dual(r.end).secondary})` : ''} · {Math.round((r.end - r.start) / 60_000)} min
                    </title>
                  </rect>
                ))}
              </g>
            ) : null}
            {spans.map((s, i) => (
              <rect
                key={`f${i}`}
                x={x(s.start)}
                y={F.top}
                width={Math.max(1, x(s.end) - x(s.start))}
                height={F.h}
                fill={PHASE_GROUPS[s.group].color}
                opacity={0.08}
              />
            ))}
            {geo.fuelTicks.map((v) => (
              <g key={`fu${v}`}>
                <line x1={LEFT} x2={width - RIGHT} y1={geo.yFuel(v)} y2={geo.yFuel(v)} stroke="var(--border)" strokeDasharray="2 4" />
                <text x={LEFT - 6} y={geo.yFuel(v) + 4} textAnchor="end" className="fill-muted font-mono text-[10px]">
                  {v >= 1000 ? `${Math.round(v / 100) / 10}t` : v}
                </text>
              </g>
            ))}
            <text
              x={8}
              y={F.top + F.h / 2}
              transform={`rotate(-90 8 ${F.top + F.h / 2})`}
              textAnchor="middle"
              dominantBaseline="hanging"
              className="fill-muted text-[10px] uppercase tracking-wide"
            >
              Comb. (kg)
            </text>
            {reserveKg !== null ? (
              <g>
                <line x1={LEFT} x2={width - RIGHT} y1={geo.yFuel(reserveKg)} y2={geo.yFuel(reserveKg)} stroke={RESERVE_COLOR} strokeDasharray="6 4" strokeOpacity={0.8} />
                <text x={LEFT + 6} y={geo.yFuel(reserveKg) - 4} className="text-[10px]" fill={RESERVE_COLOR}>
                  Reserva del plan · {formatNumber(reserveKg)} kg
                </text>
              </g>
            ) : null}
            <path d={geo.fuelPath} fill="none" stroke={FUEL_COLOR} strokeWidth={2} strokeDasharray={fuel.approximate ? '6 4' : undefined} strokeLinejoin="round" />
            {fuel.approximate ? (
              <text x={width - RIGHT} y={F.top - 6} textAnchor="end" className="fill-muted text-[10px]">
                Aproximado entre eventos (vuelo anterior al conector 0.1.16)
              </text>
            ) : null}
          </g>
        ) : null}

        {/* Eventos */}
        {markers.map((m) => {
          const mx = x(m.time);
          const key = m.kind === 'takeoff' || m.kind === 'touchdown' || m.kind === 'go_around' || m.kind === 'warning';
          return (
            <g key={m.id}>
              {key ? <line x1={mx} x2={mx} y1={EVENTS.top + EVENTS.h} y2={bottom} stroke={m.color} strokeOpacity={0.6} strokeDasharray="3 3" /> : null}
              <g
                transform={`translate(${mx} ${EVENTS.top + EVENTS.h / 2})`}
                onPointerEnter={() => setHoveredMarker(m)}
                onPointerLeave={() => setHoveredMarker(null)}
                onClick={() => onPin(nearestIndexByTime(times, m.time))}
                className="cursor-pointer"
              >
                <circle r={9} fill={m.color} stroke="var(--surface)" strokeWidth={2} />
                <text y={3.5} textAnchor="middle" className="fill-white text-[10px] font-bold">
                  {m.glyph}
                </text>
              </g>
            </g>
          );
        })}

        {/* Cursor */}
        {active && ax !== undefined ? (
          <g pointerEvents="none">
            <line x1={ax} x2={ax} y1={EVENTS.top + EVENTS.h} y2={bottom} stroke="var(--text)" strokeOpacity={0.7} strokeDasharray={pinned ? undefined : '4 3'} />
            {fuel.values[activeIndex!] !== null && fuel.values[activeIndex!] !== undefined ? (
              <circle cx={ax} cy={geo.yFuel(fuel.values[activeIndex!]!)} r={4} fill={FUEL_COLOR} stroke="var(--surface)" strokeWidth={2} />
            ) : null}
            <circle cx={ax} cy={geo.altYs[activeIndex!]} r={5} fill={phaseColor(active.phase)} stroke="var(--surface)" strokeWidth={2} />
            {active.ias_kt !== null ? <circle cx={ax} cy={geo.ySpd(active.ias_kt)} r={4.5} fill={IAS_COLOR} stroke="var(--surface)" strokeWidth={2} /> : null}
            {active.gs_kt !== null ? <circle cx={ax} cy={geo.ySpd(active.gs_kt)} r={3.5} fill={GS_COLOR} stroke="var(--surface)" strokeWidth={1.5} /> : null}
          </g>
        ) : null}

        {/* Captura del puntero sobre las dos gráficas */}
        <rect
          x={LEFT}
          y={ALT.top}
          width={plotW}
          height={bottom - ALT.top}
          fill="transparent"
          className="cursor-crosshair"
          onPointerMove={onMove}
          onPointerLeave={() => !pinned && onHover(null)}
          onClick={(e) => onSelect(pinned ? null : indexAt(e.clientX))}
        />
      </svg>

      {/* Recuadro del punto */}
      {active && ax !== undefined ? (
        <div
          className="pointer-events-none absolute z-10 w-56 rounded-md border border-line bg-surface/95 p-2.5 text-xs shadow-lg backdrop-blur"
          style={{ left: tooltipLeft, top: ALT.top }}
          role="status"
        >
          <p className="flex items-baseline justify-between font-mono text-sm font-semibold">
            {dual(active.sampled_at, { seconds: true }).primary}
            <span className="text-xs font-normal text-muted">{formatElapsed(times[activeIndex!]! - t0)}</span>
          </p>
          {dual(active.sampled_at).secondary ? (
            <p className="font-mono text-[11px] text-muted">{dual(active.sampled_at, { seconds: true }).secondary}</p>
          ) : null}
          <p className="mt-1 flex items-center gap-1.5 font-medium">
            <span className="size-2.5 rounded-full" style={{ background: phaseColor(active.phase) }} aria-hidden />
            {phaseLabel(active.phase)}
            <span className="ml-auto text-muted">{active.on_ground ? 'En tierra' : 'En el aire'}</span>
          </p>
          <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 font-mono">
            <div>
              <dt className="font-sans text-[10px] uppercase text-muted">Altitud</dt>
              <dd>{formatNumber(active.altitude_ft)} ft</dd>
            </div>
            <div>
              <dt className="font-sans text-[10px] uppercase text-muted">VS</dt>
              <dd>{active.vs_fpm === null ? '—' : `${active.vs_fpm > 0 ? '+' : ''}${formatNumber(active.vs_fpm)} fpm`}</dd>
            </div>
            <div>
              <dt className="font-sans text-[10px] uppercase text-muted">IAS</dt>
              <dd style={{ color: IAS_COLOR }}>{active.ias_kt ?? '—'} kt</dd>
            </div>
            <div>
              <dt className="font-sans text-[10px] uppercase text-muted">GS</dt>
              <dd>{active.gs_kt ?? '—'} kt</dd>
            </div>
            <div>
              <dt className="font-sans text-[10px] uppercase text-muted">Rumbo</dt>
              <dd>{active.heading_deg === null ? '—' : `${String(Math.round(active.heading_deg)).padStart(3, '0')}°`}</dd>
            </div>
            <div>
              <dt className="font-sans text-[10px] uppercase text-muted">Trayectoria</dt>
              <dd>{angle === null ? '—' : formatAngle(angle)}</dd>
            </div>
            {hasWind ? (
              <div className="col-span-2">
                <dt className="font-sans text-[10px] uppercase text-muted">Viento</dt>
                <dd style={{ color: WIND_COLOR }}>
                  {formatWind(active.wind_dir_deg, active.wind_kt)}
                  {pointWind(active) ? <span className="ml-1 text-[10px] text-muted">{formatWindComponents(pointWind(active))}</span> : null}
                </dd>
              </div>
            ) : null}
            {hasFuel ? (
              <>
                <div>
                  <dt className="font-sans text-[10px] uppercase text-muted">Combustible{fuel.approximate ? ' ≈' : ''}</dt>
                  <dd style={{ color: FUEL_COLOR }}>{fuel.values[activeIndex!] === null ? '—' : `${formatNumber(fuel.values[activeIndex!]!)} kg`}</dd>
                </div>
                <div>
                  <dt className="font-sans text-[10px] uppercase text-muted">Flujo</dt>
                  <dd>{flow === null ? '—' : `${formatNumber(flow)} kg/h`}</dd>
                </div>
              </>
            ) : null}
          </dl>
          <p className="mt-1.5 font-mono text-[10px] text-muted">
            {formatLatLon(active.latitude, active.longitude)} · {formatNumber(Math.round(distances[activeIndex!] ?? 0))} NM
          </p>
          {nearMarkers.map((m) => (
            <p key={m.id} className="mt-1 border-t border-line pt-1">
              <span className="font-medium" style={{ color: m.color }}>
                {m.label}
              </span>
              {m.detail ? <span className="text-muted"> · {m.detail}</span> : null}
            </p>
          ))}
          {apuOn ? (
            <p className="mt-1 flex items-center gap-1.5 text-[11px]" style={{ color: APU_COLOR }}>
              <span className="size-2 rounded-full" style={{ background: APU_COLOR }} aria-hidden />
              APU en marcha
            </p>
          ) : null}
          {pinned ? <p className="mt-1 text-[10px] text-muted">Fijado · clic o Esc para soltar</p> : null}
        </div>
      ) : null}

      {/* Recuadro de un evento */}
      {hoveredMarker ? (
        <div
          className="pointer-events-none absolute z-20 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: Math.min(Math.max(0, x(hoveredMarker.time) - 80), width - 180), top: EVENTS.top + EVENTS.h + 4 }}
        >
          <p className="font-medium" style={{ color: hoveredMarker.color }}>
            {hoveredMarker.label}
          </p>
          <p className="font-mono text-muted">
            {dual(hoveredMarker.time).primary}
            {dual(hoveredMarker.time).secondary ? ` · ${dual(hoveredMarker.time).secondary}` : ''}
            {hoveredMarker.detail ? ` · ${hoveredMarker.detail}` : ''}
          </p>
        </div>
      ) : null}
    </div>
  );
}
