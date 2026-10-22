import { useState, type ReactNode } from 'react';
import { Button, type ButtonProps } from './ui/button';
import { Dialog } from './ui/dialog';

interface ConfirmButtonProps extends Omit<ButtonProps, 'onClick'> {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<unknown> | void;
}

/** Botón que pide confirmación en una ventana antes de una acción destructiva. */
export function ConfirmButton({ title, message, confirmLabel, onConfirm, children, ...buttonProps }: ConfirmButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
      setOpen(false);
    } catch {
      // Quien llama ya mostró el error; la ventana sigue abierta para reintentar.
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button {...buttonProps} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <Dialog
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={title}
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button variant="danger" loading={busy} onClick={confirm}>
              {confirmLabel}
            </Button>
          </>
        }
      >
        <div className="text-[15px]">{message}</div>
      </Dialog>
    </>
  );
}
