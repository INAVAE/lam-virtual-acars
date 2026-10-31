import type { LandingRecord, PilotLandingStats } from '@lam/shared-types';
import { ArrowDownRight, ArrowUpRight, Check, Minus, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Select } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyRow, Table, Td, Th } from '@/components/ui/table';
import { usePilotLandingStats } from '@/hooks/use-stats-ops';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { describeError } from '@/lib/errors';
import { formatPilotNumber } from '@/lib/format';
import { formatVs } from '@/lib/pirep';
import { LANDING_COLORS, landingBucket, landingTrend, percent } from '@/lib/statistics';
import { useTimePrefs } from '@/lib/time-context';

const FINDING_LABELS: Record<string, string> = {
  landing_hard: 'Duro',
  landing_firm: 'Firme',
  landing_g: 'G alta',
  landing_bounce: 'Rebote',
  landing_pitch: 'Cabeceo',
  landing_bank: 'Alabeo',
};

function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'ok' | 'warn' }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className={cn('mt-1 font-display text-2xl font-semibold tabular-nums', tone === 'ok' && 'text-ok-ink', tone === 'warn' && 'text-warn-ink')}>{value}</p>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function num(v: number | null | undefined, suffix: string, digits = 0): string {
  return v === null || v === undefined ? '—' : `${v.toFixed(digits)}${suffix}`;
}

/** Barras de las últimas tomas (más antigua a la izquierda), hacia abajo según la VS. */
function LandingBars({ rows }: { rows: readonly LandingRecord[] }) {
  const { dual } = useTimePrefs();
  const ordered = [...rows].reverse();
  const max = Math.max(600, ...ordered.map((r) => Math.abs(r.vs_fpm)));
  const lines = [-200, -400, -600].filter((v) => Math.abs(v) <= max);
  return (
    <figure aria-label="Velocidad vertical de las últimas tomas">
      <div className="relative h-44 border-t border-line">
        {lines.map((v) => (
          <div key={v} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line" style={{ top: `${(Math.abs(v) / max) * 100}%` }}>
            <span className="absolute -top-2 right-0 bg-surface px-1 font-mono text-[10px] text-muted">{v}</span>
          </div>
        ))}
        <div className="flex h-full items-start gap-1">
          {ordered.map((r) => (
            <Link
              key={r.id}
              to={`/pireps/${r.id}`}
              className="group flex h-full min-w-0 flex-1 flex-col"
              title={`${r.callsign} ${r.origin}→${r.arrival} · ${dual(r.at, { withDate: true }).primary} · ${formatVs(r.vs_fpm)}${r.g_force != null ? ` · ${r.g_force} G` : ''}${r.within_limits ? '' : ' · fuera de parámetros'}`}
            >
              <span
                className="block w-full rounded-b-sm opacity-85 transition-opacity group-hover:opacity-100"
                style={{ height: `${Math.max(2, (Math.abs(r.vs_fpm) / max) * 100)}%`, background: LANDING_COLORS[landingBucket(r.vs_fpm)] }}
              />
              {!r.within_limits ? <span className="mx-auto mt-0.5 size-1.5 rounded-full bg-danger" aria-hidden /> : null}
            </Link>
          ))}
        </div>
      </div>
      <figcaption className="mt-2 text-xs text-muted">
        Cada barra es una toma (la más reciente a la derecha); el punto rojo marca las que tuvieron faltas de aterrizaje. Clic para abrir el PIREP.
      </figcaption>
    </figure>
  );
}

/**
 * Técnica de aterrizaje de un piloto: promedios y proporciones de los
 * parámetros críticos (VS, G, cabeceo, alabeo, rebotes, viento cruzado) y
 * sus últimas tomas. Cuenta los PIREP aceptados y en revisión.
 */
export function LandingStatsPanel({ airlineId, pilots }: { airlineId: string | null; pilots: readonly { user_id: string; name: string; number: number }[] }) {
  const { user } = useAuth();
  const { dual } = useTimePrefs();
  const [pilotId, setPilotId] = useState<string | null>(null);
  const stats = usePilotLandingStats(pilotId, airlineId, 30);
  const s: PilotLandingStats | undefined = stats.data;
  const options = useMemo(() => pilots.filter((p) => p.user_id !== user?.id), [pilots, user?.id]);
  const sum = s?.summary;
  const trend = sum ? landingTrend(sum.last_10_average_vs_fpm, sum.previous_10_average_vs_fpm) : null;
  const TrendIcon = trend === 'better' ? ArrowUpRight : trend === 'worse' ? ArrowDownRight : Minus;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold">Aterrizajes {s?.pilot && s.user_id !== user?.id ? `de ${s.pilot.name}` : ''}</h2>
          <p className="text-sm text-muted">
            Promedios y proporciones de los parámetros críticos de la toma. Cuenta los PIREP aceptados y en revisión; “dentro de parámetros” es sin faltas
            de aterrizaje de la aerolínea (las anuladas no cuentan).
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          Piloto
          <Select value={pilotId ?? ''} onChange={(e) => setPilotId(e.target.value || null)} className="w-auto min-w-48">
            <option value="">Yo</option>
            {options.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.name} ({formatPilotNumber(p.number)})
              </option>
            ))}
          </Select>
        </label>
      </div>

      {stats.isError ? <Alert tone="danger">{describeError(stats.error)}</Alert> : null}
      {!s || !sum ? (
        stats.isError ? null : <Skeleton className="h-64" />
      ) : sum.landings === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-4 py-10 text-center">
          <p className="font-display text-lg font-semibold">Sin aterrizajes registrados</p>
          <p className="mt-1 text-sm text-muted">Aparecen aquí cuando LAM ACARS genera el PIREP de un vuelo con su toma.</p>
        </div>
      ) : (
        <>
          <section aria-label="Resumen de aterrizajes" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi
              label="Dentro de parámetros"
              value={percent(sum.within_limits_rate)}
              hint={`${sum.landings} tomas`}
              tone={(sum.within_limits_rate ?? 0) >= 0.8 ? 'ok' : (sum.within_limits_rate ?? 1) < 0.6 ? 'warn' : undefined}
            />
            <Kpi
              label="VS promedio"
              value={formatVs(sum.average_vs_fpm)}
              hint={
                <>
                  mediana {formatVs(sum.median_vs_fpm)}
                  {sum.stddev_vs_fpm != null ? ` · ±${sum.stddev_vs_fpm}` : ''}
                </>
              }
            />
            <Kpi label="Mejor / peor" value={<span className="text-xl">{`${formatVs(sum.best_vs_fpm)} / ${formatVs(sum.worst_vs_fpm)}`}</span>} />
            <Kpi label="Fuerza G" value={num(sum.average_g, ' G', 2)} hint={`máx. ${num(sum.max_g, ' G', 2)}`} />
            <Kpi label="Cabeceo / alabeo" value={<span className="text-xl">{`${num(sum.average_pitch_deg, '°', 1)} / ${num(sum.average_bank_deg, '°', 1)}`}</span>} hint={`alabeo máx. ${num(sum.max_bank_deg, '°', 1)}`} />
            <Kpi
              label="Tendencia"
              value={
                trend === null ? (
                  '—'
                ) : (
                  <span className={cn('inline-flex items-center gap-1', trend === 'better' ? 'text-ok-ink' : trend === 'worse' ? 'text-warn-ink' : undefined)}>
                    <TrendIcon className="size-5" aria-hidden />
                    {trend === 'better' ? 'Mejora' : trend === 'worse' ? 'Empeora' : 'Estable'}
                  </span>
                )
              }
              hint={trend === null ? 'con 11 tomas o más' : `últimas 10: ${formatVs(sum.last_10_average_vs_fpm)} · 10 anteriores: ${formatVs(sum.previous_10_average_vs_fpm)}`}
            />
          </section>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Panel title="Últimas tomas" description="Velocidad vertical en el contacto (fpm).">
              <LandingBars rows={s.recent} />
            </Panel>
            <Panel title="Proporciones" description="Porcentaje de tomas con cada condición.">
              <ul className="space-y-2.5">
                {(
                  [
                    ['Dentro de parámetros', sum.within_limits_rate, '#22c55e'],
                    ['Firmes (falta de la aerolínea)', sum.firm_rate, '#facc15'],
                    ['Duras (falta de la aerolínea)', sum.hard_rate, '#ef4444'],
                    ['Con rebote', sum.bounce_rate, '#f97316'],
                  ] as const
                ).map(([label, value, color]) => (
                  <li key={label} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_3.5rem] items-center gap-3 text-sm">
                    <span className="truncate">{label}</span>
                    <span className="h-2.5 overflow-hidden rounded-full bg-surface-2">
                      <span className="block h-full rounded-full" style={{ width: `${(value ?? 0) * 100}%`, background: color }} />
                    </span>
                    <span className="text-right font-mono text-xs tabular-nums text-muted">{percent(value)}</span>
                  </li>
                ))}
              </ul>
              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted">IAS promedio en la toma</dt>
                  <dd className="font-mono">{num(sum.average_ias_kt, ' kt')}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted">Viento cruzado</dt>
                  <dd className="font-mono">
                    {num(sum.average_crosswind_kt, ' kt', 1)}
                    <span className="ml-1 text-xs text-muted">máx. {num(sum.max_crosswind_kt, ' kt')}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted">Puntaje promedio</dt>
                  <dd className="font-mono">{num(sum.average_score, '', 1)}</dd>
                </div>
              </dl>
            </Panel>
          </div>

          <Table minWidth="64rem">
            <thead>
              <tr>
                <Th>Fecha</Th>
                <Th>Vuelo</Th>
                <Th className="text-right">VS</Th>
                <Th className="text-right">G</Th>
                <Th className="text-right">Cabeceo</Th>
                <Th className="text-right">Alabeo</Th>
                <Th className="text-right">Rebotes</Th>
                <Th className="text-right">Viento cruzado</Th>
                <Th>Parámetros</Th>
              </tr>
            </thead>
            <tbody>
              {s.recent.length === 0 ? (
                <EmptyRow colSpan={9}>Sin tomas.</EmptyRow>
              ) : (
                s.recent.map((r) => (
                  <tr key={r.id}>
                    <Td className="font-mono text-xs">{dual(r.at, { withDate: true }).primary}</Td>
                    <Td>
                      <Link to={`/pireps/${r.id}`} className="font-mono font-semibold hover:underline">
                        {r.callsign}
                      </Link>
                      <span className="block text-xs text-muted">
                        {r.origin} → {r.arrival} · {r.aircraft_type}
                      </span>
                    </Td>
                    <Td className="text-right font-mono tabular-nums">
                      <span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: LANDING_COLORS[landingBucket(r.vs_fpm)] }} aria-hidden />
                      {formatVs(r.vs_fpm)}
                    </Td>
                    <Td className="text-right font-mono tabular-nums">{num(r.g_force, '', 2)}</Td>
                    <Td className="text-right font-mono tabular-nums">{num(r.pitch_deg, '°', 1)}</Td>
                    <Td className="text-right font-mono tabular-nums">{num(r.bank_deg, '°', 1)}</Td>
                    <Td className="text-right font-mono tabular-nums">{r.bounces}</Td>
                    <Td className="text-right font-mono tabular-nums">{r.crosswind_kt == null ? '—' : `${Math.abs(r.crosswind_kt).toFixed(0)} kt`}</Td>
                    <Td>
                      {r.within_limits ? (
                        <span className="inline-flex items-center gap-1 text-sm text-ok-ink">
                          <Check className="size-4" aria-hidden /> Dentro
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-sm text-warn-ink">
                          <X className="size-4" aria-hidden />
                          {r.findings.map((f) => FINDING_LABELS[f] ?? f).join(', ')}
                        </span>
                      )}
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </>
      )}
    </div>
  );
}
