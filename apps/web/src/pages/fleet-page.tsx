import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/confirm-button';
import { AircraftDialog, AircraftTypeDialog } from '@/components/fleet-dialogs';
import { ScopeRequired } from '@/components/scope-required';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyRow, Table, Td, Th } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { useAirlineSettings } from '@/hooks/use-airline-admin';
import {
  useAircraftTypes,
  useDeleteAircraft,
  useFleet,
  type AircraftType,
  type FleetAircraft,
} from '@/hooks/use-fleet';
import type { Airline } from '@/hooks/use-lam-data';
import { aircraftSvg, MAP_CATEGORY_LABELS, mapCategory } from '@/lib/aircraft-icons';
import { useAirlineScope } from '@/lib/airline-scope';
import { describeError } from '@/lib/errors';
import {
  aircraftStatusLabels,
  aircraftStatusTone,
  engineTypeLabel,
  formatLocalDate,
  formatNumber,
  operationTypeLabel,
  wakeCategoryLabel,
} from '@/lib/format';
import { useAirlinePermissions } from '@/lib/permissions';
import { formatHours } from '@/lib/schedule';

function FleetTable({ airline, canManage }: { airline: Airline; canManage: boolean }) {
  const fleet = useFleet(airline.id);
  const types = useAircraftTypes();
  const { isOrgAdmin } = useAirlineScope();
  const remove = useDeleteAircraft();
  const [editing, setEditing] = useState<FleetAircraft | 'new' | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const settings = useAirlineSettings(airline.id);
  // Sin el control de disponibilidad, Fleet solo lista lo que la aerolínea tiene registrado.
  const controlled = settings.data?.control_fleet_availability ?? true;

  const rows = useMemo(
    () =>
      (fleet.data ?? []).filter(
        (a) => (!typeFilter || String(a.aircraft_type_id) === typeFilter) && (!controlled || !statusFilter || a.status === statusFilter),
      ),
    [fleet.data, typeFilter, statusFilter, controlled],
  );
  const columns = (controlled ? 9 : 6) + (canManage ? 1 : 0);

  const counts = useMemo(() => {
    const all = fleet.data ?? [];
    return {
      total: all.length,
      available: all.filter((a) => a.status === 'available').length,
      hours: all.reduce((sum, a) => sum + a.total_minutes, 0),
    };
  }, [fleet.data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <dl className="flex flex-wrap gap-x-8 gap-y-2">
          <div>
            <dt className="text-sm text-muted">Aeronaves</dt>
            <dd className="font-display text-2xl font-semibold tabular-nums">{counts.total}</dd>
          </div>
          {controlled ? (
            <div>
              <dt className="text-sm text-muted">Disponibles</dt>
              <dd className="font-display text-2xl font-semibold tabular-nums">{counts.available}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-sm text-muted">Horas acumuladas</dt>
            <dd className="font-display text-2xl font-semibold tabular-nums">{formatHours(counts.hours)}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="fleet-type" className="sr-only">
              Filtrar por tipo
            </label>
            <Select id="fleet-type" className="w-44" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">Todos los tipos</option>
              {(types.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.icao_code} · {t.model}
                </option>
              ))}
            </Select>
          </div>
          {controlled ? (
            <div>
              <label htmlFor="fleet-status" className="sr-only">
                Filtrar por estado
              </label>
              <Select id="fleet-status" className="w-48" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">Todos los estados</option>
                {Object.entries(aircraftStatusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          {canManage ? (
            <Button onClick={() => setEditing('new')} disabled={!types.data}>
              <Plus className="size-4" aria-hidden />
              Agregar aeronave
            </Button>
          ) : null}
        </div>
      </div>

      {!controlled ? (
        <p className="text-sm text-muted">
          {airline.name} no controla la disponibilidad de su flota: cualquier piloto vuela cualquier aeronave, sin estado, base ni ubicación.
        </p>
      ) : null}
      {fleet.isError ? <Alert tone="danger">{describeError(fleet.error)}</Alert> : null}

      {fleet.isPending ? (
        <Skeleton className="h-48" />
      ) : (
        <Table minWidth={controlled ? '64rem' : '48rem'}>
          <thead>
            <tr>
              <Th>Matrícula</Th>
              <Th>Tipo</Th>
              <Th>Configuración</Th>
              {controlled ? (
                <>
                  <Th>Estado</Th>
                  <Th>Base</Th>
                  <Th>Ubicación</Th>
                </>
              ) : null}
              <Th className="text-right">Horas</Th>
              <Th className="text-right">Ciclos</Th>
              <Th>Último vuelo</Th>
              {canManage ? <Th className="text-right">Acciones</Th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={columns}>
                {fleet.data?.length
                  ? 'Ninguna aeronave coincide con los filtros.'
                  : canManage
                    ? 'La flota está vacía. Agrega la primera aeronave.'
                    : 'Esta aerolínea todavía no registra aeronaves.'}
              </EmptyRow>
            ) : (
              rows.map((a) => (
                <tr key={a.id}>
                  <Td>
                    <p className="font-mono font-medium">{a.registration}</p>
                    {a.fleet_number ? <p className="text-xs text-muted">Flota {a.fleet_number}</p> : null}
                  </Td>
                  <Td>
                    <p className="font-mono">{a.type?.icao_code}</p>
                    <p className="text-xs text-muted">
                      {a.type?.manufacturer} {a.type?.model}
                    </p>
                  </Td>
                  <Td>
                    <p>{a.configuration ?? <span className="text-muted">Sin definir</span>}</p>
                    <p className="text-xs text-muted">{operationTypeLabel(a.operation_type)}</p>
                  </Td>
                  {controlled ? (
                    <>
                      <Td>
                        <Badge tone={aircraftStatusTone[a.status]}>{aircraftStatusLabels[a.status]}</Badge>
                      </Td>
                      <Td className="font-mono">{a.base?.icao_code ?? <span className="font-sans text-muted">Sin base</span>}</Td>
                      <Td className="font-mono">{a.current?.icao_code ?? <span className="font-sans text-muted">Sin registro</span>}</Td>
                    </>
                  ) : null}
                  <Td className="text-right tabular-nums">{formatHours(a.total_minutes)}</Td>
                  <Td className="text-right tabular-nums">{formatNumber(a.cycles)}</Td>
                  <Td>{a.last_flight_at ? formatLocalDate(a.last_flight_at) : <span className="text-muted">Sin vuelos</span>}</Td>
                  {canManage ? (
                    <Td className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => setEditing(a)}>
                          Editar
                        </Button>
                        <ConfirmButton
                          size="sm"
                          variant="ghost"
                          title={`Eliminar ${a.registration}`}
                          message="La aeronave sale de la flota. Si ya tiene vuelos registrados, la base de datos no permitirá borrarla; ponla Fuera de servicio."
                          confirmLabel="Eliminar"
                          onConfirm={async () => {
                            try {
                              await remove.mutateAsync({ id: a.id, airlineId: airline.id });
                              toast.success('Aeronave eliminada');
                            } catch (error) {
                              toast.error(describeError(error));
                              throw error;
                            }
                          }}
                        >
                          Eliminar
                        </ConfirmButton>
                      </div>
                    </Td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </Table>
      )}

      {editing && types.data ? (
        <AircraftDialog
          airline={airline}
          aircraft={editing === 'new' ? null : editing}
          types={types.data}
          controlled={controlled}
          canAddType={isOrgAdmin}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Tipos de aeronave
// -----------------------------------------------------------------------------
function AircraftTypesTable() {
  const types = useAircraftTypes();
  const { isOrgAdmin } = useAirlineScope();
  const [editing, setEditing] = useState<AircraftType | 'new' | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-muted">
          Catálogo compartido por todas las aerolíneas. Las rutas y la flota solo pueden usar tipos de esta lista.
        </p>
        {isOrgAdmin ? (
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden />
            Agregar tipo
          </Button>
        ) : null}
      </div>
      {types.isPending ? (
        <Skeleton className="h-48" />
      ) : types.isError ? (
        <Alert tone="danger">{describeError(types.error)}</Alert>
      ) : (
        <Table minWidth="56rem">
          <thead>
            <tr>
              <Th>ICAO</Th>
              <Th>Aeronave</Th>
              <Th>Estela</Th>
              <Th>Motor</Th>
              <Th className="text-right">Pasajeros</Th>
              <Th className="text-right">Carga (kg)</Th>
              <Th className="text-right">Crucero (kt)</Th>
              <Th>Mapa</Th>
              {isOrgAdmin ? <Th className="text-right">Acciones</Th> : null}
            </tr>
          </thead>
          <tbody>
            {types.data.map((t) => (
              <tr key={t.id}>
                <Td className="font-mono font-medium">{t.icao_code}</Td>
                <Td>
                  {t.manufacturer} {t.model}
                </Td>
                <Td>{wakeCategoryLabel(t.wake_category)}</Td>
                <Td>{engineTypeLabel(t.engine_type)}</Td>
                <Td className="text-right tabular-nums">{t.max_passengers ?? '—'}</Td>
                <Td className="text-right tabular-nums">{t.max_cargo_kg ? formatNumber(t.max_cargo_kg) : '—'}</Td>
                <Td className="text-right tabular-nums">{t.cruise_speed_kts ?? '—'}</Td>
                <Td>
                  <span className="inline-flex items-center gap-1.5 text-sm">
                    <span className="inline-grid size-7 place-items-center" aria-hidden dangerouslySetInnerHTML={{ __html: aircraftSvg(t.map_category, '#38bdf8') }} />
                    {MAP_CATEGORY_LABELS[mapCategory(t.map_category)]}
                  </span>
                </Td>
                {isOrgAdmin ? (
                  <Td className="text-right">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(t)}>
                      Editar
                    </Button>
                  </Td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing ? <AircraftTypeDialog type={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
function FleetSection({ airline }: { airline: Airline }) {
  const { canManage } = useAirlinePermissions(airline.id);
  return <FleetTable airline={airline} canManage={canManage} />;
}

export function FleetPage() {
  const [tab, setTab] = useState<'fleet' | 'types'>('fleet');
  return (
    <div className="space-y-6">
      <PageHeader title="Fleet" description="Aeronaves de la aerolínea seleccionada y catálogo de tipos de aeronave." />
      <Tabs
        label="Flota"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'fleet', label: 'Aeronaves' },
          { value: 'types', label: 'Tipos de aeronave' },
        ]}
      />
      {tab === 'fleet' ? <ScopeRequired>{(airline) => <FleetSection airline={airline} />}</ScopeRequired> : <AircraftTypesTable />}
    </div>
  );
}
