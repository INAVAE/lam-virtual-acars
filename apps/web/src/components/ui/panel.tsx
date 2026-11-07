import type { ReactNode } from 'react';
import { ExpandButton, ExpandToolbar, expandSlug, expandedClasses, useExpandable } from '@/components/expandable';
import { cn } from '@/lib/cn';

interface PanelProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Muestra «Ampliar»: el bloque ocupa toda la ventana, pasa a pantalla completa o se abre en otra pestaña. */
  expandable?: boolean;
}

/** Bloque de contenido con encabezado. Sin sombras: la estructura la dan los bordes. */
export function Panel(props: PanelProps) {
  return props.expandable ? <ExpandablePanel {...props} /> : <PanelBody {...props} />;
}

function PanelBody({
  title,
  description,
  actions,
  children,
  className,
  expandButton,
}: PanelProps & { expandButton?: ReactNode }) {
  const headingId = `panel-${expandSlug(title)}`;
  return (
    <section aria-labelledby={headingId} className={cn('rounded-lg border border-line bg-surface', className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="font-display text-lg font-semibold leading-tight">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
        </div>
        {actions || expandButton ? (
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            {expandButton}
          </div>
        ) : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function ExpandablePanel(props: PanelProps) {
  const id = expandSlug(props.title);
  const x = useExpandable(id);
  return (
    <div
      ref={(el) => {
        x.ref.current = el;
      }}
      className={cn(x.expanded && expandedClasses)}
      data-expand-id={id}
    >
      {x.expanded ? (
        <ExpandToolbar title={props.title} fullscreen={x.fullscreen} onFullscreen={x.toggleFullscreen} tabUrl={x.tabUrl()} onClose={x.close} />
      ) : null}
      <PanelBody {...props} expandButton={x.expanded ? undefined : <ExpandButton onClick={x.open} label={props.title} />} />
    </div>
  );
}
