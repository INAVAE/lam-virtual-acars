import { zodResolver } from '@hookform/resolvers/zod';
import { AIRPORT_TYPES } from '@lam/shared-types';
import { CloudDownload, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { ConfirmButton } from '@/components/confirm-button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, fieldAria } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyRow, Table, Td, Th } from '@/components/ui/table';
import {
  useAirportCount,
  useAirportList,
  useDeleteAirport,
  useImportAirports,
  useSaveAirport,
  type Airport,
} from '@/hooks/use-airports';
import { useAirlineScope } from '@/lib/airline-scope';
import { countryOptions } from '@/lib/countries';
import { describeError } from '@/lib/errors';
import { airportTypeLabel, countryName, formatNumber } from '@/lib/format';

const PAGE_SIZE = 50;

function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

const coordinate = (min: number, max: number, label: string) =>
  z.coerce.number({ invalid_type_error: `Escribe la ${label}` }).min(min, `Mínimo ${min}`).max(max, `Máximo ${max}`);

const airportSchema = z.object({
  icao_code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{4}$/, 'Código ICAO de 4 caracteres, por ejemplo MMMX'),
  iata_code: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim().toUpperCase() : v),
    z.string().regex(/^[A-Z0-9]{3}$/, 'Código IATA de 3 caracteres').nullable(),
  ),
  name: z.string().trim().min(2, 'Escribe el nombre').max(160),
  city: z.string().trim().max(120),
  country_code: z.string(),
  latitude: coordinate(-90, 90, 'latitud'),
  longitude: coordinate(-180, 180, 'longitud'),
  elevation_ft: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? null : Number(v)),
    z.number().int('Usa pies enteros').min(-1500).max(30000).nullable(),
  ),
  airport_type: z.enum(AIRPORT_TYPES),
});
type AirportForm = z.infer<typeof airportSchema>;

function AirportDialog({ airport, onClose }: { airport: Airport | null; onClose: () => void }) {
  const save = useSaveAirport();
  const countries = useMemo(() => countryOptions(), []);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AirportForm>({
    resolver: zodResolver(airportSchema),
    defaultValues: {
      icao_code: airport?.icao_code ?? '',
      iata_code: airport?.iata_code ?? null,
      name: airport?.name ?? '',
      city: airport?.city ?? '',
      country_code: airport?.country_code ?? 'MX',
      latitude: airport?.latitude ?? (undefined as unknown as number),
      longitude: airport?.longitude ?? (undefined as unknown as number),
      elevation_ft: airport?.elevation_ft ?? null,
      airport_type: (airport?.airport_type as AirportForm['airport_type']) ?? 'medium_airport',
    },
  });

  async function onSubmit(values: AirportForm) {
    try {
      await save.mutateAsync({
        id: airport?.id,
        values: { ...values, city: values.city || null, country_code: values.country_code || null },
      });
      toast.success(airport ? 'Aeropuerto actualizado' : 'Aeropuerto agregado');
      onClose();
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={airport ? `Editar ${airport.icao_code}` : 'Agregar aeropuerto'}
      description="Coordenadas en grados decimales (WGS84). Los aeropuertos capturados aquí no se sobrescriben al actualizar desde OurAirports."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="airport-form" loading={isSubmitting}>
            {airport ? 'Guardar cambios' : 'Agregar aeropuerto'}
          </Button>
        </>
      }
    >
      <form id="airport-form" onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field id="ap-icao" label="ICAO" error={errors.icao_code?.message}>
          <Input className="font-mono uppercase" {...fieldAria('ap-icao', errors.icao_code?.message)} {...register('icao_code')} />
        </Field>
        <Field id="ap-iata" label="IATA" error={errors.iata_code?.message} hint="Opcional.">
          <Input className="font-mono uppercase" {...fieldAria('ap-iata', errors.iata_code?.message, 'Opcional')} {...register('iata_code')} />
        </Field>
        <div className="sm:col-span-2">
          <Field id="ap-name" label="Nombre" error={errors.name?.message}>
            <Input {...fieldAria('ap-name', errors.name?.message)} {...register('name')} />
          </Field>
        </div>
        <Field id="ap-city" label="Ciudad" error={errors.city?.message}>
          <Input {...fieldAria('ap-city', errors.city?.message)} {...register('city')} />
        </Field>
        <Field id="ap-country" label="País">
          <Select id="ap-country" {...register('country_code')}>
            <option value="">Sin especificar</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="ap-lat" label="Latitud" error={errors.latitude?.message}>
          <Input type="number" step="any" inputMode="decimal" {...fieldAria('ap-lat', errors.latitude?.message)} {...register('latitude')} />
        </Field>
        <Field id="ap-lon" label="Longitud" error={errors.longitude?.message}>
          <Input type="number" step="any" inputMode="decimal" {...fieldAria('ap-lon', errors.longitude?.message)} {...register('longitude')} />
        </Field>
        <Field id="ap-elev" label="Elevación (ft)" error={errors.elevation_ft?.message}>
          <Input type="number" inputMode="numeric" {...fieldAria('ap-elev', errors.elevation_ft?.message)} {...register('elevation_ft')} />
        </Field>
        <Field id="ap-type" label="Tipo">
          <Select id="ap-type" {...register('airport_type')}>
            {AIRPORT_TYPES.map((t) => (
              <option key={t} value={t}>
                {airportTypeLabel(t)}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </Dialog>
  );
}

function ImportAirportsDialog({ onClose }: { onClose: () => void }) {
  const importer = useImportAirports();
  const [mode, setMode] = useState<'insert' | 'refresh'>('insert');

  async function run() {
    try {
      const result = await importer.mutateAsync(mode);
      toast.success(
        mode === 'insert'
          ? `Importación terminada: ${formatNumber(result.written)} aeropuertos nuevos de ${formatNumber(result.eligible)} elegibles`
          : `Actualización terminada: ${formatNumber(result.written)} aeropuertos procesados`,
      );
      onClose();
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  return (
    <Dialog
      open
      onClose={() => !importer.isPending && onClose()}
      title="Importar aeropuertos de OurAirports"
      description="OurAirports es una base de datos de dominio público. La importación tarda entre 20 y 60 segundos."
      footer={
        <>
          <Button variant="secondary" disabled={importer.isPending} onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={importer.isPending} onClick={run}>
            {importer.isPending ? 'Importando…' : 'Importar'}
          </Button>
        </>
      }
    >
      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm text-muted">
          Se importan aeropuertos grandes y medianos de todo el mundo, pequeños con vuelos regulares y todos los aeródromos de
          México con código ICAO.
        </legend>
        <label className="flex cursor-pointer gap-2.5">
          <input type="radio" name="import-mode" className="mt-1 accent-[var(--accent)]" checked={mode === 'insert'} onChange={() => setMode('insert')} />
          <span>
            <span className="block">Agregar los que faltan</span>
            <span className="block text-sm text-muted">No cambia los aeropuertos que ya existen.</span>
          </span>
        </label>
        <label className="flex cursor-pointer gap-2.5">
          <input type="radio" name="import-mode" className="mt-1 accent-[var(--accent)]" checked={mode === 'refresh'} onChange={() => setMode('refresh')} />
          <span>
            <span className="block">Actualizar desde OurAirports</span>
            <span className="block text-sm text-muted">Agrega y actualiza nombres, ciudades y coordenadas. No toca los aeropuertos capturados a mano.</span>
          </span>
        </label>
      </fieldset>
    </Dialog>
  );
}

export function AirportsPage() {
  const { isOrgAdmin } = useAirlineScope();
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Airport | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const debouncedSearch = useDebounced(search);
  const countries = useMemo(() => countryOptions(), []);
  const total = useAirportCount();
  const remove = useDeleteAirport();
  const list = useAirportList({ search: debouncedSearch, country, type, page, pageSize: PAGE_SIZE });

  useEffect(() => setPage(0), [debouncedSearch, country, type]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Airports"
        description={
          total.data !== undefined ? (
            <>
              Catálogo compartido con <span className="tabular-nums text-ink">{formatNumber(total.data)}</span> aeropuertos.
            </>
          ) : (
            'Catálogo compartido de aeropuertos.'
          )
        }
        actions={
          isOrgAdmin ? (
            <>
              <Button variant="secondary" onClick={() => setImporting(true)}>
                <CloudDownload className="size-4" aria-hidden />
                Importar de OurAirports
              </Button>
              <Button onClick={() => setEditing('new')}>
                <Plus className="size-4" aria-hidden />
                Agregar aeropuerto
              </Button>
            </>
          ) : null
        }
      />

      {total.data === 0 ? (
        <Alert>
          {isOrgAdmin
            ? 'El catálogo está vacío. Usa "Importar de OurAirports" para cargar los aeropuertos con un clic.'
            : 'El catálogo de aeropuertos todavía no se ha cargado. Un superadministrador puede importarlo.'}
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <label htmlFor="ap-search" className="sr-only">
            Buscar aeropuerto
          </label>
          <Input id="ap-search" placeholder="ICAO, IATA, nombre o ciudad" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div>
          <label htmlFor="ap-country-filter" className="sr-only">
            País
          </label>
          <Select id="ap-country-filter" value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">Todos los países</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="ap-type-filter" className="sr-only">
            Tipo
          </label>
          <Select id="ap-type-filter" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Todos los tipos</option>
            {AIRPORT_TYPES.map((t) => (
              <option key={t} value={t}>
                {airportTypeLabel(t)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {list.isError ? <Alert tone="danger">{describeError(list.error)}</Alert> : null}

      {list.isPending ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <Table minWidth="56rem">
            <thead>
              <tr>
                <Th>ICAO</Th>
                <Th>IATA</Th>
                <Th>Nombre</Th>
                <Th>Ciudad</Th>
                <Th>País</Th>
                <Th>Tipo</Th>
                <Th className="text-right">Elevación</Th>
                {isOrgAdmin ? <Th className="text-right">Acciones</Th> : null}
              </tr>
            </thead>
            <tbody>
              {list.data?.rows.length === 0 ? (
                <EmptyRow colSpan={isOrgAdmin ? 8 : 7}>Ningún aeropuerto coincide con la búsqueda.</EmptyRow>
              ) : (
                list.data?.rows.map((a) => (
                  <tr key={a.id}>
                    <Td className="font-mono font-medium">{a.icao_code}</Td>
                    <Td className="font-mono">{a.iata_code ?? '—'}</Td>
                    <Td>
                      {a.name}
                      {a.source === 'manual' ? (
                        <Badge className="ml-2" tone="info">
                          Manual
                        </Badge>
                      ) : null}
                    </Td>
                    <Td>{a.city ?? '—'}</Td>
                    <Td>{countryName(a.country_code)}</Td>
                    <Td>{airportTypeLabel(a.airport_type)}</Td>
                    <Td className="text-right tabular-nums">{a.elevation_ft !== null ? `${formatNumber(a.elevation_ft)} ft` : '—'}</Td>
                    {isOrgAdmin ? (
                      <Td className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="secondary" onClick={() => setEditing(a)}>
                            Editar
                          </Button>
                          <ConfirmButton
                            size="sm"
                            variant="ghost"
                            title={`Eliminar ${a.icao_code}`}
                            message="Si alguna ruta o aeronave usa este aeropuerto, la base de datos no permitirá borrarlo."
                            confirmLabel="Eliminar"
                            onConfirm={async () => {
                              try {
                                await remove.mutateAsync(a.id);
                                toast.success('Aeropuerto eliminado');
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
          <Pagination page={page} pageSize={PAGE_SIZE} total={list.data?.total ?? null} onPageChange={setPage} />
        </>
      )}

      {editing ? <AirportDialog airport={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
      {importing ? <ImportAirportsDialog onClose={() => setImporting(false)} /> : null}
    </div>
  );
}
