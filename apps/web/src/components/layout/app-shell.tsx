import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { Outlet, useLocation } from 'react-router';
import { useAirlineScope } from '@/lib/airline-scope';
import { Sidebar } from './sidebar';
import { TopBar } from './top-bar';

const SIDEBAR_KEY = 'lam:sidebar';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

export function AppShell() {
  const { isOrgAdmin } = useAirlineScope();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // En escritorio la barra lateral se reduce a iconos para dar espacio al mapa, las tarjetas y las gráficas.
  const [collapsed, setCollapsed] = useState(readCollapsed);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(SIDEBAR_KEY, next ? 'collapsed' : 'open');
    } catch {
      // Sin almacenamiento solo dura esta visita.
    }
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }

  const location = useLocation();

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  return (
    <div className={cn('min-h-dvh lg:grid', collapsed ? 'lg:grid-cols-[64px_1fr]' : 'lg:grid-cols-[256px_1fr]')}>
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Saltar al contenido
      </a>

      <aside className="sticky top-0 hidden h-dvh border-r border-line bg-surface lg:block">
        <Sidebar isOrgAdmin={isOrgAdmin} collapsed={collapsed} />
      </aside>

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navegación">
          <button
            type="button"
            aria-label="Cerrar navegación"
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-line bg-surface">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Cerrar navegación"
              className="absolute right-2 top-4 inline-flex size-9 items-center justify-center rounded-md hover:bg-surface-2"
            >
              <X className="size-5" aria-hidden />
            </button>
            <Sidebar isOrgAdmin={isOrgAdmin} onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col">
        <TopBar onOpenMenu={() => setDrawerOpen(true)} sidebarCollapsed={collapsed} onToggleSidebar={toggleCollapsed} />
        <main
          id="contenido"
          className={cn('mx-auto w-full flex-1 px-4 py-6 sm:px-6 lg:px-8', collapsed ? 'max-w-[1920px]' : 'max-w-[1440px]')}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
