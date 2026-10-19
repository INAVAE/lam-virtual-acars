export function ConfigMissingPage({ missing }: { missing: string[] }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-5">
      <h1 className="font-display text-3xl font-semibold">Falta configurar la conexión con Supabase</h1>
      <p className="text-muted">
        Esta versión del sitio se publicó sin las variables necesarias. Agrégalas en la configuración del repositorio
        (Settings, Secrets and variables, Actions, pestaña Variables) y vuelve a publicar.
      </p>
      <ul className="list-disc pl-5 font-mono text-sm">
        {missing.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </main>
  );
}
