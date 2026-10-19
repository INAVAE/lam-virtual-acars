import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { UtcClock } from '@/components/layout/utc-clock';

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** Pantallas de acceso: a la izquierda el reloj Zulu, a la derecha el formulario. */
export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)]">
      <aside className="relative hidden overflow-hidden border-r border-line bg-surface lg:flex lg:flex-col lg:justify-between lg:p-10">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07]">
          <svg className="h-full w-full" viewBox="0 0 800 800" preserveAspectRatio="xMidYMid slice">
            <circle cx="400" cy="400" r="120" fill="none" stroke="currentColor" />
            <circle cx="400" cy="400" r="240" fill="none" stroke="currentColor" />
            <circle cx="400" cy="400" r="360" fill="none" stroke="currentColor" />
            <path d="M400 0V800M0 400H800" stroke="currentColor" />
          </svg>
        </div>
        <Link to="/bienvenida" className="relative font-display text-xl font-semibold">
          LAM Virtual ACARS
        </Link>
        <UtcClock size="lg" className="relative items-start" />
        <p className="relative max-w-md text-muted">
          Operaciones de las aerolíneas virtuales de Líneas Aéreas Mexicanas en Microsoft Flight Simulator 2024.
        </p>
      </aside>

      <main className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <Link to="/bienvenida" className="mb-8 block font-display text-lg font-semibold lg:hidden">
            LAM Virtual ACARS
          </Link>
          <h1 className="font-display text-3xl font-semibold leading-tight">{title}</h1>
          {subtitle ? <p className="mt-2 text-muted">{subtitle}</p> : null}
          <div className="mt-8">{children}</div>
          {footer ? <div className="mt-8 border-t border-line pt-5 text-sm text-muted">{footer}</div> : null}
        </div>
      </main>
    </div>
  );
}
