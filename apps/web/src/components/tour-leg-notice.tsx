import { Flag } from 'lucide-react';
import { Link } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import type { MyTourLeg } from '@/lib/tours';

/**
 * Aviso en Flight Booking: la ruta coincide con un leg que le falta al piloto en
 * un tour donde está inscrito. Un vuelo normal no cuenta para el tour; solo el
 * que se reserva desde el tour.
 */
export function TourLegNotice({ legs, className }: { legs: readonly MyTourLeg[]; className?: string }) {
  if (legs.length === 0) return null;
  return (
    <Alert className={className}>
      <span className="block">
        <strong>Esta ruta es un leg de tour.</strong> Reservada aquí es un vuelo normal y no cuenta para el tour. Para que cuente, resérvala
        desde el tour con «Reservar leg».
      </span>
      <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {legs.map((l) => (
          <Link key={l.leg_id} to={`/tours/${l.tour_id}`} className="font-medium text-cyan underline-offset-2 hover:underline">
            {`${l.state === 'booked' ? 'Ya reservado: leg' : 'Ir al leg'} ${l.leg_number} de ${l.code}`}
          </Link>
        ))}
      </span>
    </Alert>
  );
}

/** Etiqueta corta para la fila de una ruta que coincide con un leg de tour. */
export function TourLegBadge({ legs }: { legs: readonly MyTourLeg[] }) {
  const first = legs[0];
  if (!first) return null;
  return (
    <Link to={`/tours/${first.tour_id}`} title="Reservada aquí no cuenta para el tour; resérvala desde el tour" className="inline-flex">
      <Badge tone="info">
        <Flag className="size-3" aria-hidden />
        {`Leg ${first.leg_number} de ${first.code}`}
      </Badge>
    </Link>
  );
}
