import { Award } from 'lucide-react';
import { logoUrl } from '@/components/airline-logo';
import { Panel } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { usePilotBadges } from '@/hooks/use-tours';
import { cn } from '@/lib/cn';
import { readableTextOn } from '@/lib/color';
import { useTimePrefs } from '@/lib/time-context';

const sizes = { sm: 'size-10 text-[9px]', md: 'size-16 text-[11px]', lg: 'size-28 text-sm' } as const;

/** Insignia del tour: la imagen que subió el creador o, sin imagen, un emblema con el código y el color del tour. */
export function TourBadge({
  code,
  color,
  badgePath,
  size = 'md',
  muted = false,
  className,
}: {
  code: string;
  color: string;
  badgePath: string | null;
  size?: keyof typeof sizes;
  muted?: boolean;
  className?: string;
}) {
  const src = badgePath?.startsWith('blob:') ? badgePath : logoUrl(badgePath);
  return (
    <span
      className={cn('relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full border-2', sizes[size], muted && 'opacity-45 grayscale', className)}
      style={{ borderColor: color, background: src ? '#ffffff' : color, color: readableTextOn(color) }}
      title={`Insignia del tour ${code}`}
    >
      {src ? (
        <img src={src} alt={`Insignia del tour ${code}`} className="size-full object-cover" loading="lazy" />
      ) : (
        <span className="flex flex-col items-center leading-tight">
          <Award className="size-[40%]" aria-hidden />
          <span className="whitespace-nowrap font-mono font-semibold" style={code.length > 6 ? { fontSize: '0.78em' } : undefined}>
            {code}
          </span>
        </span>
      )}
    </span>
  );
}

/** Insignias ganadas por el piloto: tours terminados con todos los legs aceptados. */
export function PilotBadgesPanel({ userId, title = 'Insignias' }: { userId?: string; title?: string }) {
  const badges = usePilotBadges(userId);
  const { dual } = useTimePrefs();
  return (
    <Panel title={title} description="Se ganan al terminar un tour con todos sus legs aceptados.">
      {badges.isPending ? (
        <Skeleton className="h-24" />
      ) : !badges.data || badges.data.length === 0 ? (
        <p className="text-sm text-muted">Todavía no hay insignias. Inscríbete en un tour y vuela todos sus legs para ganar la primera.</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4">
          {badges.data.map((b) => (
            <li key={b.tour_id} className="flex flex-col items-center gap-2 text-center">
              <TourBadge code={b.code} color={b.color} badgePath={b.badge_path} size="lg" />
              <span>
                <span className="block font-medium leading-tight">{b.name}</span>
                <span className="block text-xs text-muted">
                  {b.code} · {b.legs} legs · {dual(b.awarded_at, { withDate: true }).primary}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
