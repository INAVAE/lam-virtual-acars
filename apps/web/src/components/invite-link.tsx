import { Check, Link2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

/** Liga completa a una pantalla de la web (con la base de GitHub Pages). */
export function appUrl(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${window.location.origin}${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Copia la liga de invitación a un tour, evento o entrenamiento. La liga solo
 * abre con sesión de una cuenta activa: sin sesión pide entrar y después lleva
 * a la página; una cuenta revocada no entra.
 */
export function InviteLinkButton({ path, what }: { path: string; what: string }) {
  const url = appUrl(path);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        title="Solo la abren pilotos con cuenta activa en LAM"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
            toast.success(`Liga de invitación al ${what} copiada. Solo la abren pilotos con cuenta activa en LAM.`);
          } catch {
            setManual(true);
          }
        }}
      >
        {copied ? <Check className="size-4" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
        {copied ? 'Liga copiada' : 'Copiar liga de invitación'}
      </Button>
      {manual ? (
        <Dialog open onClose={() => setManual(false)} title="Liga de invitación" description="Cópiala y compártela. Solo la abren pilotos con cuenta activa en LAM.">
          <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} autoFocus className="font-mono text-sm" aria-label="Liga de invitación" />
        </Dialog>
      ) : null}
    </>
  );
}
