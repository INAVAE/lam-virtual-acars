import type { Airline } from '@/hooks/use-lam-data';
import { readableTextOn, safeAccent } from '@/lib/color';
import { cn } from '@/lib/cn';

/**
 * URL pública de un logotipo. En la Fase 1 los logotipos viven en
 * apps/web/public; en la Fase 2 pasarán a Supabase Storage con la misma ruta.
 */
export function logoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;
}

const sizes = {
  sm: 'size-7 rounded-md text-[10px]',
  md: 'size-11 rounded-lg text-xs',
  lg: 'size-20 rounded-xl text-lg',
} as const;

type LogoAirline = Pick<Airline, 'name' | 'icao_code' | 'logo_path' | 'brand_primary_color'>;

/**
 * Logotipo de la aerolínea sobre un recuadro blanco (los emblemas están
 * diseñados sobre blanco). Sin logotipo, muestra el código ICAO sobre su color.
 */
export function AirlineLogo({ airline, size = 'md', className }: { airline: LogoAirline; size?: keyof typeof sizes; className?: string }) {
  const src = logoUrl(airline.logo_path);
  if (src) {
    return (
      <span className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden bg-white ring-1 ring-black/5', sizes[size], className)}>
        <img src={src} alt={`Logotipo de ${airline.name}`} className="size-full object-contain" loading="lazy" decoding="async" />
      </span>
    );
  }
  const color = safeAccent(airline.brand_primary_color);
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center font-mono font-medium tracking-wider', sizes[size], className)}
      style={{ backgroundColor: color, color: readableTextOn(color) }}
    >
      {airline.icao_code ?? '···'}
    </span>
  );
}
