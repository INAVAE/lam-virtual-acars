import { ChevronDown, ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import {
  formatAltitudeFt,
  formatAvgWind,
  formatHhMm,
  formatIsaDeviation,
  formatMass,
  formatWindComponent,
  planDistanceNm,
  type FlightPlanSheet,
} from '@/lib/flight-plan';
import { currentLocale } from '@/lib/i18n';
import { useTimePrefs } from '@/lib/time-context';

function Cell({ label, children, warn }: { label: string; children: ReactNode; warn?: boolean }) {
  return (
    <div className="border-b border-line/60 pb-2 text-center">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cn('mt-0.5 font-mono text-sm font-semibold', warn && 'text-danger-ink')}>{children}</dd>
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <details open className="group @container rounded-md border border-line bg-bg">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <span className="flex-1">
          {title}
          {aside ? <span className="ml-1.5 font-normal text-muted">{aside}</span> : null}
        </span>
        <ChevronDown className="size-4 text-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-3 pb-3 @md:grid-cols-3 @3xl:grid-cols-6">{children}</dl>
    </details>
  );
}

/** Fecha corta en UTC, como el OFP: 09 nov 26. */
function utcDate(iso: string): string {
  return new Intl.DateTimeFormat(currentLocale(), { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(iso)).replace(/\./g, '');
}

function UtcTime({ iso }: { iso: string | null }) {
  const { dual } = useTimePrefs();
  if (!iso) return <>—</>;
  const t = dual(iso);
  return (
    <>
      {t.primary}
      {t.secondary ? <span className="block text-xs font-normal text-muted">{t.secondary}</span> : null}
    </>
  );
}

/**
 * La hoja del plan de SimBrief importado: información del vuelo, resumen del
 * plan y hoja de carga, con los mismos datos que muestra SimBrief.
 */
export function FlightPlanSheetView({ plan }: { plan: FlightPlanSheet }) {
  const locale = currentLocale();
  const units = plan.fuel_units;
  const mass = (v: number | null) => formatMass(v, units, locale);
  const distance = planDistanceNm(plan);
  const over = (est: number | null, max: number | null) => est !== null && max !== null && est > max;
  const number = [plan.airline_icao, plan.flight_number].filter(Boolean).join('');

  return (
    <div className="space-y-3">
      <Section title="Información del vuelo">
        <Cell label="Número de vuelo">{number || '—'}</Cell>
        <Cell label="Callsign">{plan.atc_callsign ?? '—'}</Cell>
        <Cell label="Salida">{plan.origin_icao}</Cell>
        <Cell label="Llegada">{plan.destination_icao}</Cell>
        <Cell label="Alterno">{plan.alternate_icao ?? '—'}</Cell>
        <Cell label="Aeronave">{plan.aircraft_name ?? plan.aircraft_icao ?? '—'}</Cell>
        <Cell label="Fecha de salida">{plan.sched_out_at ? utcDate(plan.sched_out_at) : '—'}</Cell>
        <Cell label="Hora de salida">
          <UtcTime iso={plan.sched_out_at} />
        </Cell>
        <Cell label="Hora de llegada">
          <UtcTime iso={plan.sched_in_at} />
        </Cell>
        <Cell label="Tiempo en el aire">{formatHhMm(plan.est_enroute_minutes)}</Cell>
        <Cell label="Tiempo de bloque">{formatHhMm(plan.est_block_minutes)}</Cell>
        <Cell label="Matrícula">{plan.registration ?? '—'}</Cell>
      </Section>

      <Section title="Resumen del plan">
        <Cell label="Altitud inicial">{formatAltitudeFt(plan.cruise_altitude_ft, locale)}</Cell>
        <Cell label="Índice de costo">{plan.cost_index ? `CI ${plan.cost_index}` : '—'}</Cell>
        <Cell label="Distancia de la ruta">{distance !== null ? `${new Intl.NumberFormat(locale).format(distance)} NM` : '—'}</Cell>
        <Cell label="Viento medio">{formatAvgWind(plan.avg_wind_dir, plan.avg_wind_kt)}</Cell>
        <Cell label="Componente de viento">{formatWindComponent(plan.avg_wind_comp)}</Cell>
        <Cell label="Desviación ISA">{formatIsaDeviation(plan.avg_isa_dev)}</Cell>
        <Cell label="Release">{plan.release_number ?? '—'}</Cell>
        <Cell label="Ciclo AIRAC">{plan.airac ?? '—'}</Cell>
        <Cell label="Unidades">{units ? units.toUpperCase() : '—'}</Cell>
        <Cell label="Reserva">{mass(plan.reserve_fuel)}</Cell>
        <Cell label="Generado">{plan.generated_at ? <UtcTime iso={plan.generated_at} /> : '—'}</Cell>
        <Cell label="OFP">
          {plan.pdf_url ? (
            <a href={plan.pdf_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-sans font-medium text-cyan hover:underline">
              PDF
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          ) : (
            '—'
          )}
        </Cell>
      </Section>

      <Section title="Hoja de carga" aside={units ? `Pesos en ${units.toUpperCase()}` : undefined}>
        <Cell label="Consumo en ruta">{mass(plan.trip_fuel)}</Cell>
        <Cell label="Pasajeros">{plan.pax_count ?? '—'}</Cell>
        <Cell label="Peso vacío">{mass(plan.oew)}</Cell>
        <Cell label="ZFW estimado" warn={over(plan.zfw, plan.max_zfw)}>
          {mass(plan.zfw)}
        </Cell>
        <Cell label="TOW estimado" warn={over(plan.tow, plan.max_tow)}>
          {mass(plan.tow)}
        </Cell>
        <Cell label="LW estimado" warn={over(plan.ldw, plan.max_ldw)}>
          {mass(plan.ldw)}
        </Cell>
        <Cell label="Combustible de bloque">{mass(plan.block_fuel)}</Cell>
        <Cell label="Equipaje y carga">{mass(plan.cargo)}</Cell>
        <Cell label="Carga de pago">{mass(plan.payload)}</Cell>
        <Cell label="ZFW máximo">{mass(plan.max_zfw)}</Cell>
        <Cell label="TOW máximo">{mass(plan.max_tow)}</Cell>
        <Cell label="LW máximo">{mass(plan.max_ldw)}</Cell>
      </Section>
    </div>
  );
}
