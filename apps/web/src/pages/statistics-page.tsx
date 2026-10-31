import type { AirlineStatistics } from '@lam/shared-types';
import { ArrowDown, Medal } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { LandingStatsPanel } from '@/components/landing-stats-panel';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyRow, Table, Td, Th } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { useAirlineStatistics } from '@/hooks/use-stats-ops';
import { useAuth } from '@/lib/auth';
import { useAirlineScope } from '@/lib/airline-scope';
import { cn } from '@/lib/cn';
import { describeError } from '@/lib/errors';
import { formatNumber, formatPilotNumber } from '@/lib/format';
import { formatHours, formatVs, scoreTone } from '@/lib/pirep';
import { LANDING_COLORS, monthLabel, sortRanking, type RankingKey } from '@/lib/statistics';
import { useTimePrefs } from '@/lib/time-context';

type Metric = 'block_minutes' | 'flights' | 'distance_nm';

const METRICS: { value: Metric; label: string }[] = [
  { value: 'block_minutes', label: 'Horas' },
  { value: 'flights', label: 'Vuelos' },
  { value: 'distance_nm', label: 'Distancia' },
];

function metricText(metric: Metric, value: number): string {
  if (metric === 'block_minutes') return formatHours(value);
  if (metric === 'distance_nm') return `${formatNumber(value)} NM`;
  return formatNumber(value);
}

function Kpi({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/** Barras verticales por mes (HTML, sin librería): un valor por mes con su etiqueta. */
function MonthlyBars({ data, metric }: { data: AirlineStatistics['monthly']; metric: Metric }) {
  const max = Math.max(1, ...data.map((m) => m[metric]));
  return (
    <figure>
      <div className="flex h-48 items-end gap-1.5 border-b border-line" role="list" aria-label="Actividad por mes">
        {data.map((m) => {
          const v = m[metric];
          return (
            <div key={m.month} role="listitem" className="group flex h-full min-w-0 flex-1 flex-col justify-end" title={`${monthLabel(m.month)}: ${metricText(metric, v)} · ${m.flights} vuelos · ${m.pilots} pilotos`}>
              <span className="mb-1 text-center font-mono text-[10px] text-muted opacity-0 transition-opacity group-hover:opacity-100">{v > 0 ? metricText(metric, v) : ''}</span>
              <div
                className="w-full rounded-t-sm bg-accent/80 transition-colors group-hover:bg-accent"
                style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? 3 : 0 }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1.5">
        {data.map((m, i) => (
          <span key={m.month} className="min-w-0 flex-1 truncate text-center text-[10px] text-muted">
            {data.length > 12 && i % 2 === 1 ? '' : monthLabel(m.month, data.length <= 12 ? false : true)}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** Barra horizontal con etiqueta y valor. */
function HBar({ label, value, max, color, text }: { label: ReactNode; value: number; max: number; color?: string; text: string }) {
  return (
    <li className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
      <span className="truncate">{label}</span>
      <span className="h-2.5 overflow-hidden rounded-full bg-surface-2">
        <span className="block h-full rounded-full" style={{ width: `${max > 0 ? (value / max) * 100 : 0}%`, background: color ?? 'var(--accent)' }} />
      </span>
      <span className="font-mono text-xs tabular-nums text-muted">{text}</span>
    </li>
  );
}

const RANK_COLUMNS: { key: RankingKey; label: string }[] = [
  { key: 'block_minutes', label: 'Horas' },
  { key: 'flights', label: 'Vuelos' },
  { key: 'distance_nm', label: 'Distancia' },
  { key: 'average_score', label: 'Puntaje' },
  { key: 'average_landing_vs_fpm', label: 'Toma prom.' },
  { key: 'last_30_days_minutes', label: '30 días' },
];

function Ranking({ rows }: { rows: AirlineStatistics['ranking'] }) {
  const { user } = useAuth();
  const { dual } = useTimePrefs();
  const [sortKey, setSortKey] = useState<RankingKey>('block_minutes');
  const sorted = useMemo(() => sortRanking(rows, sortKey), [rows, sortKey]);
  return (
    <Table minWidth="56rem">
      <thead>
        <tr>
          <Th className="w-12">#</Th>
          <Th>Piloto</Th>
          {RANK_COLUMNS.map((c) => (
            <Th key={c.key} className="text-right" aria-sort={sortKey === c.key ? 'descending' : 'none'}>
              <button type="button" onClick={() => setSortKey(c.key)} className={cn('inline-flex items-center gap-1', sortKey === c.key ? 'text-ink' : 'hover:text-ink')}>
                {c.label}
                {sortKey === c.key ? <ArrowDown className="size-3.5" aria-hidden /> : null}
              </button>
            </Th>
          ))}
          <Th>Último vuelo</Th>
        </tr>
      </thead>
      <tbody>
        {sorted.length === 0 ? (
          <EmptyRow colSpan={9}>Todavía no hay PIREP aceptados: el ranking aparece con el primero.</EmptyRow>
        ) : (
          sorted.map((r, i) => (
            <tr key={r.user_id} className={cn(r.user_id === user?.id && 'bg-accent/10')}>
              <Td className="font-mono tabular-nums">
                {i < 3 ? <Medal className={cn('inline size-4', i === 0 ? 'text-yellow-400' : i === 1 ? 'text-slate-300' : 'text-amber-600')} aria-label={`Lugar ${i + 1}`} /> : i + 1}
              </Td>
              <Td>
                <span className="font-medium">{r.name}</span>
                {r.user_id === user?.id ? <Badge tone="info" className="ml-1.5">Tú</Badge> : null}
                <span className="block font-mono text-xs text-muted">{formatPilotNumber(r.number)}</span>
              </Td>
              <Td className="text-right font-mono tabular-nums">{formatHours(r.block_minutes)}</Td>
              <Td className="text-right font-mono tabular-nums">{formatNumber(r.flights)}</Td>
              <Td className="text-right font-mono tabular-nums">{formatNumber(r.distance_nm)} NM</Td>
              <Td className="text-right">
                {r.average_score === null ? '—' : <Badge tone={scoreTone(r.average_score)} className="font-mono">{r.average_score.toFixed(1)}</Badge>}
              </Td>
              <Td className="text-right font-mono tabular-nums">{r.average_landing_vs_fpm === null ? '—' : formatVs(r.average_landing_vs_fpm)}</Td>
              <Td className="text-right font-mono tabular-nums">{formatHours(r.last_30_days_minutes)}</Td>
              <Td className="font-mono text-xs">{dual(r.last_flight_at, { withDate: true }).primary}</Td>
            </tr>
          ))
        )}
      </tbody>
    </Table>
  );
}

/**
 * Estadísticas de la aerolínea a partir de los PIREP aceptados: totales,
 * actividad por mes, rutas, aeronaves, aterrizajes, faltas frecuentes y el
 * ranking de pilotos (visible para todos los miembros).
 */
export function StatisticsPage() {
  const { selected: airline } = useAirlineScope();
  const [months, setMonths] = useState(12);
  const [metric, setMetric] = useState<Metric>('block_minutes');
  const [tab, setTab] = useState<'airline' | 'landings'>('airline');
  const stats = useAirlineStatistics(airline?.id ?? null, months);
  const s = stats.data;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Estadísticas"
        description={`${airline ? airline.name : 'Todas las aerolíneas'}: cifras de los PIREP aceptados. Los PIREP en revisión no cuentan hasta aprobarse.`}
        actions={
          tab === 'landings' ? null : (
          <label className="flex items-center gap-2 text-sm text-muted">
            Periodo
            <Select value={months} onChange={(e) => setMonths(Number(e.target.value))} className="w-auto">
              <option value={6}>6 meses</option>
              <option value={12}>12 meses</option>
              <option value={24}>24 meses</option>
            </Select>
          </label>
          )
        }
      />

      <Tabs
        label="Estadísticas"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'airline', label: 'Aerolínea' },
          { value: 'landings', label: 'Aterrizajes' },
        ]}
      />

      {tab === 'landings' ? (
        <LandingStatsPanel airlineId={airline?.id ?? null} pilots={s?.ranking ?? []} />
      ) : (
      <>

      {stats.isError ? <Alert tone="danger">{describeError(stats.error)}</Alert> : null}

      {!s ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <>
          <section aria-label="Totales" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Vuelos" value={formatNumber(s.totals.flights)} hint={`${formatNumber(s.last_30_days.flights)} en 30 días`} />
            <Kpi label="Horas (block)" value={formatHours(s.totals.block_minutes)} hint={`${formatHours(s.last_30_days.block_minutes)} en 30 días`} />
            <Kpi label="Distancia" value={`${formatNumber(s.totals.distance_nm)} NM`} hint={`${formatNumber(s.last_30_days.distance_nm)} NM en 30 días`} />
            <Kpi label="Pilotos con vuelos" value={formatNumber(s.totals.pilots)} hint={`${formatNumber(s.last_30_days.pilots)} activos en 30 días`} />
            <Kpi label="Puntaje promedio" value={s.totals.average_score === null ? '—' : s.totals.average_score.toFixed(1)} hint={s.last_30_days.average_score === null ? undefined : `${s.last_30_days.average_score.toFixed(1)} en 30 días`} />
            <Kpi
              label="Toma promedio"
              value={s.totals.average_landing_vs_fpm == null ? '—' : formatVs(s.totals.average_landing_vs_fpm)}
              hint={s.totals.airports ? `${formatNumber(s.totals.airports)} aeropuertos servidos` : undefined}
            />
          </section>

          <Panel
            title="Actividad por mes"
            description="Pasa el puntero por cada barra para ver el detalle del mes."
            actions={
              <div role="radiogroup" aria-label="Dato de la gráfica" className="inline-flex rounded-md border border-line p-0.5">
                {METRICS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    role="radio"
                    aria-checked={metric === m.value}
                    onClick={() => setMetric(m.value)}
                    className={cn('rounded px-2.5 py-1 text-sm transition-colors', metric === m.value ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink')}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            }
          >
            <MonthlyBars data={s.monthly} metric={metric} />
          </Panel>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="Rutas más voladas">
              {s.top_routes.length === 0 ? (
                <p className="text-sm text-muted">Sin vuelos aceptados todavía.</p>
              ) : (
                <ul className="space-y-2.5">
                  {s.top_routes.map((r) => (
                    <HBar
                      key={`${r.origin}-${r.destination}`}
                      label={
                        <span className="font-mono" title={`${r.origin_city ?? r.origin} → ${r.destination_city ?? r.destination}`}>
                          {r.origin} → {r.destination}
                        </span>
                      }
                      value={r.flights}
                      max={s.top_routes[0]!.flights}
                      text={`${r.flights} · ${formatHours(r.block_minutes)}`}
                    />
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Aeronaves">
              {s.aircraft_types.length === 0 ? (
                <p className="text-sm text-muted">Sin vuelos aceptados todavía.</p>
              ) : (
                <ul className="space-y-2.5">
                  {s.aircraft_types.map((t) => (
                    <HBar
                      key={t.icao}
                      label={
                        <span title={t.model}>
                          <span className="font-mono">{t.icao}</span> <span className="text-muted">{t.model}</span>
                        </span>
                      }
                      value={t.flights}
                      max={s.aircraft_types[0]!.flights}
                      text={`${t.flights} · ${formatHours(t.block_minutes)}`}
                    />
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Aterrizajes" description="Velocidad vertical al tocar pista (fpm).">
              <ul className="space-y-2.5">
                {s.landings.map((l) => (
                  <HBar
                    key={l.bucket}
                    label={<span className="font-mono">{l.label}</span>}
                    value={l.flights}
                    max={Math.max(1, ...s.landings.map((x) => x.flights))}
                    color={LANDING_COLORS[l.bucket]}
                    text={formatNumber(l.flights)}
                  />
                ))}
              </ul>
            </Panel>
            <Panel title="Faltas más frecuentes" description={`Reglas que restaron puntos en los últimos ${months} meses (todos los PIREP).`}>
              {s.common_findings.length === 0 ? (
                <p className="text-sm text-muted">Sin faltas en el periodo.</p>
              ) : (
                <ul className="space-y-2.5">
                  {s.common_findings.map((f) => (
                    <HBar key={f.code} label={f.label} value={f.count} max={s.common_findings[0]!.count} color="var(--warn)" text={formatNumber(f.count)} />
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <section aria-labelledby="ranking-title" className="space-y-3">
            <div>
              <h2 id="ranking-title" className="font-display text-xl font-semibold">
                Ranking de pilotos
              </h2>
              <p className="text-sm text-muted">Clic en una columna para ordenar. La toma promedio ordena de la más suave a la más dura.</p>
            </div>
            <Ranking rows={s.ranking} />
          </section>
        </>
      )}
      </>
      )}
    </div>
  );
}
