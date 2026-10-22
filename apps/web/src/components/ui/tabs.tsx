import { cn } from '@/lib/cn';

interface TabsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  items: { value: T; label: string; count?: number }[];
  label: string;
}

/** Pestañas simples con roles ARIA; el contenido lo muestra quien las usa. */
export function Tabs<T extends string>({ value, onChange, items, label }: TabsProps<T>) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 border-b border-line">
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(item.value)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-[15px] transition-colors',
              selected ? 'border-accent font-medium text-ink' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {item.label}
            {item.count !== undefined ? <span className="ml-1.5 tabular-nums text-muted">{item.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
