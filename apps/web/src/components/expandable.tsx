import { ExternalLink, Maximize, Maximize2, Minimize, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { cn } from '@/lib/cn';

/** Parámetro de la URL que abre un módulo ampliado (sirve para «Abrir en otra pestaña»). */
export const EXPAND_PARAM = 'ver';

export function expandSlug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function notifyResize() {
  // Mapas (Leaflet) y gráficas se reacomodan con el evento resize de la ventana.
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  window.setTimeout(() => window.dispatchEvent(new Event('resize')), 250);
}

const toolButton =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-sm text-ink hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

/** Botón «Ampliar» para poner en el encabezado de un módulo. */
export function ExpandButton({ onClick, label, className }: { onClick: () => void; label: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Ampliar ${label}`}
      aria-label={`Ampliar ${label}`}
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink',
        className,
      )}
    >
      <Maximize2 className="size-4" aria-hidden />
    </button>
  );
}

/**
 * Estado de un módulo ampliable: ocupa toda la ventana con una barra para pantalla
 * completa, abrirlo en otra pestaña y cerrarlo. Se amplía sin volver a montar el
 * contenido, así el mapa o la gráfica conservan su estado.
 */
export function useExpandable(id: string) {
  const [params, setParams] = useSearchParams();
  const [expanded, setExpanded] = useState(() => params.get(EXPAND_PARAM) === id);
  const ref = useRef<HTMLElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const close = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    setExpanded(false);
    if (params.get(EXPAND_PARAM) === id) {
      const next = new URLSearchParams(params);
      next.delete(EXPAND_PARAM);
      setParams(next, { replace: true });
    }
  }, [id, params, setParams]);

  useEffect(() => {
    notifyResize();
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('lam-has-expanded');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) close();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.body.classList.remove('lam-has-expanded');
      document.removeEventListener('keydown', onKey);
    };
  }, [expanded, close]);

  useEffect(() => {
    const onChange = () => {
      setFullscreen(Boolean(document.fullscreenElement));
      notifyResize();
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    const target = ref.current ?? document.documentElement;
    if (target.requestFullscreen) void target.requestFullscreen().catch(() => undefined);
  }, []);

  const tabUrl = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.set(EXPAND_PARAM, id);
    return url.toString();
  }, [id]);

  return { expanded, open: () => setExpanded(true), close, ref, fullscreen, toggleFullscreen, tabUrl };
}

/** Barra superior del módulo ampliado. */
export function ExpandToolbar({
  title,
  fullscreen,
  onFullscreen,
  tabUrl,
  onClose,
}: {
  title: string;
  fullscreen: boolean;
  onFullscreen: () => void;
  tabUrl: string;
  onClose: () => void;
}) {
  const canFullscreen = typeof document !== 'undefined' && Boolean(document.documentElement.requestFullscreen);
  return (
    <div className="lam-expand-bar sticky top-0 z-10 -mx-4 -mt-4 mb-4 flex flex-wrap items-center gap-2 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur">
      <p className="mr-auto min-w-0 truncate font-display text-lg font-semibold">{title}</p>
      {canFullscreen ? (
        <button type="button" className={toolButton} onClick={onFullscreen}>
          {fullscreen ? <Minimize className="size-4" aria-hidden /> : <Maximize className="size-4" aria-hidden />}
          {fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
        </button>
      ) : null}
      <a className={toolButton} href={tabUrl} target="_blank" rel="noopener">
        <ExternalLink className="size-4" aria-hidden />
        Abrir en otra pestaña
      </a>
      <button type="button" className={cn(toolButton, 'border-accent/60')} onClick={onClose} title="Cerrar (Esc)">
        <X className="size-4" aria-hidden />
        Cerrar
      </button>
    </div>
  );
}

/** Clases del contenedor cuando está ampliado. */
export const expandedClasses = 'lam-expanded fixed inset-0 z-[60] overflow-auto rounded-none border-0 bg-bg p-4';

/**
 * Envoltura ampliable para módulos que no son un Panel (el mapa en vivo, una fila de
 * tarjetas). El botón «Ampliar» queda en la esquina superior derecha.
 */
export function Expandable({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const x = useExpandable(id);
  return (
    <div
      ref={(el) => {
        x.ref.current = el;
      }}
      className={cn('relative', className, x.expanded && expandedClasses)}
      data-expand-id={id}
    >
      {x.expanded ? (
        <ExpandToolbar title={title} fullscreen={x.fullscreen} onFullscreen={x.toggleFullscreen} tabUrl={x.tabUrl()} onClose={x.close} />
      ) : (
        <ExpandButton onClick={x.open} label={title} className="absolute right-2 top-2 z-[5] border border-line bg-surface/90 backdrop-blur" />
      )}
      {children}
    </div>
  );
}
