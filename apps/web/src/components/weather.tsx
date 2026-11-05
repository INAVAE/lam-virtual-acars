import { ArrowUp, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import {
  ageMinutes,
  describeWeather,
  flightCategory,
  flightCategoryLabels,
  flightCategoryTone,
  formatAge,
  formatAltimeter,
  formatClouds,
  formatTemperature,
  formatVisibility,
  formatWind,
  formatZulu,
  isOldMetar,
  tafChangeLabel,
  type Metar,
  type TafPeriod,
  type WeatherReport,
} from '@/lib/weather';

export function FlightCategoryBadge({ metar }: { metar: Metar | null }) {
  const category = metar ? flightCategory(metar) : null;
  if (!category) return <Badge>Sin categoría</Badge>;
  return (
    <Badge tone={flightCategoryTone[category]}>
      <span className="font-mono">{category}</span>
      {category !== 'VFR' && category !== 'IFR' ? <span className="sr-only"> ({flightCategoryLabels[category]})</span> : null}
    </Badge>
  );
}

/** Flecha que apunta hacia donde va el viento (viene de wind_dir). */
function WindArrow({ dir }: { dir: number | string | null }) {
  if (typeof dir !== 'number') return null;
  return <ArrowUp className="inline size-3.5 text-muted" style={{ transform: `rotate(${(dir + 180) % 360}deg)` }} aria-hidden />;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

function TafPeriodRow({ period }: { period: TafPeriod }) {
  const wx = describeWeather(period.weather);
  return (
    <li className="grid gap-x-3 gap-y-0.5 border-t border-line py-2 text-sm first:border-t-0 sm:grid-cols-[9rem_minmax(0,1fr)]">
      <div>
        <p className="font-medium">{tafChangeLabel(period)}</p>
        <p className="font-mono text-xs text-muted">
          {formatZulu(period.from)} – {formatZulu(period.to)}
        </p>
      </div>
      <p className="text-muted">
        {[
          period.wind_kt !== null ? formatWind(period.wind_dir, period.wind_kt, period.gust_kt) : null,
          period.visibility_sm !== null ? formatVisibility(period.visibility_sm) : null,
          wx,
          period.clouds.length > 0 || period.vertical_visibility_ft !== null ? formatClouds(period.clouds, period.vertical_visibility_ft) : null,
        ]
          .filter(Boolean)
          .join(' · ') || 'Sin cambios en viento, visibilidad ni nubes'}
      </p>
    </li>
  );
}

/** Tarjeta completa: METAR original y decodificado, y TAF. */
export function WeatherCard({ icao, report, onRemove }: { icao: string; report: WeatherReport | undefined; onRemove?: () => void }) {
  const [showTaf, setShowTaf] = useState(false);
  const metar = report?.metar ?? null;
  const taf = report?.taf ?? null;
  const age = ageMinutes(metar?.observed_at ?? null);
  const wx = describeWeather(metar?.weather ?? null);

  return (
    <article className="rounded-lg border border-line bg-surface" aria-label={`Clima de ${icao}`}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2">
            <span className="font-mono text-xl font-semibold">{icao}</span>
            {metar ? <FlightCategoryBadge metar={metar} /> : null}
          </p>
          <p className="truncate text-sm text-muted">{report?.name ?? 'Estación sin nombre'}</p>
        </div>
        <div className="flex items-start gap-2">
          {metar ? (
            <p className={cn('text-right text-xs', isOldMetar(age) ? 'text-warn-ink' : 'text-muted')}>
              <span className="font-mono">{formatZulu(metar.observed_at)}</span>
              <br />
              {formatAge(age)}
              {isOldMetar(age) ? ' · no vigente' : ''}
            </p>
          ) : null}
          {onRemove ? (
            <button
              type="button"
              onClick={onRemove}
              className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink"
              aria-label={`Quitar ${icao}`}
              title={`Quitar ${icao}`}
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
      </header>

      <div className="space-y-4 p-4">
        {metar?.raw ? (
          <p className="rounded-md border border-line bg-bg px-3 py-2 font-mono text-sm leading-relaxed break-words">{metar.raw}</p>
        ) : (
          <p className="text-sm text-muted">
            {report
              ? 'Esta estación no tiene un METAR reciente. Puede que no reporte o que el código no exista.'
              : 'Consultando…'}
          </p>
        )}

        {metar ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Fact label="Viento">
              <WindArrow dir={metar.wind_dir} /> {formatWind(metar.wind_dir, metar.wind_kt, metar.gust_kt)}
            </Fact>
            <Fact label="Visibilidad">{formatVisibility(metar.visibility_sm)}</Fact>
            <Fact label="QNH">{formatAltimeter(metar.altimeter_hpa)}</Fact>
            <Fact label="Temperatura">{formatTemperature(metar.temp_c, metar.dewpoint_c)}</Fact>
            <Fact label="Nubes">{formatClouds(metar.clouds, metar.vertical_visibility_ft)}</Fact>
            <Fact label="Fenómenos">{wx ?? 'Ninguno'}</Fact>
          </dl>
        ) : null}

        {taf?.raw ? (
          <div className="border-t border-line pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                TAF <span className="font-mono text-xs text-muted">válido {formatZulu(taf.valid_from)} – {formatZulu(taf.valid_to)}</span>
              </p>
              {taf.periods.length > 0 ? (
                <button type="button" className="text-sm font-medium text-cyan underline-offset-2 hover:underline" onClick={() => setShowTaf((v) => !v)}>
                  {showTaf ? 'Ocultar periodos' : 'Ver periodos'}
                </button>
              ) : null}
            </div>
            <p className="mt-2 font-mono text-xs leading-relaxed text-muted break-words">{taf.raw}</p>
            {showTaf ? (
              <ul className="mt-2">
                {taf.periods.map((p, i) => (
                  <TafPeriodRow key={`${p.from}-${i}`} period={p} />
                ))}
              </ul>
            ) : null}
          </div>
        ) : report && report.taf_fetched_at ? (
          <p className="border-t border-line pt-3 text-sm text-muted">Sin TAF para esta estación.</p>
        ) : null}
      </div>
    </article>
  );
}

/** Línea compacta para My Flights y la reserva: categoría, viento, visibilidad y QNH. */
export function WeatherStrip({ icao, report, loading }: { icao: string; report: WeatherReport | undefined; loading?: boolean }) {
  const metar = report?.metar ?? null;
  if (!metar) {
    return (
      <p className="text-xs text-muted">
        <span className="font-mono">{icao}</span> {loading ? 'consultando METAR…' : 'sin METAR reciente'}
      </p>
    );
  }
  const age = ageMinutes(metar.observed_at);
  return (
    <div className="space-y-1">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="font-mono font-medium">{icao}</span>
        <FlightCategoryBadge metar={metar} />
        <span>
          <WindArrow dir={metar.wind_dir} /> {formatWind(metar.wind_dir, metar.wind_kt, metar.gust_kt)}
        </span>
        <span className="text-muted">·</span>
        <span>{formatVisibility(metar.visibility_sm)}</span>
        <span className="text-muted">·</span>
        <span>QNH {metar.altimeter_hpa !== null ? Math.round(metar.altimeter_hpa) : '—'}</span>
        <span className={cn(isOldMetar(age) ? 'text-warn-ink' : 'text-muted')}>{formatAge(age)}</span>
      </p>
      {metar.raw ? <p className="font-mono text-[11px] leading-snug text-muted break-words">{metar.raw}</p> : null}
    </div>
  );
}
