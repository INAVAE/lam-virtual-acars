import type { TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'min-h-20 w-full rounded-md border border-line bg-bg px-3 py-2 text-[15px] text-ink placeholder:text-muted/70 focus-visible:border-cyan focus-visible:outline-none aria-[invalid=true]:border-danger disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}
