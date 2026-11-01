import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { describeError } from '@/lib/errors';

/** Rechazar con motivo (publicación de un tour o evento, o una inscripción). */
export function RejectDialog({ title, onClose, onReject }: { title: string; onClose: () => void; onReject: (comment: string) => Promise<void> }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await onReject(comment.trim());
      onClose();
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" loading={busy} disabled={comment.trim().length === 0} onClick={() => void submit()}>
            Rechazar
          </Button>
        </>
      }
    >
      <Field id="reject-comment" label="Motivo" hint="Lo verá quien lo envió.">
        <Textarea id="reject-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
      </Field>
    </Dialog>
  );
}
