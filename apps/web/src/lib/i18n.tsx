import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DomTranslator } from './translator';

export type Lang = 'es' | 'en';

export const LANGUAGES: { value: Lang; label: string; short: string }[] = [
  { value: 'es', label: 'Español', short: 'ES' },
  { value: 'en', label: 'English', short: 'EN' },
];

const KEY = 'lam:lang';

export function readLang(): Lang {
  try {
    return window.localStorage.getItem(KEY) === 'en' ? 'en' : 'es';
  } catch {
    return 'es';
  }
}

let current: Lang = typeof window === 'undefined' ? 'es' : readLang();

/** Idioma activo para Intl (fechas y números). */
export function currentLang(): Lang {
  return current;
}

export function currentLocale(): string {
  return current === 'en' ? 'en-US' : 'es-MX';
}

const MONTHS_SHORT: Record<Lang, string[]> = {
  es: ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'],
  en: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
};

/** "ENE" o "JAN": el mes abreviado en mayúsculas del idioma activo. */
export function monthShort(index: number): string {
  return MONTHS_SHORT[current][index] ?? '';
}

/** Nombre del mes en el idioma activo ("noviembre" / "November"). */
export function monthName(index: number): string {
  return new Intl.DateTimeFormat(currentLocale(), { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, index, 1)));
}

/** Días de la semana abreviados, de lunes a domingo. */
export function weekdaysShort(): string[] {
  const fmt = new Intl.DateTimeFormat(currentLocale(), { weekday: 'short', timeZone: 'UTC' });
  // 2026-11-02 fue lunes.
  return Array.from({ length: 7 }, (_, i) => {
    const s = fmt.format(new Date(Date.UTC(2026, 10, 2 + i))).replace('.', '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  });
}

interface LangState {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

const LangContext = createContext<LangState | null>(null);

/**
 * Idioma de lectura de la página. Se guarda en el navegador; al cambiarlo se
 * vuelven a montar las pantallas (para que las fechas usen el nuevo idioma) y,
 * en inglés, el traductor de la interfaz reemplaza los textos.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang);

  const setLang = useCallback((next: Lang) => {
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // Sin almacenamiento: dura hasta recargar.
    }
    current = next;
    setLangState(next);
  }, []);

  useEffect(() => {
    current = lang;
    document.documentElement.lang = lang === 'en' ? 'en' : 'es-MX';
    if (lang !== 'en') return;
    let translator: DomTranslator | null = null;
    let cancelled = false;
    void import('@/content/i18n-en').then(({ EN }) => {
      if (cancelled) return;
      translator = new DomTranslator(EN);
      translator.start();
    });
    return () => {
      cancelled = true;
      translator?.stop();
    };
  }, [lang]);

  // Otra pestaña cambió el idioma: esta lo sigue.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setLangState(e.newValue === 'en' ? 'en' : 'es');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  current = lang;
  return (
    <LangContext.Provider value={value}>
      <Fragment key={lang}>{children}</Fragment>
    </LangContext.Provider>
  );
}

export function useLang(): LangState {
  return useContext(LangContext) ?? { lang: current, setLang: () => undefined };
}
