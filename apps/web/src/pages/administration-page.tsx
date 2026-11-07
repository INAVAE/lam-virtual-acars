import type { Json } from '@lam/shared-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/confirm-button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { Panel } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyRow, Table, Td, Th } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import {
  useAccountRequestAction,
  useAccountRequests,
  usePendingAccountRequests,
  usePlatformAccounts,
  type AccountRequest,
  type PlatformAccount,
  type PlatformAccountMembership,
} from '@/hooks/use-account-requests';
import { useAuditLog, useOrgAdmins, type AuditRow } from '@/hooks/use-audit';
import { useAirlines } from '@/hooks/use-lam-data';
import { useAirlineScope } from '@/lib/airline-scope';
import { useAuth } from '@/lib/auth';
import { describeError } from '@/lib/errors';
import { formatLocalDate, formatLocalDateTime, formatPilotNumber } from '@/lib/format';
import { getSupabase } from '@/lib/supabase';

const PAGE_SIZE = 50;

const entityLabels: Record<string, string> = {
  airlines: 'Aerolínea',
  airline_settings: 'Políticas',
  airline_memberships: 'Membresía',
  organization_members: 'Superadministrador',
  aircraft: 'Aeronave',
  aircraft_types: 'Tipo de aeronave',
  routes: 'Ruta',
  profiles: 'Acceso de cuenta',
};

const actionLabels: Record<string, string> = { insert: 'Alta', update: 'Cambio', delete: 'Baja' };
const actionTone = { insert: 'ok', update: 'info', delete: 'danger' } as const;

const IGNORED_KEYS = new Set(['updated_at', 'created_at', 'decided_at']);

function asRecord(value: Json | null): Record<string, Json | undefined> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function show(value: Json | undefined): string {
  if (value === null || value === undefined) return 'vacío';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Resumen legible del cambio: los campos que cambiaron, con su valor anterior y nuevo. */
function describeChange(row: AuditRow): string {
  const before = asRecord(row.old_data);
  const after = asRecord(row.new_data);
  if (row.action !== 'update') {
    const data = row.action === 'insert' ? after : before;
    return ['name', 'registration', 'flight_number', 'icao_code', 'status', 'roles']
      .filter((k) => k in data)
      .map((k) => `${k}: ${show(data[k])}`)
      .join(', ');
  }
  return Object.keys(after)
    .filter((k) => !IGNORED_KEYS.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => `${k}: ${show(before[k])} → ${show(after[k])}`)
    .join('; ');
}

function AuditLog() {
  const airlines = useAirlines();
  const [entityType, setEntityType] = useState('');
  const [airlineId, setAirlineId] = useState('');
  const [page, setPage] = useState(0);
  const log = useAuditLog({ entityType, airlineId, page, pageSize: PAGE_SIZE });
  const airlineName = new Map((airlines.data ?? []).map((a) => [a.id, a.icao_code ?? a.name]));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <div>
          <label htmlFor="audit-entity" className="mb-1 block text-sm text-muted">
            Tipo de registro
          </label>
          <Select
            id="audit-entity"
            value={entityType}
            onChange={(e) => {
              setEntityType(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Todos</option>
            {Object.entries(entityLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="audit-airline" className="mb-1 block text-sm text-muted">
            Aerolínea
          </label>
          <Select
            id="audit-airline"
            value={airlineId}
            onChange={(e) => {
              setAirlineId(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Todas</option>
            {(airlines.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {log.isError ? <Alert tone="danger">{describeError(log.error)}</Alert> : null}
      {log.isPending ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <Table minWidth="60rem">
            <thead>
              <tr>
                <Th className="w-44">Fecha</Th>
                <Th>Quién</Th>
                <Th>Registro</Th>
                <Th>Aerolínea</Th>
                <Th>Detalle</Th>
              </tr>
            </thead>
            <tbody>
              {log.data?.rows.length === 0 ? (
                <EmptyRow colSpan={5}>No hay cambios registrados con estos filtros.</EmptyRow>
              ) : (
                log.data?.rows.map((row) => {
                  const actor = row.actor_id ? log.data?.actors.get(row.actor_id) : undefined;
                  const action = row.action as keyof typeof actionTone;
                  return (
                    <tr key={row.id}>
                      <Td className="whitespace-nowrap">{formatLocalDateTime(row.occurred_at)}</Td>
                      <Td>
                        {actor ? (
                          <>
                            <p>{actor.display_name}</p>
                            <p className="font-mono text-xs text-muted">{formatPilotNumber(actor.pilot_number)}</p>
                          </>
                        ) : (
                          <span className="text-muted">{row.actor_id ? 'Cuenta eliminada' : 'Sistema'}</span>
                        )}
                      </Td>
                      <Td>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={actionTone[action] ?? 'neutral'}>{actionLabels[row.action] ?? row.action}</Badge>
                          {entityLabels[row.entity_type] ?? row.entity_type}
                        </span>
                        <span className="font-mono text-xs text-muted">{row.entity_id}</span>
                      </Td>
                      <Td className="font-mono">{row.airline_id ? (airlineName.get(row.airline_id) ?? '—') : '—'}</Td>
                      <Td className="max-w-md break-words text-xs text-muted">{describeChange(row) || 'Sin cambios visibles'}</Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={log.data?.total ?? null} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}

function SuperAdmins() {
  const admins = useOrgAdmins();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [pilotNumber, setPilotNumber] = useState('');

  const add = useMutation({
    mutationFn: async (raw: string) => {
      const number = Number.parseInt(raw.replace(/^LAM/i, ''), 10);
      if (!Number.isFinite(number)) throw new Error('Escribe un número de piloto, por ejemplo LAM1002.');
      const supabase = getSupabase();
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('id, display_name')
        .eq('pilot_number', number)
        .maybeSingle();
      if (error) throw error;
      if (!profile) throw new Error(`No existe el piloto ${formatPilotNumber(number)}.`);
      const { data: org, error: orgError } = await supabase.from('organizations').select('id').eq('slug', 'lam').single();
      if (orgError) throw orgError;
      const { error: insertError } = await supabase
        .from('organization_members')
        .insert({ organization_id: org.id, user_id: profile.id, role: 'superadmin' });
      if (insertError) throw insertError;
      return profile.display_name;
    },
    onSuccess: (name) => {
      toast.success(`${name} ahora es superadministrador`);
      setPilotNumber('');
      void queryClient.invalidateQueries({ queryKey: ['org-admins'] });
    },
    onError: (error) => toast.error(describeError(error)),
  });

  const remove = useMutation({
    mutationFn: async ({ organizationId, userId }: { organizationId: string; userId: string }) => {
      const { error } = await getSupabase()
        .from('organization_members')
        .delete()
        .eq('organization_id', organizationId)
        .eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['org-admins'] }),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Panel title="Superadministradores" description="Tienen acceso a todas las aerolíneas y a esta sección.">
        {admins.isPending ? (
          <Skeleton className="h-32" />
        ) : admins.isError ? (
          <Alert tone="danger">{describeError(admins.error)}</Alert>
        ) : (
          <ul className="divide-y divide-line">
            {admins.data.map((a) => {
              const isSelf = a.user_id === user?.id;
              return (
                <li key={a.user_id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {a.profile?.display_name}
                      {isSelf ? <span className="ml-2 text-sm text-muted">(tú)</span> : null}
                    </p>
                    <p className="text-sm text-muted">
                      <span className="font-mono">{a.profile ? formatPilotNumber(a.profile.pilot_number) : ''}</span> · desde{' '}
                      {formatLocalDate(a.created_at)}
                    </p>
                  </div>
                  {!isSelf ? (
                    <ConfirmButton
                      size="sm"
                      variant="ghost"
                      title={`Quitar a ${a.profile?.display_name ?? 'esta persona'}`}
                      message="Dejará de tener acceso global. Conserva sus membresías en aerolíneas."
                      confirmLabel="Quitar acceso"
                      onConfirm={async () => {
                        try {
                          await remove.mutateAsync({ organizationId: a.organization_id, userId: a.user_id });
                          toast.success('Acceso de superadministrador retirado');
                        } catch (error) {
                          toast.error(describeError(error));
                          throw error;
                        }
                      }}
                    >
                      Quitar acceso
                    </ConfirmButton>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <Panel title="Agregar superadministrador">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate(pilotNumber);
          }}
          className="space-y-3"
        >
          <Field id="sa-number" label="Número de piloto" hint="La persona debe tener cuenta en LAM.">
            <Input
              id="sa-number"
              className="font-mono uppercase"
              placeholder="LAM1002"
              value={pilotNumber}
              onChange={(e) => setPilotNumber(e.target.value)}
              aria-describedby="sa-number-hint"
            />
          </Field>
          <Button type="submit" loading={add.isPending} disabled={!pilotNumber.trim()}>
            Dar acceso
          </Button>
        </form>
      </Panel>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Solicitudes de cuenta de piloto
// -----------------------------------------------------------------------------
const requestStatus = {
  pending: { label: 'Pendiente', tone: 'warn' },
  approved: { label: 'Aprobada', tone: 'ok' },
  rejected: { label: 'Rechazada', tone: 'neutral' },
} as const;

function RequestCard({ request }: { request: AccountRequest }) {
  const act = useAccountRequestAction();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const status = requestStatus[request.status];
  const accepted = Boolean(request.user_id);

  async function run(body: Parameters<typeof act.mutateAsync>[0], ok: string) {
    try {
      await act.mutateAsync(body);
      toast.success(ok);
      setRejecting(false);
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  return (
    <article className="rounded-md border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={status.tone}>{accepted ? 'Cuenta creada' : status.label}</Badge>
        <span className="font-medium text-ink">{request.display_name}</span>
        <span className="font-mono text-muted">{request.email}</span>
        <span className="ml-auto text-xs text-muted">{formatLocalDateTime(request.created_at)}</span>
      </div>
      <p className="mt-1 text-sm text-muted">
        {request.airline ? `Quiere unirse a ${request.airline.name}` : 'Sin aerolínea indicada'}
        {request.ivao_vid ? ` · VID IVAO ${request.ivao_vid}` : ''}
      </p>
      {request.message ? <p className="mt-1.5 whitespace-pre-line text-[15px]">{request.message}</p> : null}
      {request.status === 'approved' && !accepted ? (
        <p className="mt-1.5 text-sm text-muted">
          {request.invited_at ? `Invitación enviada ${formatLocalDateTime(request.invited_at)}; falta que la acepte (vence en 24 h).` : 'Aprobada, sin invitación enviada.'}
        </p>
      ) : null}
      {request.last_error ? <Alert tone="danger">{`El correo no salió: ${request.last_error}`}</Alert> : null}
      {request.review_note ? <p className="mt-1.5 text-sm text-muted">Nota: {request.review_note}</p> : null}

      {request.status === 'pending' ? (
        rejecting ? (
          <div className="mt-3 space-y-2">
            <label htmlFor={`rej-${request.id}`} className="text-sm font-medium">
              Motivo (opcional, solo para el staff)
            </label>
            <Textarea id={`rej-${request.id}`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="danger" loading={act.isPending} onClick={() => run({ action: 'reject', request_id: request.id, note: note.trim() || null }, 'Solicitud rechazada')}>
                Rechazar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" loading={act.isPending} onClick={() => run({ action: 'approve', request_id: request.id }, `Aprobada: invitación enviada a ${request.email}`)}>
              Aprobar y enviar invitación
            </Button>
            <Button size="sm" variant="secondary" disabled={act.isPending} onClick={() => setRejecting(true)}>
              Rechazar
            </Button>
          </div>
        )
      ) : null}
      {request.status === 'approved' && !accepted ? (
        <div className="mt-3">
          <Button size="sm" variant="secondary" loading={act.isPending} onClick={() => run({ action: 'resend', request_id: request.id }, `Invitación reenviada a ${request.email}`)}>
            Reenviar invitación
          </Button>
        </div>
      ) : null}
    </article>
  );
}

function InvitePilot() {
  const act = useAccountRequestAction();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await act.mutateAsync({ action: 'invite', email: email.trim(), display_name: name.trim() });
      toast.success(`Invitación enviada a ${email.trim()}`);
      setEmail('');
      setName('');
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  return (
    <Panel title="Invitar a un piloto" description="Para alguien que no llenó la solicitud: le llega el mismo correo de invitación.">
      <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={submit}>
        <Field id="inv-name" label="Nombre">
          <Input id="inv-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="inv-email" label="Correo">
          <Input id="inv-email" type="email" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Button type="submit" loading={act.isPending} disabled={name.trim().length < 2 || !email.includes('@')}>
          Invitar
        </Button>
      </form>
    </Panel>
  );
}

function AccountRequests() {
  const requests = useAccountRequests();
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | ''>('pending');
  const all = requests.data ?? [];
  const rows = filter ? all.filter((r) => r.status === filter) : all;
  const count = (s: AccountRequest['status']) => all.filter((r) => r.status === s).length;

  return (
    <div className="space-y-5">
      <Panel
        title="Solicitudes de cuenta de piloto"
        description="Nadie entra a LAM sin aprobación. Al aprobar, la persona recibe un correo para elegir su contraseña; después pide unirse a una aerolínea."
        actions={
          <Select aria-label="Estado" className="h-9 w-auto" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="pending">Pendientes ({count('pending')})</option>
            <option value="approved">Aprobadas ({count('approved')})</option>
            <option value="rejected">Rechazadas ({count('rejected')})</option>
            <option value="">Todas ({all.length})</option>
          </Select>
        }
      >
        {requests.isLoading ? <Skeleton className="h-24" /> : null}
        {requests.error ? <Alert tone="danger">{describeError(requests.error)}</Alert> : null}
        {requests.data && rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
            {filter === 'pending' ? 'No hay solicitudes por revisar.' : 'No hay solicitudes en ese estado.'}
          </p>
        ) : null}
        <div className="space-y-2">
          {rows.map((r) => (
            <RequestCard key={r.id} request={r} />
          ))}
        </div>
      </Panel>
      <InvitePilot />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Cuentas de la plataforma: todas, con sus aerolíneas, y revocar el acceso
// -----------------------------------------------------------------------------
const membershipLabel: Record<PlatformAccountMembership['status'], { label: string; tone: 'ok' | 'warn' | 'neutral' | 'danger' }> = {
  active: { label: 'Activo', tone: 'ok' },
  pending: { label: 'Solicitud pendiente', tone: 'warn' },
  suspended: { label: 'Suspendido', tone: 'danger' },
  rejected: { label: 'Rechazado', tone: 'neutral' },
};

type AccountFilter = '' | 'no-airline' | 'pending' | 'revoked';

function hasActiveAirline(a: PlatformAccount) {
  return a.memberships.some((m) => m.status === 'active');
}

function AccountAccess({ account }: { account: PlatformAccount }) {
  const act = useAccountRequestAction();
  const [note, setNote] = useState('');
  if (account.account_status === 'suspended') {
    return (
      <ConfirmButton
        size="sm"
        variant="secondary"
        title={`Restaurar el acceso de ${account.display_name}`}
        message="Podrá volver a iniciar sesión y operar en las aerolíneas donde es miembro activo. Las reservas canceladas no se recuperan."
        confirmLabel="Restaurar acceso"
        onConfirm={async () => {
          try {
            await act.mutateAsync({ action: 'restore', user_id: account.user_id });
            toast.success(`${account.display_name} puede volver a entrar`);
          } catch (error) {
            toast.error(describeError(error));
            throw error;
          }
        }}
      >
        Restaurar acceso
      </ConfirmButton>
    );
  }
  return (
    <ConfirmButton
      size="sm"
      variant="ghost"
      title={`Revocar el acceso de ${account.display_name}`}
      message={
        <div className="space-y-3">
          <p>
            Ya no podrá iniciar sesión ni usar el conector, y se cancelan sus reservas sin iniciar. Su historial (PIREP y
            membresías) se conserva y puedes restaurar el acceso cuando quieras.
          </p>
          <div>
            <label htmlFor={`revoke-${account.user_id}`} className="mb-1 block text-sm font-medium">
              Motivo (opcional, solo para el staff)
            </label>
            <Textarea id={`revoke-${account.user_id}`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
      }
      confirmLabel="Revocar acceso"
      onConfirm={async () => {
        try {
          await act.mutateAsync({ action: 'revoke', user_id: account.user_id, note: note.trim() || null });
          toast.success(`Acceso de ${account.display_name} revocado`);
          setNote('');
        } catch (error) {
          toast.error(describeError(error));
          throw error;
        }
      }}
    >
      Revocar acceso
    </ConfirmButton>
  );
}

function PlatformAccounts() {
  const accounts = usePlatformAccounts();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<AccountFilter>('');
  const all = accounts.data ?? [];
  const counts = {
    noAirline: all.filter((a) => a.account_status === 'active' && !hasActiveAirline(a)).length,
    pending: all.filter((a) => a.memberships.some((m) => m.status === 'pending')).length,
    revoked: all.filter((a) => a.account_status === 'suspended').length,
  };
  const q = query.trim().toLowerCase().replace(/^lam/, '');
  const rows = all.filter((a) => {
    if (filter === 'no-airline' && (a.account_status !== 'active' || hasActiveAirline(a))) return false;
    if (filter === 'pending' && !a.memberships.some((m) => m.status === 'pending')) return false;
    if (filter === 'revoked' && a.account_status !== 'suspended') return false;
    if (!q) return true;
    return a.display_name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q) || String(a.pilot_number).includes(q);
  });

  return (
    <Panel
      title="Cuentas de la plataforma"
      description="Todas las personas que pueden entrar a LAM, también las que todavía no pertenecen a ninguna aerolínea."
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Input aria-label="Buscar cuenta" placeholder="Buscar por nombre, correo o LAM…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select aria-label="Mostrar" className="w-auto" value={filter} onChange={(e) => setFilter(e.target.value as AccountFilter)}>
          <option value="">Todas ({all.length})</option>
          <option value="no-airline">Sin aerolínea ({counts.noAirline})</option>
          <option value="pending">Con solicitud de ingreso pendiente ({counts.pending})</option>
          <option value="revoked">Con acceso revocado ({counts.revoked})</option>
        </Select>
      </div>
      {accounts.isError ? <Alert tone="danger">{describeError(accounts.error)}</Alert> : null}
      {accounts.isPending ? (
        <Skeleton className="h-64" />
      ) : (
        <Table minWidth="64rem">
          <thead>
            <tr>
              <Th>Piloto</Th>
              <Th>Aerolíneas</Th>
              <Th>Alta</Th>
              <Th>Último acceso</Th>
              <Th className="text-right">PIREP</Th>
              <Th>Acceso</Th>
              <Th className="sr-only">Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={7}>No hay cuentas con estos filtros.</EmptyRow>
            ) : (
              rows.map((a) => {
                const isSelf = a.user_id === user?.id;
                return (
                  <tr key={a.user_id}>
                    <Td>
                      <p className="font-medium">
                        {a.display_name}
                        {isSelf ? <span className="ml-2 text-sm font-normal text-muted">(tú)</span> : null}
                      </p>
                      <p className="text-xs text-muted">
                        <span className="font-mono">{formatPilotNumber(a.pilot_number)}</span> · {a.email}
                      </p>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1.5">
                        {a.is_superadmin ? <Badge tone="info">Superadministrador</Badge> : null}
                        {a.memberships.length === 0 ? (
                          <span className="text-sm text-muted">No ha solicitado ninguna</span>
                        ) : (
                          a.memberships.map((m) => (
                            <Badge key={m.airline_id} tone={membershipLabel[m.status].tone}>
                              {m.icao_code ?? m.name} · {membershipLabel[m.status].label}
                            </Badge>
                          ))
                        )}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap">{formatLocalDate(a.created_at)}</Td>
                    <Td className="whitespace-nowrap">{a.last_sign_in_at ? formatLocalDateTime(a.last_sign_in_at) : <span className="text-muted">Nunca</span>}</Td>
                    <Td className="text-right tabular-nums">{a.pirep_count}</Td>
                    <Td>
                      {a.account_status === 'active' ? (
                        <Badge tone="ok">Activo</Badge>
                      ) : (
                        <div>
                          <Badge tone="danger">Revocado</Badge>
                          <p className="mt-1 text-xs text-muted">
                            {a.suspended_at ? formatLocalDate(a.suspended_at) : ''}
                            {a.suspended_by_name ? ` · ${a.suspended_by_name}` : ''}
                          </p>
                          {a.suspension_note ? <p className="max-w-xs text-xs text-muted">{a.suspension_note}</p> : null}
                        </div>
                      )}
                    </Td>
                    <Td className="text-right">
                      {isSelf || (a.is_superadmin && a.account_status === 'active') ? null : <AccountAccess account={a} />}
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}

export function AdministrationPage() {
  const { isOrgAdmin, ready } = useAirlineScope();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  type AdminTab = 'requests' | 'accounts' | 'audit' | 'admins';
  const tab: AdminTab = requested === 'accounts' || requested === 'audit' || requested === 'admins' ? requested : 'requests';
  const setTab = (t: AdminTab) => setParams(t === 'requests' ? {} : { tab: t }, { replace: true });
  const pending = usePendingAccountRequests().data ?? 0;

  if (!ready) return <Skeleton className="h-64" />;
  if (!isOrgAdmin) return <Alert>Esta sección es solo para superadministradores de LAM.</Alert>;

  return (
    <div className="space-y-6">
      <PageHeader title="Administration" description="Solicitudes de cuenta de piloto, todas las cuentas y su acceso, bitácora de cambios administrativos y superadministradores." />
      <Tabs
        label="Administración"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'requests', label: 'Solicitudes de cuenta', count: pending },
          { value: 'accounts', label: 'Cuentas' },
          { value: 'audit', label: 'Bitácora' },
          { value: 'admins', label: 'Superadministradores' },
        ]}
      />
      {tab === 'requests' ? <AccountRequests /> : tab === 'accounts' ? <PlatformAccounts /> : tab === 'audit' ? <AuditLog /> : <SuperAdmins />}
    </div>
  );
}
