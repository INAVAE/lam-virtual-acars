import type { AirlineRole } from '@lam/shared-types';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/confirm-button';
import { AllPendingRequests, PilotDirectory } from '@/components/pilot-directory';
import { SelectAll } from '@/components/select-all';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyRow, Table, Td, Th } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { useAircraftTypes, useFleet, type AircraftType } from '@/hooks/use-fleet';
import { useAirlineSettings } from '@/hooks/use-airline-admin';
import { useAirlineRatings, useSaveRatings } from '@/hooks/use-ratings';
import { useAirlineMembers, usePilotDirectory, useRemoveMembership, useUpdateMembership, type AirlineMember } from '@/hooks/use-members';
import { useAirlines, useMyMemberships, type Airline } from '@/hooks/use-lam-data';
import { useAirlineScope } from '@/lib/airline-scope';
import { useAuth } from '@/lib/auth';
import { describeError } from '@/lib/errors';
import { countryName, formatLocalDate, formatPilotNumber, formatRoles, roleLabels, statusLabels } from '@/lib/format';
import { useAirlinePermissions, type AirlinePermissions } from '@/lib/permissions';

type View = 'members' | 'all' | 'pending' | 'inactive';

const statusTone = { active: 'ok', pending: 'warn', suspended: 'danger', rejected: 'neutral' } as const;

function RolesDialog({
  member,
  permissions,
  onClose,
}: {
  member: AirlineMember;
  permissions: AirlinePermissions;
  onClose: () => void;
}) {
  const [roles, setRoles] = useState<AirlineRole[]>(member.roles);
  const update = useUpdateMembership();
  const choices: AirlineRole[] = ['pilot', 'ops_chief', 'airline_admin'];

  function toggle(role: AirlineRole, checked: boolean) {
    setRoles((current) => (checked ? [...new Set([...current, role])] : current.filter((r) => r !== role)));
  }

  async function save() {
    try {
      await update.mutateAsync({ id: member.id, airlineId: member.airline_id, changes: { roles } });
      toast.success('Roles actualizados');
      onClose();
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Roles de ${member.profile?.display_name ?? 'piloto'}`}
      description="Los roles valen solo dentro de esta aerolínea."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={update.isPending} disabled={roles.length === 0} onClick={save}>
            Guardar roles
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {choices.map((role) => {
          const locked = role === 'airline_admin' && !permissions.isOrgAdmin;
          return (
            <Checkbox
              key={role}
              id={`role-${role}`}
              label={roleLabels[role]}
              hint={
                role === 'airline_admin'
                  ? locked
                    ? 'Solo un superadministrador nombra administradores.'
                    : 'Gestiona pilotos, flota, rutas y políticas.'
                  : role === 'ops_chief'
                    ? 'Supervisa vuelos y revisa PIREP.'
                    : 'Reserva y vuela rutas de la aerolínea.'
              }
              checked={roles.includes(role)}
              disabled={locked}
              onChange={(e) => toggle(role, e.target.checked)}
            />
          );
        })}
        {roles.length === 0 ? <p className="text-sm text-danger-ink">Elige al menos un rol.</p> : null}
      </div>
    </Dialog>
  );
}

function RatingsDialog({
  member,
  types,
  fleetTypeIds,
  current,
  canEdit,
  onClose,
}: {
  member: AirlineMember;
  types: AircraftType[];
  fleetTypeIds: Set<number>;
  current: number[];
  canEdit: boolean;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<number[]>(current);
  const save = useSaveRatings();
  const inFleet = types.filter((t) => fleetTypeIds.has(t.id));
  const others = types.filter((t) => !fleetTypeIds.has(t.id));
  const changed = selected.length !== current.length || selected.some((t) => !current.includes(t));

  function toggle(id: number, checked: boolean) {
    setSelected((s) => (checked ? [...new Set([...s, id])] : s.filter((t) => t !== id)));
  }

  async function submit() {
    try {
      await save.mutateAsync({ airlineId: member.airline_id, userId: member.user_id, typeIds: selected, previous: current });
      toast.success('Habilitaciones actualizadas');
      onClose();
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  function group(label: string, list: AircraftType[]) {
    if (list.length === 0) return null;
    return (
      <fieldset aria-label={label}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">{label}</p>
          <SelectAll all={list.map((t) => t.id)} selected={selected} onChange={setSelected} disabled={!canEdit} />
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          {list.map((t) => (
            <Checkbox
              key={t.id}
              id={`rating-${t.id}`}
              disabled={!canEdit}
              checked={selected.includes(t.id)}
              onChange={(e) => toggle(t.id, e.target.checked)}
              label={
                <>
                  <span className="font-mono">{t.icao_code}</span> <span className="text-muted">{t.model}</span>
                </>
              }
            />
          ))}
        </div>
      </fieldset>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={`Habilitaciones de ${member.profile?.display_name ?? 'piloto'}`}
      description="Tipos de aeronave que puede reservar en esta aerolínea cuando la política exige habilitación."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {canEdit ? 'Cancelar' : 'Cerrar'}
          </Button>
          {canEdit ? (
            <Button loading={save.isPending} disabled={!changed} onClick={submit}>
              Guardar habilitaciones
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-5">
        {!canEdit ? <Alert>Nadie puede otorgarse habilitaciones a sí mismo. Pide a otro miembro del staff que lo haga.</Alert> : null}
        {group('En la flota de la aerolínea', inFleet)}
        {group('Otros tipos del catálogo', others)}
      </div>
    </Dialog>
  );
}

function MemberActions({
  member,
  permissions,
  onEditRoles,
}: {
  member: AirlineMember;
  permissions: AirlinePermissions;
  onEditRoles: () => void;
}) {
  const { user } = useAuth();
  const update = useUpdateMembership();
  const remove = useRemoveMembership();
  const isSelf = member.user_id === user?.id;
  const isAdmin = member.roles.includes('airline_admin');
  // La base de datos impide que un administrador cambie su propia membresía o la de otro administrador.
  const locked = !permissions.canManage || (!permissions.isOrgAdmin && (isSelf || isAdmin));

  if (locked) return <span className="text-sm text-muted">{isSelf ? 'Tu membresía' : 'Sin acciones'}</span>;

  async function setStatus(status: 'active' | 'rejected' | 'suspended', message: string) {
    try {
      await update.mutateAsync({ id: member.id, airlineId: member.airline_id, changes: { status } });
      toast.success(message);
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  const name = member.profile?.display_name ?? 'este piloto';

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {member.status === 'pending' ? (
        <>
          <Button size="sm" loading={update.isPending} onClick={() => setStatus('active', `${name} ya es miembro`)}>
            Aprobar
          </Button>
          <Button size="sm" variant="secondary" disabled={update.isPending} onClick={() => setStatus('rejected', 'Solicitud rechazada')}>
            Rechazar
          </Button>
        </>
      ) : null}
      {member.status === 'active' ? (
        <>
          <Button size="sm" variant="secondary" onClick={onEditRoles}>
            Roles
          </Button>
          <ConfirmButton
            size="sm"
            variant="ghost"
            title={`Suspender a ${name}`}
            message="No podrá reservar ni volar con esta aerolínea hasta que lo reactives. Su historial se conserva."
            confirmLabel="Suspender"
            onConfirm={() => setStatus('suspended', 'Membresía suspendida')}
          >
            Suspender
          </ConfirmButton>
        </>
      ) : null}
      {member.status === 'suspended' || member.status === 'rejected' ? (
        <Button size="sm" variant="secondary" loading={update.isPending} onClick={() => setStatus('active', 'Membresía reactivada')}>
          Reactivar
        </Button>
      ) : null}
      {member.status !== 'active' ? (
        <ConfirmButton
          size="sm"
          variant="ghost"
          title={`Quitar a ${name}`}
          message="Se borra la membresía. La persona podrá volver a solicitar ingreso."
          confirmLabel="Quitar"
          onConfirm={async () => {
            try {
              await remove.mutateAsync({ id: member.id, airlineId: member.airline_id });
              toast.success('Membresía eliminada');
            } catch (error) {
              toast.error(describeError(error));
              throw error;
            }
          }}
        >
          Quitar
        </ConfirmButton>
      ) : null}
    </div>
  );
}

/** Staff de la aerolínea: miembros (con acciones), todas las aerolíneas, solicitudes y suspendidos. */
function PilotsView({ airline }: { airline: Airline }) {
  const permissions = useAirlinePermissions(airline.id);
  const members = useAirlineMembers(airline.id);
  const [view, setView] = useState<View>('members');
  const directory = usePilotDirectory(view === 'all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<AirlineMember | null>(null);
  const [rating, setRating] = useState<AirlineMember | null>(null);
  const { user } = useAuth();
  const ratings = useAirlineRatings(airline.id, permissions.canStaff);
  const types = useAircraftTypes();
  const fleet = useFleet(permissions.canStaff ? airline.id : null);
  const settings = useAirlineSettings(airline.id);
  // Sin habilitación exigida, la columna y el botón sobran; las guardadas se conservan.
  const ratingsRequired = settings.data?.require_type_rating ?? true;
  const showRatings = view === 'members' && ratingsRequired;

  const typeCode = useMemo(() => new Map((types.data ?? []).map((t) => [t.id, t.icao_code])), [types.data]);
  const fleetTypeIds = useMemo(() => new Set((fleet.data ?? []).map((a) => a.aircraft_type_id)), [fleet.data]);
  const ratingsByUser = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const r of ratings.data ?? []) map.set(r.user_id, [...(map.get(r.user_id) ?? []), r.aircraft_type_id]);
    return map;
  }, [ratings.data]);

  const groups = useMemo(() => {
    const all = members.data ?? [];
    return {
      pending: all.filter((m) => m.status === 'pending'),
      members: all.filter((m) => m.status === 'active'),
      inactive: all.filter((m) => m.status === 'suspended' || m.status === 'rejected'),
    };
  }, [members.data]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = view === 'all' ? [] : groups[view];
    if (!term) return list;
    return list.filter((m) => {
      const p = m.profile;
      return (
        p?.display_name.toLowerCase().includes(term) ||
        p?.email.toLowerCase().includes(term) ||
        (p ? formatPilotNumber(p.pilot_number).toLowerCase().includes(term) : false)
      );
    });
  }, [groups, view, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Tabs
          label="Pilotos"
          value={view}
          onChange={setView}
          items={[
            { value: 'members', label: 'Miembros', count: groups.members.length },
            { value: 'all', label: 'Todas las aerolíneas' },
            { value: 'pending', label: 'Solicitudes', count: groups.pending.length },
            { value: 'inactive', label: 'Suspendidos y rechazados', count: groups.inactive.length },
          ]}
        />
        {view === 'all' ? null : (
        <div className="w-full sm:w-72">
          <label htmlFor="pilot-search" className="sr-only">
            Buscar piloto
          </label>
          <Input id="pilot-search" placeholder="Buscar por nombre, correo o número" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        )}
      </div>

      {view === 'all' ? (
        <PilotDirectory rows={directory.data ?? []} loading={directory.isPending} error={directory.error} showAirline />
      ) : null}

      {view === 'members' && !ratingsRequired ? (
        <p className="text-sm text-muted">
          {airline.name} no exige habilitaciones de tipo: cada piloto vuela el tipo que prefiera. Las habilitaciones guardadas se
          conservan por si la política se vuelve a activar en Airlines → Políticas operacionales.
        </p>
      ) : null}
      {members.isError ? <Alert tone="danger">{describeError(members.error)}</Alert> : null}

      {view === 'all' ? null : members.isPending ? (
        <Skeleton className="h-48" />
      ) : (
        <Table minWidth="62rem">
          <thead>
            <tr>
              <Th>Piloto</Th>
              <Th>Correo</Th>
              <Th>País</Th>
              <Th>IVAO</Th>
              <Th>Roles</Th>
              {showRatings ? <Th>Habilitaciones</Th> : null}
              <Th>{view === 'pending' ? 'Solicitó' : 'Estado'}</Th>
              <Th className="text-right">Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={showRatings ? 8 : 7}>
                {view === 'pending'
                  ? 'No hay solicitudes pendientes. Los pilotos solicitan ingreso desde su dashboard.'
                  : search
                    ? 'Ningún piloto coincide con la búsqueda.'
                    : 'No hay pilotos en esta lista.'}
              </EmptyRow>
            ) : (
              rows.map((m) => (
                <tr key={m.id}>
                  <Td>
                    {m.profile ? (
                      <Link
                        to={`/pilots/${m.profile.pilot_number}`}
                        state={{ from: '/pilots' }}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {m.profile.display_name}
                      </Link>
                    ) : (
                      <p className="font-medium">Perfil no disponible</p>
                    )}
                    {m.profile ? <p className="font-mono text-xs text-muted">{formatPilotNumber(m.profile.pilot_number)}</p> : null}
                  </Td>
                  <Td className="break-all text-muted">{m.profile?.email}</Td>
                  <Td>{countryName(m.profile?.country_code ?? null)}</Td>
                  <Td className="font-mono text-sm">{m.profile?.ivao_vid ?? <span className="font-sans text-muted">—</span>}</Td>
                  <Td>{formatRoles(m.roles)}</Td>
                  {showRatings ? (
                    <Td className="max-w-48 font-mono text-xs">
                      {(ratingsByUser.get(m.user_id) ?? [])
                        .map((id) => typeCode.get(id))
                        .filter(Boolean)
                        .sort()
                        .join(' ') || <span className="font-sans text-muted">Ninguna</span>}
                    </Td>
                  ) : null}
                  <Td>
                    {view === 'pending' ? (
                      formatLocalDate(m.requested_at)
                    ) : (
                      <Badge tone={statusTone[m.status]}>{statusLabels[m.status]}</Badge>
                    )}
                  </Td>
                  <Td className="text-right">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {m.status === 'active' && ratingsRequired && types.data ? (
                        <Button size="sm" variant="secondary" onClick={() => setRating(m)}>
                          Habilitaciones
                        </Button>
                      ) : null}
                      <MemberActions member={m} permissions={permissions} onEditRoles={() => setEditing(m)} />
                    </div>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      )}

      {editing ? <RolesDialog member={editing} permissions={permissions} onClose={() => setEditing(null)} /> : null}
      {rating && types.data ? (
        <RatingsDialog
          member={rating}
          types={types.data}
          fleetTypeIds={fleetTypeIds}
          current={ratingsByUser.get(rating.user_id) ?? []}
          canEdit={rating.user_id !== user?.id || permissions.isOrgAdmin}
          onClose={() => setRating(null)}
        />
      ) : null}
    </div>
  );
}

/** Piloto de la aerolínea (sin rol de staff): sus compañeros y el directorio de LAM. */
function PeersView({ airline }: { airline: Airline }) {
  const [view, setView] = useState<'members' | 'all'>('members');
  const directory = usePilotDirectory();
  const rows = directory.data ?? [];
  const mine = rows.filter((p) => p.airline_id === airline.id);
  return (
    <div className="space-y-4">
      <Tabs
        label="Pilotos"
        value={view}
        onChange={setView}
        items={[
          { value: 'members', label: `Miembros de ${airline.icao_code ?? airline.name}`, count: mine.filter((p) => p.status === 'active').length },
          { value: 'all', label: 'Todas las aerolíneas', count: rows.filter((p) => p.status === 'active').length },
        ]}
      />
      <PilotDirectory
        key={view}
        rows={view === 'all' ? rows : mine}
        loading={directory.isPending}
        error={directory.error}
        showAirline={view === 'all'}
      />
    </div>
  );
}

/** Vista de LAM (todas las aerolíneas) del superadministrador: directorio y solicitudes de todas. */
function AllAirlinesView() {
  const [view, setView] = useState<'members' | 'pending'>('members');
  const directory = usePilotDirectory();
  const rows = directory.data ?? [];
  return (
    <div className="space-y-4">
      <Tabs
        label="Pilotos"
        value={view}
        onChange={setView}
        items={[
          { value: 'members', label: 'Miembros', count: rows.filter((p) => p.status === 'active').length },
          { value: 'pending', label: 'Solicitudes', count: rows.filter((p) => p.status === 'pending').length },
        ]}
      />
      {view === 'members' ? (
        <PilotDirectory rows={rows} loading={directory.isPending} error={directory.error} showAirline />
      ) : (
        <AllPendingRequests rows={rows} loading={directory.isPending} error={directory.error} />
      )}
    </div>
  );
}

const requestTone = { pending: 'warn', active: 'ok', suspended: 'danger', rejected: 'neutral' } as const;
const requestText: Record<keyof typeof requestTone, string> = {
  pending: 'Tu solicitud está en revisión. El administrador o el jefe de operaciones de la aerolínea la aprobará.',
  active: 'Ya eres miembro.',
  suspended: 'Tu membresía está suspendida. Habla con el administrador de la aerolínea.',
  rejected: 'Tu solicitud fue rechazada. Puedes hablar con el administrador o solicitar ingreso a otra aerolínea.',
};

/** Sin aerolínea activa: el estado de sus solicitudes. */
function MyRequestsView({ airlines }: { airlines: Airline[] }) {
  const memberships = useMyMemberships();
  const name = (id: string) => airlines.find((a) => a.id === id);
  const list = memberships.data ?? [];
  return (
    <div className="space-y-4">
      <Alert>
        La lista de pilotos de LAM se abre cuando una aerolínea aprueba tu solicitud. Mientras tanto, aquí ves en qué va cada una.
      </Alert>
      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
          <p className="font-display text-lg font-semibold">Aún no solicitas ingreso a una aerolínea</p>
          <p className="mx-auto mt-1 max-w-md text-muted">Elige una aerolínea y solicita ingreso desde tu Dashboard.</p>
          <Link to="/" className="mt-3 inline-block font-medium text-accent underline-offset-4 hover:underline">
            Ir al Dashboard
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {list.map((m) => {
            const a = name(m.airline_id);
            return (
              <li key={m.id} className="rounded-lg border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    {a?.name ?? 'Aerolínea'}
                    {a?.icao_code ? <span className="ml-2 font-mono text-sm text-muted">{a.icao_code}</span> : null}
                  </p>
                  <Badge tone={requestTone[m.status]}>{statusLabels[m.status]}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted">{`${requestText[m.status]} Solicitada el ${formatLocalDate(m.requested_at)}.`}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PilotsContent() {
  const { selected, ready, isOrgAdmin } = useAirlineScope();
  const memberships = useMyMemberships();
  const airlines = useAirlines();
  const permissions = useAirlinePermissions(selected?.id ?? null);
  if (!ready || memberships.isPending) return <Skeleton className="h-64" />;
  const isActivePilot = (memberships.data ?? []).some((m) => m.status === 'active');
  if (!isOrgAdmin && !isActivePilot) return <MyRequestsView airlines={airlines.data ?? []} />;
  if (!selected) return <AllAirlinesView />;
  return permissions.canStaff ? <PilotsView key={selected.id} airline={selected} /> : <PeersView key={selected.id} airline={selected} />;
}

export function PilotsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Pilots"
        description="Los pilotos de cada aerolínea de LAM y quién espera aprobación. El administrador y el jefe de operaciones aprueban solicitudes y administran roles y habilitaciones de tipo."
      />
      <PilotsContent />
    </div>
  );
}
