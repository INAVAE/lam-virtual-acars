import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-5 text-center">
      <p className="font-mono text-6xl text-muted">404</p>
      <h1 className="font-display text-2xl font-semibold">Esta página no existe</h1>
      <p className="max-w-md text-muted">Revisa la dirección o vuelve al inicio.</p>
      <Link to="/" className="font-medium underline underline-offset-4">
        Volver al inicio
      </Link>
    </main>
  );
}
