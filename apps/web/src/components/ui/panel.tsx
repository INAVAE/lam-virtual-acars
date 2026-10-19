import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface PanelProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Bloque de contenido con encabezado. Sin sombras: la estructura la dan los bordes. */
export function Panel({ title, description, actions, children, className }: PanelProps) {
  const headingId = `panel-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <section aria-labelledby={headingId} className={cn('rounded-lg border border-line bg-surface', className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 id={headingId} className="font-display text-lg font-semibold leading-tight">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
        </div>
        {actions}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
