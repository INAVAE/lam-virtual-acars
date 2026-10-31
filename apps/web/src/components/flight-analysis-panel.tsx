import { Crosshair, Maximize2, Minimize2, PlaneLanding, PlaneTakeoff, Route } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlightMap, type MapAirport, type MapFocus } from '@/components/flight-map';
import { FlightProfileChart } from '@/components/flight-profile-chart';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import {
  ALTITUDE_BANDS,
  cumulativeDistance,
  eventMarkers,
  flightExtremes,
  formatZuluTime,
  PHASE_GROUPS,
  phaseGroup,
  phaseSpans,
  type AnalysisEvent,
  type AnalysisPoint,
  type ColorMode,
} from '@/lib/flight-analysis';
import { formatNumber } from '@/lib/format';
import { useTheme } from '@/lib/theme';

interface FlightAnalysisPanelProps {
  points: readonly AnalysisPoint[];
  events: readonly AnalysisEvent[];
  airports: readonly MapAirport[];
  loading: boolean;
}

/**
 * Análisis del vuelo: mapa interactivo y perfil de altitud y velocidad con el
 * mismo cursor. Pasar el puntero por la ruta o por las gráficas muestra el
 * punto en ambos; un clic lo fija.
 */
export function FlightAnalysisPanel({ points, events, airports, loading }: FlightAnalysisPanelProps) {
  const { theme } = useTheme();
  const [colorMode, setColorMode] = useState<ColorMode>('phase');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);
  const [focus, setFocus] = useState<MapFocus>({ target: 'route', nonce: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const times = useMemo(() => points.map((p) => Date.parse(p.sampled_at)), [points]);
  const distances = useMemo(() => cumulativeDistance(points), [points]);
  const spans = useMemo(() => phaseSpans(points), [points]);
  const markers = useMemo(() => eventMarkers(events), [events]);
  const extremes = useMemo(() => flightExtremes(points), [points]);
  const groupsPresent = useMemo(() => new Set(points.map((p) => phaseGroup(p.phase))), [points]);

  const activeIndex = pinnedIndex ?? hoverIndex;

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const select = useCallback((index: number | null) => {
    setPinnedIndex((current) => (index === null || current === index ? null : index));
  }, []);

  const goTo = useCallback((index: number) => {
    setPinnedIndex(index);
    setFocus((f) => ({ target: 'point', index, nonce: f.nonce + 1 }));
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.();
  }

  const arrival = airports.find((a) => a.role === 'arrival');
  const origin = airports.find((a) => a.role === 'origin');
  const destination = airports.find((a) => a.role === 'destination');

  const stats = [
    { label: 'Altitud máx.', value: extremes.maxAltitude ? `${formatNumber(extremes.maxAltitude.value)} ft` : '—', index: extremes.maxAltitude?.index },
    { label: 'IAS máx.', value: extremes.maxIas ? `${extremes.maxIas.value} kt` : '—', index: extremes.maxIas?.index },
    { label: 'GS máx.', value: extremes.maxGs ? `${extremes.maxGs.value} kt` : '—', index: extremes.maxGs?.index },
    { label: 'Ascenso máx.', value: extremes.maxClimb ? `+${formatNumber(extremes.maxClimb.value)} fpm` : '—', index: extremes.maxClimb?.index },
    { label: 'Descenso máx.', value: extremes.maxDescent ? `${formatNumber(extremes.maxDescent.value)} fpm` : '—', index: extremes.maxDescent?.index },
    { label: 'Recorrido', value: `${formatNumber(Math.round(distances[distances.length - 1] ?? 0))} NM`, index: undefined },
  ];

  return (
    <Panel
      title="Análisis del vuelo"
      description="Rueda del mouse para acercar y arrastra para moverte. Pasa el puntero por la ruta o por las gráficas para ver cada punto; un clic lo fija."
    >
      {loading ? (
        <Skeleton className="h-[560px]" />
      ) : points.length < 2 ? (
        <p className="text-sm text-muted">No hay traza disponible para este vuelo (se conserva 90 días).</p>
      ) : (
        <div ref={rootRef} className={cn('space-y-3', fullscreen && 'overflow-auto bg-bg p-4')}>
          {/* Controles */}
          <div className="flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="Color de la ruta" className="inline-flex rounded-md border border-line p-0.5">
              {(
                [
                  ['phase', 'Por etapa'],
                  ['altitude', 'Por altitud'],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={colorMode === mode}
                  onClick={() => setColorMode(mode)}
                  className={cn(
                    'rounded px-2.5 py-1 text-sm transition-colors',
                    colorMode === mode ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="mx-1 h-5 w-px bg-line" aria-hidden />
            <Button size="sm" variant="ghost" onClick={() => setFocus((f) => ({ target: 'route', nonce: f.nonce + 1 }))}>
              <Route className="size-4" aria-hidden />
              Ruta completa
            </Button>
            {origin ? (
              <Button size="sm" variant="ghost" onClick={() => setFocus((f) => ({ target: 'origin', nonce: f.nonce + 1 }))}>
                <PlaneTakeoff className="size-4" aria-hidden />
                {origin.icao}
              </Button>
            ) : null}
            {destination ? (
              <Button size="sm" variant="ghost" onClick={() => setFocus((f) => ({ target: 'destination', nonce: f.nonce + 1 }))}>
                <PlaneLanding className="size-4" aria-hidden />
                {destination.icao}
              </Button>
            ) : null}
            {arrival ? (
              <Button size="sm" variant="ghost" onClick={() => setFocus((f) => ({ target: 'arrival', nonce: f.nonce + 1 }))}>
                <PlaneLanding className="size-4 text-warn-ink" aria-hidden />
                {arrival.icao} (real)
              </Button>
            ) : null}
            {pinnedIndex !== null ? (
              <Button size="sm" variant="ghost" onClick={() => setFocus((f) => ({ target: 'point', index: pinnedIndex, nonce: f.nonce + 1 }))}>
                <Crosshair className="size-4" aria-hidden />
                Punto fijado ({formatZuluTime(points[pinnedIndex]!.sampled_at).slice(0, 5)}Z)
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={toggleFullscreen} aria-pressed={fullscreen}>
              {fullscreen ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}
              {fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
            </Button>
          </div>

          <FlightMap
            points={points}
            times={times}
            markers={markers}
            airports={airports}
            colorMode={colorMode}
            activeIndex={activeIndex}
            onHover={setHoverIndex}
            onSelect={select}
            theme={theme}
            focus={focus}
            height={fullscreen ? 'max(320px, calc(100vh - 560px))' : '520px'}
          />

          {/* Leyenda */}
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted" aria-label="Leyenda de colores">
            {colorMode === 'phase'
              ? Object.entries(PHASE_GROUPS)
                  .filter(([g]) => groupsPresent.has(g as keyof typeof PHASE_GROUPS))
                  .map(([g, v]) => (
                    <li key={g} className="flex items-center gap-1.5">
                      <span className="h-1.5 w-5 rounded-full" style={{ background: v.color }} aria-hidden />
                      {v.label}
                    </li>
                  ))
              : ALTITUDE_BANDS.map((b) => (
                  <li key={b.label} className="flex items-center gap-1.5">
                    <span className="h-1.5 w-5 rounded-full" style={{ background: b.color }} aria-hidden />
                    {b.label}
                  </li>
                ))}
            <li className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-ok" aria-hidden />
              Salida
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-danger" aria-hidden />
              Destino
            </li>
          </ul>

          {/* Extremos: un clic lleva al punto */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {stats.map((s) => (
              <button
                key={s.label}
                type="button"
                disabled={s.index === undefined}
                onClick={() => s.index !== undefined && goTo(s.index)}
                className="rounded-md border border-line bg-bg px-3 py-2 text-left transition-colors enabled:hover:border-cyan disabled:cursor-default"
                title={s.index !== undefined ? 'Ver en el mapa y en las gráficas' : undefined}
              >
                <span className="block text-[10px] uppercase tracking-wide text-muted">{s.label}</span>
                <span className="block font-mono text-sm">{s.value}</span>
              </button>
            ))}
          </div>

          <FlightProfileChart
            points={points}
            times={times}
            distances={distances}
            spans={spans}
            markers={markers}
            activeIndex={activeIndex}
            pinned={pinnedIndex !== null}
            onHover={setHoverIndex}
            onSelect={select}
            onPin={setPinnedIndex}
          />
          <p className="text-xs text-muted">
            Marcadores: B calzos, M motores, ↗ despegue, ↘ contacto con pista, G motor y al aire, P pausa, ! aviso. Teclado: flechas para recorrer la
            traza (Mayús para saltar 10 puntos), Esc para soltar.
          </p>
        </div>
      )}
    </Panel>
  );
}
