import type { PirepStatus } from '@lam/shared-types';
import { ArrowRight, TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyRow, Table, Td, Th } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { combineStatistics, usePilotStatistics, usePireps, type PirepListItem, type PirepListView } from '@/hooks/use-pireps';
import { useAuth } from '@/lib/auth';
import { useAirlineScope } from '@/lib/airline-scope';
import { describeError } from '@/lib/errors';
import { formatLocalDateTime, formatNumber, formatPilotNumber } from '@/lib/format';
import { useAirlinePermissions } from '@/lib/permissions';
import { formatHours, formatMinutes, formatVs, landingRating, pirepStatusLabels, pirepStatusTone, scoreTone } from '@/lib/pirep';

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function MyStatistics({ airlineId }: { airlineId: string | null }) {
  const { user } = useAuth();
  const stats = usePilotStatistics(airlineId, user?.id);
  if (stats.isPending) return <Skeleton className="h-20" />;
  if (stats.isError) return <Alert tone="danger">{describeError(stats.error)}</Alert>;
  const s = combineStatistics(stats.data);
  return (
    <section aria-label="Tus estadísticas" className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <Stat label="Horas (block)" value={formatHours(s.block_minutes)} hint={`${formatHours(s.flight_minutes)} en vuelo`} />
      <Stat label="Vuelos aceptados" value={formatNumber(s.pireps_accepted)} hint={`${s.pireps_pending} en revisión · ${s.pireps_rejected} rechazados`} />
      <Stat label="Distancia" value={`${formatNumber(s.distance_nm)} NM`} />
      <Stat label="Puntaje promedio" value={s.average_score === null ? '—' : s.average_score.toFixed(1)} />
      <Stat label="Toma promedio" value={s.average_landing_vs_fpm === null ? '—' : formatVs(s.average_landing_vs_fpm)} />
    </section>
  );
}

function ScoreBadge({ score }: { score: number }) {
  return (
    <Badge tone={scoreTone(score)} className="min-w-10 justify-center font-mono text-sm">
      {score}
    </Badge>
  );
}

function PirepTable({ pireps, showPilot, empty }: { pireps: PirepListItem[]; showPilot: boolean; empty: string }) {
  const navigate = useNavigate();
  const columns = showPilot ? 9 : 8;
  return (
    <Table minWidth="60rem">
      <thead>
        <tr>
          <Th>Fecha</Th>
          <Th>Callsign</Th>
          {showPilot ? <Th>Piloto</Th> : null}
          <Th>Ruta</Th>
          <Th>Aeronave</Th>
          <Th className="text-right">Block</Th>
          <Th className="text-right">Toma</Th>
          <Th className="text-right">Puntaje</Th>
          <Th>Estado</Th>
        </tr>
      </thead>
      <tbody>
        {pireps.length === 0 ? (
          <EmptyRow colSpan={columns}>{empty}</EmptyRow>
        ) : (
          pireps.map((p) => {
            const rating = landingRating(p.landing_vs_fpm);
            return (
              <tr
                key={p.id}
                className="cursor-pointer hover:bg-surface-2/50"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('a')) return;
                  void navigate(`/pireps/${p.id}`);
                }}
              >
                <Td className="whitespace-nowrap">{formatLocalDateTime(p.block_on_at ?? p.created_at)}</Td>
                <Td>
                  <Link to={`/pireps/${p.id}`} className="font-mono font-medium underline-offset-2 hover:underline">
                    {p.callsign}
                  </Link>
                  <p className="text-xs text-muted">{p.airline?.name}</p>
                </Td>
                {showPilot ? (
                  <Td>
                    <p>{p.pilot?.display_name}</p>
                    <p className="font-mono text-xs text-muted">{p.pilot ? formatPilotNumber(p.pilot.pilot_number) : ''}</p>
                  </Td>
                ) : null}
                <Td className="whitespace-nowrap font-mono">
                  {p.origin?.icao_code} <ArrowRight className="inline size-3.5 text-muted" aria-label="a" /> {p.destination?.icao_code}
                  {p.diverted ? (
                    <span className="ml-1.5 text-xs text-warn-ink" title="Llegó a otro aeropuerto">
                      ({p.arrival?.icao_code ?? 'sin aeropuerto'})
                    </span>
                  ) : null}
                </Td>
                <Td className="font-mono">
                  {p.aircraft_registration} <span className="text-muted">{p.type?.icao_code}</span>
                </Td>
                <Td className="text-right font-mono tabular-nums">{formatMinutes(p.block_minutes)}</Td>
                <Td className="whitespace-nowrap text-right">
                  <span className="font-mono tabular-nums">{formatVs(p.landing_vs_fpm)}</span>
                  {rating ? <p className="text-xs text-muted">{rating.label}</p> : null}
                </Td>
                <Td className="text-right">
                  <ScoreBadge score={p.score} />
                </Td>
                <Td>
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge tone={pirepStatusTone[p.status]}>{pirepStatusLabels[p.status]}</Badge>
                    {p.has_critical && p.status === 'pending' ? (
                      <TriangleAlert className="size-4 text-warn-ink" aria-label="Con faltas graves" />
                    ) : null}
                    {p.auto_approved ? <span className="text-xs text-muted">automático</span> : null}
                  </div>
                </Td>
              </tr>
            );
          })
        )}
      </tbody>
    </Table>
  );
}

export function PirepsPage() {
  const { selected, isOrgAdmin } = useAirlineScope();
  const permissions = useAirlinePermissions(selected?.id);
  const canReview = selected ? permissions.canStaff : isOrgAdmin;
  const [view, setView] = useState<PirepListView>('mine');
  const [status, setStatus] = useState<PirepStatus | 'all'>('all');
  const effectiveView = canReview ? view : 'mine';
  const pireps = usePireps(effectiveView, selected?.id ?? null, status, isOrgAdmin);
  const pending = usePireps('review', selected?.id ?? null, 'all', isOrgAdmin);

  return (
    <div className="space-y-6">
      <PageHeader
        title="PIREP"
        description={
          <>
            Cada vuelo completado en LAM ACARS genera su reporte con tiempos, combustible, aterrizaje y puntaje. Al aceptarse, suma tus horas y
            las de la aeronave.
          </>
        }
      />

      {effectiveView === 'mine' ? <MyStatistics airlineId={selected?.id ?? null} /> : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        {canReview ? (
          <Tabs
            label="PIREP"
            value={view}
            onChange={setView}
            items={[
              { value: 'mine', label: 'Mis PIREP' },
              { value: 'review', label: 'Por revisar', count: pending.data?.length },
              { value: 'airline', label: selected ? `Todos de ${selected.icao_code ?? selected.name}` : 'Todos' },
            ]}
          />
        ) : (
          <span />
        )}
        {effectiveView !== 'review' ? (
          <label className="flex items-center gap-2 text-sm text-muted">
            Estado
            <Select className="h-9 w-40" value={status} onChange={(e) => setStatus(e.target.value as PirepStatus | 'all')}>
              <option value="all">Todos</option>
              <option value="pending">{pirepStatusLabels.pending}</option>
              <option value="accepted">{pirepStatusLabels.accepted}</option>
              <option value="rejected">{pirepStatusLabels.rejected}</option>
            </Select>
          </label>
        ) : null}
      </div>

      {pireps.isError ? <Alert tone="danger">{describeError(pireps.error)}</Alert> : null}
      {pireps.isPending ? (
        <Skeleton className="h-64" />
      ) : (
        <PirepTable
          pireps={pireps.data ?? []}
          showPilot={effectiveView !== 'mine'}
          empty={
            effectiveView === 'review'
              ? 'No hay PIREP pendientes de revisión.'
              : effectiveView === 'mine'
                ? 'Aún no tienes PIREP. Completa un vuelo con LAM ACARS y aparecerá aquí.'
                : 'La aerolínea aún no tiene PIREP.'
          }
        />
      )}
      {effectiveView === 'review' && (pending.data?.length ?? 0) > 0 ? (
        <p className="text-sm text-muted">
          Los más antiguos primero.{isOrgAdmin ? '' : ' Tus propios PIREP los revisa otra persona del staff.'}
        </p>
      ) : null}
    </div>
  );
}
