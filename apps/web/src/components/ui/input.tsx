import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const fieldBase =
  'h-10 w-full rounded-md border border-line bg-bg px-3 text-[15px] text-ink placeholder:text-muted/70 transition-colors focus-visible:border-cyan focus-visible:outline-none aria-[invalid=true]:border-danger disabled:opacity-60';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldBase, 'pr-8', className)} {...props}>
      {children}
    </select>
  );
}
