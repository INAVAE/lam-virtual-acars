import { Link } from 'react-router';
import { UtcClock } from '@/components/layout/utc-clock';
import { Skeleton } from '@/components/ui/skeleton';
import { useAirlines } from '@/hooks/use-lam-data';
import { useAuth } from '@/lib/auth';

const linkPrimary =
  'inline-flex h-11 items-center rounded-md bg-brand px-5 font-medium text-white transition-[filter] hover:brightness-110';
const linkSecondary =
  'inline-flex h-11 items-center rounded-md border border-line px-5 font-medium transition-colors hover:border-muted';

/** Página pública para visitantes: qué es LAM y qué aerolíneas operan. */
export function PublicHomePage() {
  const { user } = useAuth();
  const airlines = useAirlines();
  const active = (airlines.data ?? []).filter((a) => a.is_active);

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5">
        <span className="font-display text-lg font-semibold">LAM Virtual ACARS</span>
        <UtcClock />
      </header>

      <main className="mx-auto max-w-6xl px-5 pb-16">
        <section className="grid gap-10 border-b border-line py-12 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-end lg:py-20">
          <div>
            <h1 className="font-display text-5xl font-semibold leading-[1.02] tracking-tight sm:text-7xl">
              Líneas Aéreas
              <br />
              Mexicanas
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted">
              Reserva vuelos, vuela en Microsoft Flight Simulator 2024 y deja que el ACARS registre tu operación y genere
              el PIREP. Una cuenta, varias aerolíneas virtuales.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {user ? (
                <Link to="/" className={linkPrimary}>
                  Ir al dashboard
                </Link>
              ) : (
                <>
                  <Link to="/registro" className={linkPrimary}>
                    Crear cuenta de piloto
                  </Link>
                  <Link to="/entrar" className={linkSecondary}>
                    Iniciar sesión
                  </Link>
                </>
              )}
            </div>
          </div>
          <UtcClock size="lg" className="lg:items-end" />
        </section>

        <section aria-labelledby="aerolineas" className="py-10">
          <h2 id="aerolineas" className="font-display text-2xl font-semibold">
            Aerolíneas en operación
          </h2>
          {airlines.isPending ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          ) : airlines.isError ? (
            <p className="mt-3 text-danger-ink">No se pudo cargar la lista de aerolíneas.</p>
          ) : active.length === 0 ? (
            <p className="mt-3 max-w-prose text-muted">
              Las aerolíneas de LAM se están configurando. Crea tu cuenta ahora y podrás solicitar ingreso en cuanto
              abran.
            </p>
          ) : (
            <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {active.map((a) => (
                <li key={a.id} className="rounded-lg border border-line bg-surface p-4" style={{ borderTopColor: a.brand_primary_color, borderTopWidth: 3 }}>
                  <p className="font-mono text-2xl">{a.icao_code}</p>
                  <p className="mt-1 font-medium">{a.name}</p>
                  {a.is_unofficial_brand ? <p className="mt-1 text-sm text-muted">Operación virtual no oficial</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer className="border-t border-line">
        <p className="mx-auto max-w-6xl px-5 py-6 text-sm text-muted">
          LAM Virtual ACARS es un proyecto de simulación. Las aerolíneas basadas en marcas reales son operaciones virtuales
          no oficiales y no tienen relación con esas compañías.
        </p>
      </footer>
    </div>
  );
}
