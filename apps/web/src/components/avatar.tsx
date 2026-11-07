import { cn } from '@/lib/cn';

const sizes = { xs: 'size-7 text-[11px]', sm: 'size-9 text-xs', md: 'size-12 text-sm', lg: 'size-24 text-2xl' } as const;

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts[0]![0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '')).toUpperCase();
}

/** Foto de perfil o, sin foto, las iniciales del nombre. */
export function Avatar({
  name,
  url,
  size = 'sm',
  className,
}: {
  name: string | null | undefined;
  url?: string | null;
  size?: keyof typeof sizes;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-accent/15 font-semibold text-accent ring-1 ring-line',
        sizes[size],
        className,
      )}
      aria-hidden
    >
      {url ? <img src={url} alt="" className="size-full object-cover" loading="lazy" decoding="async" /> : initials(name)}
    </span>
  );
}
