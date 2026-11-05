import { Plus, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AirportPicker } from '@/components/airport-picker';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { WeatherCard } from '@/components/weather';
import { useAirportById } from '@/hooks/use-airports';
import { useMyFlights } from '@/hooks/use-bookings';
import { useWeather } from '@/hooks/use-weather';
import { describeError } from '@/lib/errors';
import { readStored, writeStored } from '@/lib/storage';
import { ICAO_PATTERN, MAX_WEATHER_AIRPORTS, normalizeIcao } from '@/lib/weather';

const STORAGE_KEY = 'lam.weather.airports';
const DEFAULT_AIRPORTS = ['MMMX'];

function loadAirports(): string[] {
  try {
    const parsed = JSON.parse(readStored(STORAGE_KEY) ?? 'null') as unknown;
    if (Array.isArray(parsed)) {
      const list = parsed.map((v) => normalizeIcao(String(v))).filter((v) => ICAO_PATTERN.test(v));
      return [...new Set(list)].slice(0, MAX_WEATHER_AIRPORTS);
    }
  } catch {
    // Valor dañado: se usa la lista inicial.
  }
  return DEFAULT_AIRPORTS;
}

/** Agrega un aeropuerto a la lista si es válido, no está y hay lugar. */
function withAirport(list: string[], icao: string): string[] {
  const value = normalizeIcao(icao);
  if (!ICAO_PATTERN.test(value) || list.includes(value) || list.length >= MAX_WEATHER_AIRPORTS) return list;
  return [...list, value];
}

export function WeatherPage() {
  const [airports, setAirports] = useState<string[]>(loadAirports);
  const [code, setCode] = useState('');
  const [pickedId, setPickedId] = useState<number | null>(null);
  const picked = useAirportById(pickedId);
  const weather = useWeather(airports);
  const upcoming = useMyFlights('upcoming', null);
  const full = airports.length >= MAX_WEATHER_AIRPORTS;

  useEffect(() => writeStored(STORAGE_KEY, JSON.stringify(airports)), [airports]);

  function add(icao: string) {
    setAirports((list) => withAirport(list, icao));
  }

  // Al elegir un aeropuerto del catálogo se agrega y el buscador queda listo para otro.
  const pickedIcao = picked.data?.icao_code ?? null;
  useEffect(() => {
    if (!pickedIcao) return;
    setAirports((list) => withAirport(list, pickedIcao));
    setPickedId(null);
  }, [pickedIcao]);

  // Aeropuertos de los vuelos reservados que aún no están en la lista.
  const suggestions = useMemo(() => {
    const codes = (upcoming.data ?? []).flatMap((f) => [f.origin?.icao_code, f.destination?.icao_code]);
    return [...new Set(codes.filter((c): c is string => Boolean(c)))].filter((c) => !airports.includes(c)).slice(0, 6);
  }, [upcoming.data, airports]);

  const typed = normalizeIcao(code);
  const canAdd = ICAO_PATTERN.test(typed) && !airports.includes(typed) && !full;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Weather"
        description="METAR y TAF de cualquier aeropuerto del mundo. Datos del Aviation Weather Center de NOAA; se actualizan cada 5 minutos."
      />

      <section aria-label="Agregar aeropuerto" className="space-y-3 rounded-lg border border-line bg-surface p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,16rem)]">
          <div>
            <label htmlFor="wx-search" className="mb-1 block text-sm text-muted">
              Buscar en el catálogo
            </label>
            <AirportPicker id="wx-search" value={pickedId} onChange={setPickedId} disabled={full} />
          </div>
          <p className="hidden self-end pb-2.5 text-sm text-muted md:block">o</p>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!canAdd) return;
              add(typed);
              setCode('');
            }}
          >
            <div className="flex-1">
              <label htmlFor="wx-code" className="mb-1 block text-sm text-muted">
                Código ICAO
              </label>
              <Input
                id="wx-code"
                className="font-mono uppercase"
                maxLength={4}
                placeholder="KJFK"
                autoComplete="off"
                value={code}
                disabled={full}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <Button type="submit" variant="secondary" disabled={!canAdd}>
              <Plus className="size-4" aria-hidden />
              Agregar
            </Button>
          </form>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {suggestions.length > 0 ? (
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
              De tus vuelos reservados:
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={full}
                  onClick={() => add(s)}
                  className="rounded-md border border-line px-2 py-0.5 font-mono text-ink hover:border-muted disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </p>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3 text-sm text-muted">
            <span>
              {airports.length} de {MAX_WEATHER_AIRPORTS} aeropuertos
            </span>
            <Button size="sm" variant="ghost" onClick={() => void weather.refetch()} loading={weather.isFetching} disabled={airports.length === 0}>
              <RefreshCw className="size-4" aria-hidden />
              Actualizar
            </Button>
          </div>
        </div>
      </section>

      {weather.isError ? <Alert tone="danger">{describeError(weather.error)}</Alert> : null}
      {weather.data?.upstreamError ? (
        <Alert>NOAA no respondió en este momento; se muestra el último dato guardado. ({weather.data.upstreamError})</Alert>
      ) : null}

      {airports.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-6 py-12 text-center">
          <p className="font-display text-lg font-semibold">Sin aeropuertos</p>
          <p className="mx-auto mt-1 max-w-md text-muted">Busca un aeropuerto o escribe su código ICAO para ver su METAR y su TAF.</p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {airports.map((icao) => (
            <WeatherCard
              key={icao}
              icao={icao}
              report={weather.data?.byIcao.get(icao)}
              onRemove={() => setAirports((list) => list.filter((a) => a !== icao))}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-muted">
        Fuente: Aviation Weather Center (NOAA). Úsalo para planear; el clima en vivo del simulador puede diferir del METAR real.
      </p>
    </div>
  );
}
