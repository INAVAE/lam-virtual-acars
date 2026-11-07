import { ArrowLeft, Award, GraduationCap, Mail, MessageCircle, Pencil, Plane, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { AirlineLogo } from '@/components/airline-logo';
import { Avatar } from '@/components/avatar';
import { Expandable } from '@/components/expandable';
import { TourBadge } from '@/components/tour-badge';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyRow, Table, Td, Th } from '@/components/ui/table';
import { usePilotProfile, type PilotProfileData } from '@/hooks/use-pilot-profile';
import { usePilotTrainings, type PilotTraining } from '@/hooks/use-trainings';
import { describeError } from '@/lib/errors';
import { countryName, formatLocalDate, formatLocalDateTime, formatNumber, formatPilotNumber, roleLabels, statusLabels } from '@/lib/format';
import { formatHours, formatMinutes, formatVs, pirepStatusLabels, pirepStatusTone, scoreTone } from '@/lib/pirep';
import { monthLabel } from '@/lib/statistics';
import { DualTimeText } from '@/lib/time-context';
import { trainingCategories } from '@/lib/training';

const membershipTone = { active: 'ok', pending: 'warn', suspended: 'danger', rejected: 'neutral' } as const;

function Kpi({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function Header({ data }: { data: PilotProfileData }) {
  const p = data.profile;
  const active = data.memberships.filter((m) => m.status === 'active');
  return (
    <section aria-label="Datos del piloto" className="rounded-lg border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start gap-5">
        <Avatar name={p.display_name} url={p.avatar_url} size="lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-3xl font-semibold leading-tight">{p.display_name}</h1>
            <span className="font-mono text-lg text-muted">{formatPilotNumber(p.pilot_number)}</span>
            {p.is_superadmin ? (
              <Badge tone="info">
                <ShieldCheck className="mr-1 inline size-3.5" aria-hidden />
                Superadministrador
              </Badge>
            ) : null}
            {p.account_status === 'suspended' ? <Badge tone="danger">Acceso revocado</Badge> : null}
          </div>
          <p className="text-sm text-muted">
            {active.length > 0
              ? `${active.some((m) => m.roles.includes('pilot')) ? 'Piloto' : 'Miembro'} de ${active.map((m) => m.icao_code ?? m.name).join(', ')}`
              : 'Aún sin aerolínea'}
            {p.country_code ? ` · ${countryName(p.country_code)}` : ''} · En LAM desde {formatLocalDate(p.joined_at)}
          </p>
          {p.bio ? <p className="max-w-3xl whitespace-pre-line text-[15px]">{p.bio}</p> : null}
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
            {p.email ? (
              <li className="inline-flex items-center gap-1.5">
                <Mail className="size-4 text-muted" aria-hidden />
                <a href={`mailto:${p.email}`} className="underline-offset-4 hover:underline">
                  {p.email}
                </a>
              </li>
            ) : null}
            {p.ivao_vid ? (
              <li className="inline-flex items-center gap-1.5">
                <Plane className="size-4 text-muted" aria-hidden />
                IVAO{' '}
                <a
                  href={`https://www.ivao.aero/Member.aspx?Id=${p.ivao_vid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono underline-offset-4 hover:underline"
                >
                  {p.ivao_vid}
                </a>
              </li>
            ) : null}
            {p.discord_username ? (
              <li className="inline-flex items-center gap-1.5">
                <MessageCircle className="size-4 text-muted" aria-hidden />
                Discord <span className="font-mono">@{p.discord_username}</span>
              </li>
            ) : null}
            {p.simbrief_username ? (
              <li className="inline-flex items-center gap-1.5 text-muted">
                SimBrief <span className="font-mono text-ink">{p.simbrief_username}</span>
              </li>
            ) : null}
            {p.last_sign_in_at ? <li className="text-muted">Último acceso {formatLocalDateTime(p.last_sign_in_at)}</li> : null}
          </ul>
        </div>
        {data.viewer.self ? (
          <Link
            to="/account"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line px-3 text-sm hover:bg-surface-2"
          >
            <Pencil className="size-4" aria-hidden />
            Editar mi cuenta
          </Link>
        ) : null}
      </div>

      {data.memberships.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4" aria-label="Aerolíneas y roles">
          {data.memberships.map((m) => (
            <li key={m.airline_id} className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5">
              <AirlineLogo airline={m} size="sm" />
              <span className="text-sm">
                <span className="font-medium">{m.name}</span>
                <span className="block text-xs text-muted">{m.roles.map((r) => roleLabels[r]).join(', ')}</span>
              </span>
              {m.status !== 'active' ? <Badge tone={membershipTone[m.status]}>{statusLabels[m.status]}</Badge> : null}
              {data.profile.primary_airline_id === m.airline_id ? <Badge tone="info">Principal</Badge> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function MonthlyBars({ data }: { data: PilotProfileData['monthly'] }) {
  const max = Math.max(1, ...data.map((m) => m.flights));
  return (
    <div className="flex h-40 items-end gap-1.5" role="list" aria-label="Vuelos por mes">
      {data.map((m) => (
        <div key={m.month} role="listitem" className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${monthLabel(m.month)}: ${m.flights} vuelos · ${formatHours(m.block_minutes)} block`}>
          <span className="mb-1 text-center text-xs tabular-nums text-muted">{m.flights || ''}</span>
          <span className="rounded-t bg-accent/80" style={{ height: `${(m.flights / max) * 100}%`, minHeight: m.flights ? 4 : 1 }} />
          <span className="mt-1 truncate text-center text-[11px] text-muted">{monthLabel(m.month, false)}</span>
        </div>
      ))}
    </div>
  );
}

function Recognitions({ data, trainings }: { data: PilotProfileData; trainings: PilotTraining[] }) {
  const empty = data.tour_badges.length === 0 && trainings.length === 0 && data.events.length === 0 && data.type_ratings.length === 0;
  return (
    <Panel expandable title="Reconocimientos e insignias" description="Tours terminados, entrenamientos completados, eventos y habilitaciones.">
      {empty ? (
        <p className="text-sm text-muted">Todavía sin reconocimientos. Se ganan al terminar tours, completar entrenamientos y volar eventos.</p>
      ) : (
        <div className="space-y-5">
          {trainings.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-medium text-muted">Entrenamientos completados</h3>
              <ul className="flex flex-wrap gap-2">
                {trainings.map((t) => (
                  <li key={t.training_id} className="flex items-center gap-2 rounded-md border border-line px-3 py-2">
                    <GraduationCap className="size-5 text-accent" aria-hidden />
                    <span className="text-sm">
                      <Link to={`/training/${t.training_id}`} className="font-medium underline-offset-4 hover:underline">
                        {t.title}
                      </Link>
                      <span className="block text-xs text-muted">
                        {t.folio} · {trainingCategories[t.category].label} · {formatLocalDate(t.completed_at)}
                        {t.instructor ? ` · ${t.instructor}` : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {data.tour_badges.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-medium text-muted">Insignias de tours</h3>
              <ul className="flex flex-wrap gap-4">
                {data.tour_badges.map((b) => (
                  <li key={b.tour_id} className="flex w-28 flex-col items-center gap-1 text-center">
                    <TourBadge code={b.code} color={b.color} badgePath={b.badge_path} />
                    <Link to={`/tours/${b.tour_id}`} className="text-xs font-medium underline-offset-4 hover:underline">
                      {b.name}
                    </Link>
                    <span className="text-[11px] text-muted">{formatLocalDate(b.awarded_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {data.events.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-medium text-muted">Eventos</h3>
              <ul className="flex flex-wrap gap-2">
                {data.events.map((e) => (
                  <li key={e.event_id} className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-sm">
                    <Award className="size-4 text-accent" aria-hidden />
                    <Link to={`/events/${e.event_id}`} className="underline-offset-4 hover:underline">
                      {e.name}
                    </Link>
                    <span className="text-xs text-muted">{formatLocalDate(e.starts_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {data.type_ratings.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-medium text-muted">Habilitaciones de tipo</h3>
              <ul className="flex flex-wrap gap-1.5">
                {data.type_ratings.map((r) => (
                  <li key={`${r.airline_icao}-${r.icao_code}`}>
                    <Badge tone="neutral">
                      <span className="font-mono">{r.icao_code}</span> · {r.airline_icao}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

export function PilotProfilePage() {
  const { pilotNumber } = useParams();
  const location = useLocation();
  const number = Number.parseInt((pilotNumber ?? '').replace(/^LAM/i, ''), 10);
  const profile = usePilotProfile(Number.isFinite(number) ? number : null);
  const trainings = usePilotTrainings(Number.isFinite(number) ? number : null);
  const from = (location.state as { from?: string } | null)?.from;
  const d = profile.data;

  return (
    <div className="space-y-5">
      <Link to={from ?? '/pilots'} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        {from ? 'Regresar' : 'Pilots'}
      </Link>

      {!Number.isFinite(number) ? (
        <Alert tone="danger">El número de piloto no es válido.</Alert>
      ) : profile.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      ) : profile.isError ? (
        <Alert tone="danger">{describeError(profile.error)}</Alert>
      ) : d ? (
        <>
          <Header data={d} />

          <Expandable id="totales-del-piloto" title={`Totales de ${d.profile.display_name}`}>
            <section aria-label="Totales" className="grid grid-cols-2 gap-3 pr-10 md:grid-cols-4 xl:grid-cols-8">
              <Kpi label="Vuelos" value={formatNumber(d.totals.flights)} hint={d.totals.pending ? `${d.totals.pending} en revisión` : 'PIREP aceptados'} />
              <Kpi label="Horas de vuelo" value={formatHours(d.totals.flight_minutes)} hint="Del despegue al aterrizaje" />
              <Kpi label="Horas block" value={formatHours(d.totals.block_minutes)} hint="De calzos fuera a calzos" />
              <Kpi label="Distancia" value={`${formatNumber(d.totals.distance_nm)} NM`} />
              <Kpi label="Puntaje promedio" value={d.totals.average_score === null ? '—' : Number(d.totals.average_score).toFixed(1)} />
              <Kpi
                label="Toma promedio"
                value={d.totals.average_landing_vs_fpm === null ? '—' : formatVs(d.totals.average_landing_vs_fpm)}
                hint={d.totals.best_landing_vs_fpm === null ? undefined : `Mejor: ${formatVs(d.totals.best_landing_vs_fpm)}`}
              />
              <Kpi label="Aeropuertos" value={formatNumber(d.totals.airports)} />
              <Kpi
                label="Último vuelo"
                value={d.totals.last_flight_at ? formatLocalDate(d.totals.last_flight_at) : '—'}
                hint={d.totals.first_flight_at ? `Primero: ${formatLocalDate(d.totals.first_flight_at)}` : undefined}
              />
            </section>
          </Expandable>

          <div className="grid gap-5 xl:grid-cols-2">
            <Panel expandable title="Actividad de los últimos 12 meses" description="Vuelos aceptados por mes.">
              <MonthlyBars data={d.monthly} />
            </Panel>
            <Panel expandable title="Por aerolínea">
              <Table>
                <thead>
                  <tr>
                    <Th>Aerolínea</Th>
                    <Th className="text-right">Vuelos</Th>
                    <Th className="text-right">Horas block</Th>
                    <Th className="text-right">NM</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.by_airline.length === 0 ? (
                    <EmptyRow colSpan={4}>Sin vuelos aceptados.</EmptyRow>
                  ) : (
                    d.by_airline.map((a) => (
                      <tr key={a.name}>
                        <Td>
                          <span className="font-mono">{a.icao_code}</span> {a.name}
                        </Td>
                        <Td className="text-right tabular-nums">{a.flights}</Td>
                        <Td className="text-right tabular-nums">{formatHours(a.block_minutes)}</Td>
                        <Td className="text-right tabular-nums">{formatNumber(a.distance_nm)}</Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
            </Panel>
          </div>

          <Recognitions data={d} trainings={trainings.data ?? []} />

          <div className="grid gap-5 xl:grid-cols-2">
            <Panel expandable title="Tipos de aeronave que vuela">
              <Table>
                <thead>
                  <tr>
                    <Th>Tipo</Th>
                    <Th className="text-right">Vuelos</Th>
                    <Th className="text-right">Horas block</Th>
                    <Th>Último</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.aircraft_types.length === 0 ? (
                    <EmptyRow colSpan={4}>Sin vuelos aceptados.</EmptyRow>
                  ) : (
                    d.aircraft_types.map((t) => (
                      <tr key={t.icao_code}>
                        <Td>
                          <span className="font-mono font-semibold">{t.icao_code}</span>
                          <span className="block text-xs text-muted">
                            {t.manufacturer} {t.model}
                          </span>
                        </Td>
                        <Td className="text-right tabular-nums">{t.flights}</Td>
                        <Td className="text-right tabular-nums">{formatHours(t.block_minutes)}</Td>
                        <Td className="whitespace-nowrap">{formatLocalDate(t.last_at)}</Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
            </Panel>
            <Panel expandable title="Rutas voladas">
              <Table>
                <thead>
                  <tr>
                    <Th>Ruta</Th>
                    <Th className="text-right">Vuelos</Th>
                    <Th className="text-right">NM</Th>
                    <Th>Última</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.routes.length === 0 ? (
                    <EmptyRow colSpan={4}>Sin vuelos aceptados.</EmptyRow>
                  ) : (
                    d.routes.map((r) => (
                      <tr key={`${r.origin}-${r.destination}`}>
                        <Td>
                          <span className="font-mono font-semibold">
                            {r.origin} → {r.destination}
                          </span>
                          <span className="block text-xs text-muted">
                            {r.origin_city ?? ''} → {r.destination_city ?? ''}
                          </span>
                        </Td>
                        <Td className="text-right tabular-nums">{r.flights}</Td>
                        <Td className="text-right tabular-nums">{r.distance_nm === null ? '—' : formatNumber(r.distance_nm)}</Td>
                        <Td className="whitespace-nowrap">{formatLocalDate(r.last_at)}</Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
            </Panel>
          </div>

          <Panel
            expandable
            title="Historial de vuelos"
            description={
              d.viewer.self || d.viewer.staff
                ? 'Los últimos 50 PIREP, incluidos los que están en revisión o fueron rechazados.'
                : 'Los últimos 50 vuelos aceptados.'
            }
          >
            <Table minWidth="58rem">
              <thead>
                <tr>
                  <Th>Fecha</Th>
                  <Th>PIREP</Th>
                  <Th>Ruta</Th>
                  <Th>Aeronave</Th>
                  <Th className="text-right">Block</Th>
                  <Th className="text-right">NM</Th>
                  <Th className="text-right">Toma</Th>
                  <Th className="text-right">Puntaje</Th>
                  <Th>Estado</Th>
                </tr>
              </thead>
              <tbody>
                {d.recent_pireps.length === 0 ? (
                  <EmptyRow colSpan={9}>Todavía no hay vuelos.</EmptyRow>
                ) : (
                  d.recent_pireps.map((r) => (
                    <tr key={r.id}>
                      <Td className="whitespace-nowrap">
                        <DualTimeText value={r.date} withDate />
                      </Td>
                      <Td>
                        {r.can_open ? (
                          <Link to={`/pireps/${r.id}`} className="font-mono underline-offset-4 hover:underline">
                            {r.folio}
                          </Link>
                        ) : (
                          <span className="font-mono">{r.folio}</span>
                        )}
                        <span className="block font-mono text-xs text-muted">
                          {r.callsign} · {r.airline_icao}
                        </span>
                      </Td>
                      <Td className="font-mono">
                        {r.origin} → {r.destination}
                      </Td>
                      <Td>
                        <span className="font-mono">{r.aircraft_icao}</span>
                        <span className="block font-mono text-xs text-muted">{r.registration}</span>
                      </Td>
                      <Td className="text-right tabular-nums">{formatMinutes(r.block_minutes)}</Td>
                      <Td className="text-right tabular-nums">{r.distance_nm === null ? '—' : formatNumber(r.distance_nm)}</Td>
                      <Td className="text-right tabular-nums">{formatVs(r.landing_vs_fpm)}</Td>
                      <Td className="text-right">
                        <Badge tone={scoreTone(r.score)}>{r.score}</Badge>
                      </Td>
                      <Td>
                        <Badge tone={pirepStatusTone[r.status]}>{pirepStatusLabels[r.status]}</Badge>
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </Panel>
        </>
      ) : null}
    </div>
  );
}
