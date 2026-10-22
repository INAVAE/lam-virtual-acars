import type { Json } from '@lam/shared-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
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

export function AdministrationPage() {
  const { isOrgAdmin, ready } = useAirlineScope();
  const [tab, setTab] = useState<'audit' | 'admins'>('audit');

  if (!ready) return <Skeleton className="h-64" />;
  if (!isOrgAdmin) return <Alert>Esta sección es solo para superadministradores de LAM.</Alert>;

  return (
    <div className="space-y-6">
      <PageHeader title="Administration" description="Bitácora de cambios administrativos y acceso global a la plataforma." />
      <Tabs
        label="Administración"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'audit', label: 'Bitácora' },
          { value: 'admins', label: 'Superadministradores' },
        ]}
      />
      {tab === 'audit' ? <AuditLog /> : <SuperAdmins />}
    </div>
  );
}
