import { cn } from '@/lib/cn';

/**
 * "Seleccionar todos" y "Ninguno" para una lista de casillas. Devuelve la lista
 * completa o vacía; quien lo usa decide qué hacer con ella.
 */
export function SelectAll<T>({
  all,
  selected,
  onChange,
  disabled,
  className,
  noun = 'todos',
}: {
  all: readonly T[];
  selected: readonly T[];
  onChange: (next: T[]) => void;
  disabled?: boolean;
  className?: string;
  noun?: string;
}) {
  const count = all.filter((v) => selected.includes(v)).length;
  const everything = all.length > 0 && count === all.length;
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-sm', className)}>
      <span className="text-muted tabular-nums">
        {count} de {all.length}
      </span>
      <button
        type="button"
        className="font-medium text-cyan underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
        disabled={disabled || everything}
        onClick={() => onChange([...new Set([...selected, ...all])])}
      >
        Seleccionar {noun}
      </button>
      <button
        type="button"
        className="font-medium text-muted underline-offset-2 hover:text-ink hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
        disabled={disabled || count === 0}
        onClick={() => onChange(selected.filter((v) => !all.includes(v)))}
      >
        Ninguno
      </button>
    </span>
  );
}
