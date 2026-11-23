import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Avatar } from '@/components/avatar';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyRow, Table, Td, Th } from '@/components/ui/table';
import { useUpdateMembership, type DirectoryPilot } from '@/hooks/use-members';
import { describeError } from '@/lib/errors';
import { countryName, formatLocalDate, formatPilotNumber, formatRoles } from '@/lib/format';
import { formatHours } from '@/lib/pirep';

function matches(p: DirectoryPilot, term: string): boolean {
  if (!term) return true;
  return [p.display_name, formatPilotNumber(p.pilot_number), p.ivao_vid ?? '', p.airline_name, p.airline_icao ?? '', countryName(p.country_code)]
    .join(' ')
    .toLowerCase()
    .includes(term);
}

/** Aerolínea con su color. */
export function AirlineTag({ name, icao, color }: { name: string; icao: string | null; color: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: color ?? 'var(--accent)' }} aria-hidden />
      <span className="font-mono text-xs font-semibold">{icao ?? '—'}</span>
      <span className="text-sm text-muted">{name}</span>
    </span>
  );
}

/**
 * Directorio de pilotos de LAM: los activos y quienes esperan aprobación, con
 * su aerolínea, país, VID de IVAO y vuelos aceptados. Lo ven todos los pilotos
 * activos; las acciones de aprobación quedan en la lista de cada aerolínea.
 */
export function PilotDirectory({
  rows,
  loading,
  error,
  showAirline,
  emptyText = 'No hay pilotos en esta lista.',
}: {
  rows: DirectoryPilot[];
  loading: boolean;
  error: unknown;
  /** Con todas las aerolíneas se muestra la columna Aerolínea y el resumen por aerolínea. */
  showAirline: boolean;
  emptyText?: string;
}) {
  const [search, setSearch] = useState('');
  const [showPending, setShowPending] = useState(true);
  const term = search.trim().toLowerCase();
  const shown = useMemo(() => rows.filter((p) => (showPending || p.status === 'active') && matches(p, term)), [rows, showPending, term]);
  const pending = rows.filter((p) => p.status === 'pending').length;
  const byAirline = useMemo(() => {
    const map = new Map<string, { name: string; icao: string | null; color: string | null; active: number; pending: number }>();
    for (const p of rows) {
      const a = map.get(p.airline_id) ?? { name: p.airline_name, icao: p.airline_icao, color: p.airline_color, active: 0, pending: 0 };
      if (p.status === 'active') a.active += 1;
      else a.pending += 1;
      map.set(p.airline_id, a);
    }
    return [...map.values()].sort((a, b) => b.active - a.active || a.name.localeCompare(b.name));
  }, [rows]);

  if (error) return <Alert tone="danger">{describeError(error)}</Alert>;
  if (loading) return <Skeleton className="h-48" />;

  return (
    <div className="space-y-3">
      {showAirline && byAirline.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Pilotos por aerolínea">
          {byAirline.map((a) => (
            <li key={`${a.icao}-${a.name}`} className="rounded-md border border-line bg-surface px-2.5 py-1.5">
              <AirlineTag name={a.name} icao={a.icao} color={a.color} />
              <span className="ml-2 text-sm tabular-nums">{a.pending > 0 ? `${a.active} activos · ${a.pending} por aprobar` : `${a.active} activos`}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Checkbox
          id="directory-pending"
          checked={showPending}
          onChange={(e) => setShowPending(e.target.checked)}
          label={`Incluir solicitudes por aprobar (${pending})`}
        />
        <div className="w-full sm:w-72">
          <label htmlFor="directory-search" className="sr-only">
            Buscar piloto
          </label>
          <Input
            id="directory-search"
            type="search"
            placeholder="Buscar por nombre, número, IVAO o aerolínea"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <Table minWidth={showAirline ? '58rem' : '48rem'}>
        <thead>
          <tr>
            <Th>Piloto</Th>
            {showAirline ? <Th>Aerolínea</Th> : null}
            <Th>País</Th>
            <Th>IVAO</Th>
            <Th>Roles</Th>
            <Th className="text-right">Vuelos</Th>
            <Th>Estado</Th>
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 ? (
            <EmptyRow colSpan={showAirline ? 7 : 6}>{term ? 'Ningún piloto coincide con la búsqueda.' : emptyText}</EmptyRow>
          ) : (
            shown.map((p) => (
              <tr key={p.membership_id}>
                <Td>
                  <Link to={`/pilots/${p.pilot_number}`} state={{ from: '/pilots' }} className="flex items-center gap-2.5">
                    <Avatar name={p.display_name} url={p.avatar_url} size="sm" />
                    <span>
                      <span className="block font-medium underline-offset-4 hover:underline">{p.display_name}</span>
                      <span className="block font-mono text-xs text-muted">{formatPilotNumber(p.pilot_number)}</span>
                    </span>
                  </Link>
                </Td>
                {showAirline ? (
                  <Td>
                    <AirlineTag name={p.airline_name} icao={p.airline_icao} color={p.airline_color} />
                  </Td>
                ) : null}
                <Td>{countryName(p.country_code)}</Td>
                <Td>
                  {p.ivao_vid ? (
                    <a
                      href={`https://www.ivao.aero/Member.aspx?Id=${p.ivao_vid}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-sm underline-offset-4 hover:underline"
                    >
                      {p.ivao_vid}
                    </a>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </Td>
                <Td>{p.status === 'active' ? formatRoles(p.roles) : <span className="text-muted">—</span>}</Td>
                <Td className="text-right tabular-nums">
                  {p.flights}
                  {p.block_minutes > 0 ? <span className="block text-xs text-muted">{formatHours(p.block_minutes)}</span> : null}
                </Td>
                <Td>
                  {p.status === 'active' ? (
                    <Badge tone="ok">Activo</Badge>
                  ) : (
                    <span>
                      <Badge tone="warn">Por aprobar</Badge>
                      <span className="mt-0.5 block text-xs text-muted">{`Solicitó el ${formatLocalDate(p.requested_at)}`}</span>
                    </span>
                  )}
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
    </div>
  );
}

/** Solicitudes pendientes de todas las aerolíneas (vista de LAM del superadministrador). */
export function AllPendingRequests({ rows, loading, error }: { rows: DirectoryPilot[]; loading: boolean; error: unknown }) {
  const update = useUpdateMembership();
  const [busy, setBusy] = useState<string | null>(null);
  const pending = rows.filter((p) => p.status === 'pending');

  async function decide(p: DirectoryPilot, status: 'active' | 'rejected') {
    setBusy(p.membership_id);
    try {
      await update.mutateAsync({ id: p.membership_id, airlineId: p.airline_id, changes: { status } });
      toast.success(status === 'active' ? `${p.display_name} ya es miembro de ${p.airline_name}` : 'Solicitud rechazada');
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  if (error) return <Alert tone="danger">{describeError(error)}</Alert>;
  if (loading) return <Skeleton className="h-48" />;
  return (
    <Table minWidth="48rem">
      <thead>
        <tr>
          <Th>Piloto</Th>
          <Th>Aerolínea</Th>
          <Th>País</Th>
          <Th>Solicitó</Th>
          <Th className="text-right">Acciones</Th>
        </tr>
      </thead>
      <tbody>
        {pending.length === 0 ? (
          <EmptyRow colSpan={5}>No hay solicitudes pendientes en ninguna aerolínea.</EmptyRow>
        ) : (
          pending.map((p) => (
            <tr key={p.membership_id}>
              <Td>
                <Link to={`/pilots/${p.pilot_number}`} state={{ from: '/pilots' }} className="font-medium underline-offset-4 hover:underline">
                  {p.display_name}
                </Link>
                <p className="font-mono text-xs text-muted">{formatPilotNumber(p.pilot_number)}</p>
              </Td>
              <Td>
                <AirlineTag name={p.airline_name} icao={p.airline_icao} color={p.airline_color} />
              </Td>
              <Td>{countryName(p.country_code)}</Td>
              <Td>{formatLocalDate(p.requested_at)}</Td>
              <Td className="text-right">
                <div className="flex justify-end gap-1.5">
                  <Button size="sm" loading={busy === p.membership_id && update.isPending} onClick={() => decide(p, 'active')}>
                    Aprobar
                  </Button>
                  <Button size="sm" variant="secondary" disabled={busy === p.membership_id} onClick={() => decide(p, 'rejected')}>
                    Rechazar
                  </Button>
                </div>
              </Td>
            </tr>
          ))
        )}
      </tbody>
    </Table>
  );
}
