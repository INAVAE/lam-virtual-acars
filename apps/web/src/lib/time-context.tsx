import { createContext, Fragment, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useProfile } from '@/hooks/use-lam-data';
import { setDisplayTimeZone } from './format';
import { browserTimeZone, dualTime, isValidTimeZone, utcTimeOfDay, zoneAbbreviation, type DualTime, type TimePrimary } from './time';

const PRIMARY_KEY = 'lam.timePrimary';

function readPrimary(): TimePrimary {
  try {
    return window.localStorage.getItem(PRIMARY_KEY) === 'local' ? 'local' : 'utc';
  } catch {
    return 'utc';
  }
}

interface TimePrefs {
  /** Zona del piloto (la del perfil o la del navegador). */
  timeZone: string;
  /** true si la zona viene del navegador porque el perfil no tiene una. */
  automatic: boolean;
  /** Qué hora se muestra primero: UTC (Zulu) o local. */
  primary: TimePrimary;
  setPrimary: (value: TimePrimary) => void;
  togglePrimary: () => void;
  /** Hora doble de un instante. */
  dual: (value: Date | string | number, options?: { seconds?: boolean; withDate?: boolean }) => DualTime;
  /** Hora doble de un horario UTC de ruta ("14:30:00"). */
  schedule: (value: string) => DualTime;
  /** Abreviatura local ("CST"). */
  localLabel: string;
}

const TimeContext = createContext<TimePrefs | null>(null);

/**
 * Preferencias de hora. La zona se guarda en el perfil (sigue al piloto en
 * cualquier equipo); el orden UTC/local es del navegador. Al cambiar la zona se
 * vuelve a montar la vista para que todas las fechas usen la nueva.
 */
export function TimeProvider({ children }: { children: ReactNode }) {
  const profile = useProfile();
  const [primary, setPrimaryState] = useState<TimePrimary>(readPrimary);
  const saved = profile.data?.time_zone ?? null;
  const timeZone = saved && isValidTimeZone(saved) ? saved : browserTimeZone();
  setDisplayTimeZone(timeZone);

  const setPrimary = useCallback((value: TimePrimary) => {
    setPrimaryState(value);
    try {
      window.localStorage.setItem(PRIMARY_KEY, value);
    } catch {
      // Sin almacenamiento: dura hasta recargar.
    }
  }, []);

  const value = useMemo<TimePrefs>(
    () => ({
      timeZone,
      automatic: !saved,
      primary,
      setPrimary,
      togglePrimary: () => setPrimary(primary === 'utc' ? 'local' : 'utc'),
      dual: (v, options) => dualTime(v, timeZone, primary, options),
      schedule: (v) => utcTimeOfDay(v, timeZone, primary),
      localLabel: zoneAbbreviation(timeZone),
    }),
    [timeZone, saved, primary, setPrimary],
  );

  return (
    <TimeContext.Provider value={value}>
      <Fragment key={timeZone}>{children}</Fragment>
    </TimeContext.Provider>
  );
}

const FALLBACK: TimePrefs = {
  timeZone: 'UTC',
  automatic: true,
  primary: 'utc',
  setPrimary: () => undefined,
  togglePrimary: () => undefined,
  dual: (v, options) => dualTime(v, browserTimeZone(), 'utc', options),
  schedule: (v) => utcTimeOfDay(v, browserTimeZone(), 'utc'),
  localLabel: zoneAbbreviation(browserTimeZone()),
};

/** Preferencias de hora (fuera del proveedor: UTC primero y la zona del navegador). */
export function useTimePrefs(): TimePrefs {
  return useContext(TimeContext) ?? FALLBACK;
}

/** Hora doble: la principal y, debajo o al lado, la secundaria más tenue. */
export function DualTimeText({
  value,
  withDate = false,
  seconds = false,
  inline = false,
  className,
}: {
  value: Date | string | number;
  withDate?: boolean;
  seconds?: boolean;
  inline?: boolean;
  className?: string;
}) {
  const { dual } = useTimePrefs();
  const t = dual(value, { withDate, seconds });
  const iso = new Date(value).toISOString();
  return (
    <time dateTime={iso} className={className}>
      <span className="font-mono">{t.primary}</span>
      {t.secondary ? (
        inline ? (
          <span className="ml-1.5 font-mono text-xs text-muted">{t.secondary}</span>
        ) : (
          <span className="block font-mono text-xs text-muted">{t.secondary}</span>
        )
      ) : null}
    </time>
  );
}

/** Horario UTC de una ruta con su hora local. */
export function ScheduleTimeText({ value, inline = true }: { value: string | null; inline?: boolean }) {
  const { schedule } = useTimePrefs();
  if (!value) return <span className="text-muted">—</span>;
  const t = schedule(value);
  return (
    <span>
      <span className="font-mono">{t.primary}</span>
      {t.secondary ? <span className={inline ? 'ml-1.5 font-mono text-xs text-muted' : 'block font-mono text-xs text-muted'}>{t.secondary}</span> : null}
    </span>
  );
}
