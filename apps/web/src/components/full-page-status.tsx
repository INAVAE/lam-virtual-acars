import { LoaderCircle } from 'lucide-react';

export function FullPageStatus({ message }: { message: string }) {
  return (
    <div role="status" className="flex min-h-dvh items-center justify-center gap-3 text-muted">
      <LoaderCircle className="size-5 animate-spin" aria-hidden />
      <span>{message}</span>
    </div>
  );
}
