import type { DashboardSummary } from '@lam/shared-types';
import { useMemo } from 'react';
import { toast } from 'sonner';
import { AirlineLogo } from '@/components/airline-logo';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useAirlines,
  useCancelMembershipRequest,
  useDashboardSummary,
  useMyMemberships,
  useProfile,
  useRequestMembership,
  type Airline,
  type Membership,
} from '@/hooks/use-lam-data';
import { useAirlineScope } from '@/lib/airline-scope';
import { describeError } from '@/lib/errors';
import { displayDomain, formatPilotNumber, formatRoles, operationTypeLabel, statusLabels } from '@/lib/format';

// -----------------------------------------------------------------------------
// Encabezado: el código de la aerolínea es la identidad de la pantalla.
// -----------------------------------------------------------------------------
const LAM_EMBLEM = {
  name: 'Líneas Aéreas Mexicanas',
  icao_code: 'LAM',
  logo_path: 'airlines/lineas-aereas-mexicanas.png',
  brand_primary_color: '#057956',
};

function OperationFacts({ airline }: { airline: Airline }) {
  const facts = [
    { label: 'Operación', value: operationTypeLabel(airline.operation_type), mono: false },
    { label: 'Red', value: airline.network === 'OFFLINE' ? 'Sin red' : airline.network, mono: true },
    { label: 'RMK', value: airline.flight_plan_remarks, mono: true },
  ];
  return (
    <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
      {facts.map((f) => (
        <div key={f.label} className="flex items-baseline gap-2">
          <dt className="text-muted">{f.label}</dt>
          <dd className={f.value ? (f.mono ? 'font-mono text-ink' : 'text-ink') : 'text-muted/70'}>{f.value ?? 'Sin definir'}</dd>
        </div>
      ))}
      {airline.website_url ? (
        <div className="flex items-baseline gap-2">
          <dt className="text-muted">Sitio</dt>
          <dd>
            <a href={airline.website_url} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-4">
              {displayDomain(airline.website_url)}
            </a>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

function ScopeHeader() {
  const { selected, isOrgAdmin } = useAirlineScope();
  const profile = useProfile();
  const code = selected ? (selected.icao_code ?? '···') : 'LAM';
  const title = selected ? selected.name : 'Líneas Aéreas Mexicanas';
  const scopeText = selected
    ? 'Datos de esta aerolínea.'
    : isOrgAdmin
      ? 'Vista consolidada de todas las aerolíneas.'
      : 'Datos de tus aerolíneas.';
  const logoSource = selected ?? LAM_EMBLEM;

  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-4">
      <div className="flex items-stretch gap-3">
        {logoSource.logo_path ? <AirlineLogo airline={logoSource} size="lg" /> : null}
        <div
          aria-hidden
          className="flex h-20 min-w-28 items-center justify-center rounded-xl bg-accent px-4 font-mono text-4xl font-medium tracking-[0.12em] text-accent-ink"
        >
          {code}
        </div>
      </div>
      <div className="min-w-0">
        <h1 className="font-display text-3xl font-semibold leading-tight sm:text-4xl">{title}</h1>
        <p className="mt-1 text-muted">
          {profile.data ? (
            <>
              {profile.data.display_name}, piloto{' '}
              <span className="font-mono text-ink">{formatPilotNumber(profile.data.pilot_number)}</span>. {scopeText}
            </>
          ) : (
            scopeText
          )}
        </p>
        {selected?.is_unofficial_brand ? (
          <p className="mt-1 text-sm text-warn-ink">Operación virtual no oficial, sin relación con la aerolínea real.</p>
        ) : null}
        {selected ? <OperationFacts airline={selected} /> : null}
      </div>
    </header>
  );
}

// -----------------------------------------------------------------------------
// Indicadores
// -----------------------------------------------------------------------------
interface Metric {
  label: string;
  value: string | null;
  detail?: string;
  phase?: number;
}

function buildMetrics(summary: DashboardSummary | undefined, canManage: boolean): Metric[] {
  const live: Metric[] = [
    {
      label: 'Aerolíneas activas',
      value: summary ? String(summary.airlines_active) : null,
      detail: summary ? `de ${summary.airlines_total} registradas` : undefined,
    },
    {
      label: 'Pilotos con membresía activa',
      value: summary ? String(summary.pilots_active_members) : null,
    },
    {
      label: 'Tus reservas activas',
      value: summary ? String(summary.my_bookings_active) : null,
    },
  ];
  if (canManage) {
    live.push({ label: 'Reservas activas', value: summary ? String(summary.bookings_active) : null, detail: 'de todos los pilotos' });
  }
  if (canManage) {
    live.push({
      label: 'Solicitudes de ingreso pendientes',
      value: summary ? String(summary.pending_requests) : null,
    });
  }
  if (summary?.profiles_total !== null && summary?.profiles_total !== undefined) {
    live.push({ label: 'Cuentas registradas en LAM', value: String(summary.profiles_total) });
  }

  const upcoming: Metric[] = [
    { label: 'Vuelos activos', value: null, phase: 4 },
    { label: 'Vuelos del mes', value: null, phase: 5 },
    { label: 'Horas acumuladas', value: null, phase: 5 },
    { label: 'PIREP pendientes', value: null, phase: 5 },
  ];
  return [...live, ...upcoming];
}

function MetricStrip({ metrics, loading }: { metrics: Metric[]; loading: boolean }) {
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-4">
      {metrics.map((m) => (
        <div
          key={m.label}
          className="flex min-h-28 flex-col justify-between gap-2 border-b border-r border-line p-4 [&:nth-child(2n)]:border-r-0 sm:[&:nth-child(2n)]:border-r sm:[&:nth-child(4n)]:border-r-0"
        >
          <dt className="text-sm text-muted">{m.label}</dt>
          <dd>
            {m.phase ? (
              <span className="flex items-baseline gap-2">
                <span className="font-display text-3xl font-semibold text-muted/50" aria-hidden>
                  —
                </span>
                <span className="text-sm text-muted">Llega en la Fase {m.phase}</span>
              </span>
            ) : loading || m.value === null ? (
              <Skeleton className="h-9 w-16" />
            ) : (
              <span className="flex items-baseline gap-2">
                <span className="font-display text-4xl font-semibold tabular-nums leading-none">{m.value}</span>
                {m.detail ? <span className="text-sm text-muted">{m.detail}</span> : null}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// -----------------------------------------------------------------------------
// Membresías y solicitudes de ingreso
// -----------------------------------------------------------------------------
const statusTone = {
  active: 'ok',
  pending: 'warn',
  suspended: 'danger',
  rejected: 'neutral',
} as const;

function MembershipRow({ membership, airline }: { membership: Membership; airline: Airline | undefined }) {
  const cancel = useCancelMembershipRequest();
  const isPending = membership.status === 'pending';

  async function onCancel() {
    try {
      await cancel.mutateAsync(membership.id);
      toast.success('Solicitud cancelada');
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      {airline ? <AirlineLogo airline={airline} size="sm" /> : null}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {airline?.name ?? 'Aerolínea no disponible'}
          {airline?.icao_code ? <span className="ml-2 font-mono text-sm text-muted">{airline.icao_code}</span> : null}
        </p>
        <p className="text-sm text-muted">{formatRoles(membership.roles)}</p>
      </div>
      <Badge tone={statusTone[membership.status]}>{statusLabels[membership.status]}</Badge>
      {isPending ? (
        <Button variant="ghost" size="sm" loading={cancel.isPending} onClick={onCancel}>
          Cancelar solicitud
        </Button>
      ) : null}
    </li>
  );
}

function JoinableAirline({ airline }: { airline: Airline }) {
  const request = useRequestMembership();

  async function onRequest() {
    try {
      await request.mutateAsync(airline.id);
      toast.success(`Solicitud enviada a ${airline.name}`);
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <AirlineLogo airline={airline} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {airline.name}
          {airline.icao_code ? <span className="ml-2 font-mono text-sm text-muted">{airline.icao_code}</span> : null}
        </p>
        {airline.is_unofficial_brand ? <p className="text-sm text-muted">Operación virtual no oficial</p> : null}
      </div>
      <Button variant="secondary" size="sm" loading={request.isPending} onClick={onRequest}>
        Solicitar ingreso
      </Button>
    </li>
  );
}

function MyAirlinesPanel() {
  const memberships = useMyMemberships();
  const airlines = useAirlines();

  const byId = useMemo(() => new Map((airlines.data ?? []).map((a) => [a.id, a])), [airlines.data]);
  const joinable = useMemo(() => {
    const taken = new Set((memberships.data ?? []).map((m) => m.airline_id));
    return (airlines.data ?? []).filter((a) => a.is_active && !taken.has(a.id));
  }, [airlines.data, memberships.data]);

  const loading = memberships.isPending || airlines.isPending;
  const failed = memberships.isError || airlines.isError;
  const mine = memberships.data ?? [];

  return (
    <Panel title="Mis aerolíneas" description="Tus membresías y las aerolíneas a las que puedes unirte.">
      {failed ? (
        <Alert tone="danger">No se pudieron cargar tus aerolíneas. Recarga la página para intentarlo de nuevo.</Alert>
      ) : loading ? (
        <div className="space-y-3">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : (
        <>
          {mine.length > 0 ? (
            <ul className="divide-y divide-line">
              {mine.map((m) => (
                <MembershipRow key={m.id} membership={m} airline={byId.get(m.airline_id)} />
              ))}
            </ul>
          ) : (
            <p className="text-muted">
              Todavía no perteneces a ninguna aerolínea. Solicita ingreso a una de las aerolíneas activas; un
              administrador revisará tu solicitud.
            </p>
          )}

          <h3 className="mt-6 font-display text-base font-semibold">Aerolíneas disponibles</h3>
          {joinable.length > 0 ? (
            <ul className="divide-y divide-line">
              {joinable.map((a) => (
                <JoinableAirline key={a.id} airline={a} />
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted">
              No hay más aerolíneas activas por ahora. Las aerolíneas aparecen aquí cuando un superadministrador las
              configura y activa.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

// -----------------------------------------------------------------------------
// Aerolíneas registradas (superadministrador)
// -----------------------------------------------------------------------------
function OrganizationAirlinesPanel() {
  const airlines = useAirlines();
  return (
    <Panel
      title="Aerolíneas registradas"
      description="La configuración completa y la activación llegan con el módulo Airlines en la Fase 2."
    >
      {airlines.isPending ? (
        <Skeleton className="h-32" />
      ) : airlines.isError ? (
        <Alert tone="danger">No se pudo cargar la lista de aerolíneas.</Alert>
      ) : (
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="text-muted">
              <tr className="border-b border-line">
                <th scope="col" className="px-4 pb-2 font-medium">Aerolínea</th>
                <th scope="col" className="px-4 pb-2 font-medium">ICAO</th>
                <th scope="col" className="px-4 pb-2 font-medium">Operación</th>
                <th scope="col" className="px-4 pb-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {airlines.data.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2">
                      <AirlineLogo airline={a} size="sm" />
                      {a.name}
                      {a.is_unofficial_brand ? <Badge>No oficial</Badge> : null}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono">{a.icao_code ?? <span className="font-sans text-muted">Sin definir</span>}</td>
                  <td className="px-4 py-2.5">{operationTypeLabel(a.operation_type)}</td>
                  <td className="px-4 py-2.5">
                    {a.is_active ? <Badge tone="ok">Activa</Badge> : <Badge tone="warn">Inactiva</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// -----------------------------------------------------------------------------
// Estado de módulos e integraciones
// -----------------------------------------------------------------------------
const modules: { name: string; phase: number; done: boolean }[] = [
  { name: 'Cuentas, roles y aerolíneas', phase: 1, done: true },
  { name: 'Administración de pilotos, flota, aeropuertos y rutas', phase: 2, done: true },
  { name: 'Reservas e integración con SimBrief', phase: 3, done: true },
  { name: 'LAM ACARS Connector para MSFS 2024', phase: 4, done: false },
  { name: 'PIREP automático y evaluación', phase: 5, done: false },
  { name: 'Mapa en vivo y Operations Center', phase: 6, done: false },
];

function PlatformStatusPanel() {
  return (
    <Panel title="Estado de la plataforma" description="Qué funciona hoy y qué llega en cada fase.">
      <ol className="space-y-2.5">
        {modules.map((m) => (
          <li key={m.name} className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-sm tabular-nums text-muted">Fase {m.phase}</span>
            <span className="min-w-0 flex-1">{m.name}</span>
            {m.done ? <Badge tone="ok">Operativo</Badge> : <Badge>Pendiente</Badge>}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

// -----------------------------------------------------------------------------
export function DashboardPage() {
  const { selected, isOrgAdmin, ready } = useAirlineScope();
  const memberships = useMyMemberships();
  const profile = useProfile();
  const summary = useDashboardSummary(selected?.id ?? null);

  const canManage =
    isOrgAdmin ||
    (memberships.data ?? []).some(
      (m) =>
        m.status === 'active' &&
        m.roles.includes('airline_admin') &&
        (selected === null || m.airline_id === selected.id),
    );

  const metrics = buildMetrics(summary.data, canManage);

  return (
    <div className="space-y-6">
      <ScopeHeader />

      {profile.data?.account_status === 'suspended' ? (
        <Alert tone="danger">
          Tu cuenta está suspendida. No puedes operar vuelos ni ver datos de aerolíneas hasta que un superadministrador
          la reactive.
        </Alert>
      ) : null}

      {summary.isError ? (
        <Alert tone="danger">{describeError(summary.error)}</Alert>
      ) : (
        <MetricStrip metrics={metrics} loading={!ready || summary.isPending} />
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <MyAirlinesPanel />
          {isOrgAdmin ? <OrganizationAirlinesPanel /> : null}
        </div>
        <PlatformStatusPanel />
      </div>
    </div>
  );
}
