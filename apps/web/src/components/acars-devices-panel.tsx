import { Monitor } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/confirm-button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useApproveAcarsLink, useMyAcarsDevices, useRevokeAcarsDevice } from '@/hooks/use-acars';
import { describeError } from '@/lib/errors';
import { formatLocalDateTime } from '@/lib/format';

/** Código que muestra el conector: 8 caracteres sin I, O, 0 ni 1 (se acepta con o sin guion). */
export function normalizeLinkCode(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export const LINK_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

function LinkForm() {
  const approve = useApproveAcarsLink();
  const [code, setCode] = useState('');
  const [touched, setTouched] = useState(false);
  const normalized = normalizeLinkCode(code);
  const error = touched && !LINK_CODE_PATTERN.test(normalized) ? 'Escribe los 8 caracteres que muestra el conector' : undefined;
  const hint = 'Abre LAM ACARS en tu PC, elige Vincular y escribe aquí el código que aparece. Vence en 10 minutos.';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!LINK_CODE_PATTERN.test(normalized)) return;
    try {
      const name = await approve.mutateAsync(normalized);
      toast.success(`${name} quedó vinculado. El conector se conectará en unos segundos.`);
      setCode('');
      setTouched(false);
    } catch (err) {
      toast.error(describeError(err));
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
      <div className="w-full max-w-xs">
        <Field id="acars-code" label="Código de vinculación" error={error} hint={hint}>
          <Input
            className="font-mono text-lg uppercase tracking-[0.2em]"
            placeholder="K7QF-2M9P"
            maxLength={9}
            autoComplete="off"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onBlur={() => setTouched(true)}
            {...fieldAria('acars-code', error, hint)}
          />
        </Field>
      </div>
      <Button type="submit" loading={approve.isPending} className="mb-[1.6rem]">
        Vincular equipo
      </Button>
    </form>
  );
}

export function AcarsDevicesPanel() {
  const devices = useMyAcarsDevices();
  const revoke = useRevokeAcarsDevice();
  const active = (devices.data ?? []).filter((d) => !d.revoked_at);
  const revoked = (devices.data ?? []).filter((d) => d.revoked_at);

  return (
    <div className="space-y-5">
      <LinkForm />

      {devices.isError ? <Alert tone="danger">{describeError(devices.error)}</Alert> : null}
      {devices.isPending ? (
        <Skeleton className="h-24" />
      ) : active.length === 0 ? (
        <p className="text-sm text-muted">No tienes equipos vinculados.</p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {active.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <Monitor className="size-5 shrink-0 text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{d.name}</p>
                <p className="text-xs text-muted">
                  <span className="font-mono">{d.token_prefix}…</span>
                  {d.app_version ? ` · versión ${d.app_version}` : ''} · vinculado el {formatLocalDateTime(d.created_at)} ·{' '}
                  {d.last_used_at ? `último uso ${formatLocalDateTime(d.last_used_at)}` : 'sin uso'}
                </p>
              </div>
              <ConfirmButton
                size="sm"
                variant="danger"
                title={`Revocar ${d.name}`}
                message="El conector de ese equipo deja de enviar datos en su siguiente envío. Para volver a usarlo tendrás que vincularlo de nuevo."
                confirmLabel="Revocar"
                onConfirm={async () => {
                  try {
                    await revoke.mutateAsync(d.id);
                    toast.success('Dispositivo revocado');
                  } catch (error) {
                    toast.error(describeError(error));
                    throw error;
                  }
                }}
              >
                Revocar
              </ConfirmButton>
            </li>
          ))}
        </ul>
      )}

      {revoked.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Revocados ({revoked.length})</summary>
          <ul className="mt-2 space-y-1">
            {revoked.map((d) => (
              <li key={d.id} className="flex items-center gap-2 text-muted">
                <Badge>Revocado</Badge>
                {d.name} · {formatLocalDateTime(d.revoked_at!)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
