import type { AirlineRole } from '@lam/shared-types';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/confirm-button';
import { ScopeRequired } from '@/components/scope-required';
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
import type { Airline } from '@/hooks/use-lam-data';
import { useAirlineRatings, useSaveRatings } from '@/hooks/use-ratings';
import { useAirlineMembers, useRemoveMembership, useUpdateMembership, type AirlineMember } from '@/hooks/use-members';
import { useAuth } from '@/lib/auth';
import { describeError } from '@/lib/errors';
import { countryName, formatLocalDate, formatPilotNumber, formatRoles, roleLabels, statusLabels } from '@/lib/format';
import { useAirlinePermissions, type AirlinePermissions } from '@/lib/permissions';

type View = 'pending' | 'members' | 'inactive';

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
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{label}</legend>
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

function PilotsView({ airline }: { airline: Airline }) {
  const members = useAirlineMembers(airline.id);
  const permissions = useAirlinePermissions(airline.id);
  const [view, setView] = useState<View>('pending');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<AirlineMember | null>(null);
  const [rating, setRating] = useState<AirlineMember | null>(null);
  const { user } = useAuth();
  const ratings = useAirlineRatings(airline.id, permissions.canStaff);
  const types = useAircraftTypes();
  const fleet = useFleet(permissions.canStaff ? airline.id : null);

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
    if (!term) return groups[view];
    return groups[view].filter((m) => {
      const p = m.profile;
      return (
        p?.display_name.toLowerCase().includes(term) ||
        p?.email.toLowerCase().includes(term) ||
        (p ? formatPilotNumber(p.pilot_number).toLowerCase().includes(term) : false)
      );
    });
  }, [groups, view, search]);

  if (!permissions.canStaff) {
    return <Alert>Solo el administrador y el jefe de operaciones de {airline.name} pueden ver la lista de pilotos.</Alert>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Tabs
          label="Pilotos"
          value={view}
          onChange={setView}
          items={[
            { value: 'pending', label: 'Solicitudes', count: groups.pending.length },
            { value: 'members', label: 'Miembros', count: groups.members.length },
            { value: 'inactive', label: 'Suspendidos y rechazados', count: groups.inactive.length },
          ]}
        />
        <div className="w-full sm:w-72">
          <label htmlFor="pilot-search" className="sr-only">
            Buscar piloto
          </label>
          <Input id="pilot-search" placeholder="Buscar por nombre, correo o número" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {members.isError ? <Alert tone="danger">{describeError(members.error)}</Alert> : null}

      {members.isPending ? (
        <Skeleton className="h-48" />
      ) : (
        <Table minWidth="56rem">
          <thead>
            <tr>
              <Th>Piloto</Th>
              <Th>Correo</Th>
              <Th>País</Th>
              <Th>Roles</Th>
              {view === 'members' ? <Th>Habilitaciones</Th> : null}
              <Th>{view === 'pending' ? 'Solicitó' : 'Estado'}</Th>
              <Th className="text-right">Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={view === 'members' ? 7 : 6}>
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
                    <p className="font-medium">{m.profile?.display_name ?? 'Perfil no disponible'}</p>
                    {m.profile ? <p className="font-mono text-xs text-muted">{formatPilotNumber(m.profile.pilot_number)}</p> : null}
                  </Td>
                  <Td className="break-all text-muted">{m.profile?.email}</Td>
                  <Td>{countryName(m.profile?.country_code ?? null)}</Td>
                  <Td>{formatRoles(m.roles)}</Td>
                  {view === 'members' ? (
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
                      {m.status === 'active' && types.data ? (
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

export function PilotsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Pilots"
        description="Aprueba solicitudes de ingreso y administra roles y habilitaciones de tipo de los pilotos de la aerolínea seleccionada."
      />
      <ScopeRequired>{(airline) => <PilotsView airline={airline} />}</ScopeRequired>
    </div>
  );
}
