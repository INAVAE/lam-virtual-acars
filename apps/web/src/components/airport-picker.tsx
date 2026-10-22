import { LoaderCircle, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useAirportById, useAirportSearch, type AirportSummary } from '@/hooks/use-airports';
import { cn } from '@/lib/cn';

interface AirportPickerProps {
  id: string;
  value: number | null;
  onChange: (airportId: number | null) => void;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
}

function describe(a: AirportSummary): string {
  return [a.city, a.country_code].filter(Boolean).join(', ');
}

/**
 * Selector de aeropuerto con búsqueda por ICAO, IATA, nombre o ciudad
 * (patrón combobox de WAI-ARIA).
 */
export function AirportPicker({ id, value, onChange, placeholder = 'Busca por ICAO, IATA o ciudad', invalid, describedBy, disabled }: AirportPickerProps) {
  const selected = useAirportById(value);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const search = useAirportSearch(open ? text : '');
  const listId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const options = search.data ?? [];

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  function choose(airport: AirportSummary) {
    onChange(airport.id);
    setText('');
    setOpen(false);
  }

  if (value !== null && !open) {
    const a = selected.data;
    return (
      <div className="flex h-10 items-center gap-2 rounded-md border border-line bg-bg px-3">
        {a ? (
          <>
            <span className="font-mono text-ink">{a.icao_code}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-muted">
              {a.name}
              {describe(a) ? `, ${describe(a)}` : ''}
            </span>
          </>
        ) : (
          <span className="flex-1 text-sm text-muted">Cargando…</span>
        )}
        {!disabled ? (
          <>
            <button
              type="button"
              id={id}
              onClick={() => setOpen(true)}
              className="text-sm text-ink underline underline-offset-4"
              aria-describedby={describedBy}
            >
              Cambiar
            </button>
            <button
              type="button"
              aria-label="Quitar aeropuerto"
              onClick={() => onChange(null)}
              className="inline-flex size-7 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-ink"
            >
              <X className="size-4" aria-hidden />
            </button>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={wrapper} className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        disabled={disabled}
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-activedescendant={open && options[active] ? `${listId}-${options[active].id}` : undefined}
        placeholder={placeholder}
        value={text}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, options.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && options[active]) {
            e.preventDefault();
            choose(options[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className={cn(
          'h-10 w-full rounded-md border border-line bg-bg px-3 text-[15px] text-ink placeholder:text-muted/70 focus-visible:border-cyan focus-visible:outline-none aria-[invalid=true]:border-danger',
        )}
      />
      {search.isFetching ? (
        <LoaderCircle className="absolute right-3 top-3 size-4 animate-spin text-muted" aria-hidden />
      ) : null}
      {open && text.trim().length >= 2 ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-line bg-surface py-1 shadow-lg shadow-black/30"
        >
          {options.length === 0 && !search.isFetching ? (
            <li className="px-3 py-2 text-sm text-muted">Sin resultados. Revisa el código o pide al superadministrador que lo agregue.</li>
          ) : null}
          {options.map((a, i) => (
            <li
              key={a.id}
              id={`${listId}-${a.id}`}
              role="option"
              aria-selected={i === active}
              onPointerDown={(e) => {
                e.preventDefault();
                choose(a);
              }}
              onPointerEnter={() => setActive(i)}
              className={cn('flex cursor-pointer items-baseline gap-2 px-3 py-2', i === active && 'bg-surface-2')}
            >
              <span className="w-12 shrink-0 font-mono text-ink">{a.icao_code}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{a.name}</span>
                <span className="block truncate text-xs text-muted">
                  {[a.iata_code, describe(a)].filter(Boolean).join(' · ')}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
