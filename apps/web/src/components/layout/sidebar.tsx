import { NavLink } from 'react-router';
import { useMyMemberships } from '@/hooks/use-lam-data';
import { cn } from '@/lib/cn';
import { navigation, type NavItem } from './navigation';

function LamMark() {
  return (
    <span className="inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white">
      <img
        src={`${import.meta.env.BASE_URL}airlines/lineas-aereas-mexicanas.png`}
        alt=""
        className="size-full object-contain"
      />
    </span>
  );
}

function Item({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const Icon = item.icon;
  const base = 'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[15px]';

  if (!item.to) {
    return (
      <li>
        <span
          aria-disabled="true"
          title={`Disponible en la Fase ${item.phase}`}
          className={cn(base, 'cursor-default text-muted/70')}
        >
          <Icon className="size-4 shrink-0" aria-hidden />
          <span className="flex-1 truncate">{item.label}</span>
          <span className="text-xs tabular-nums text-muted/80">Fase {item.phase}</span>
        </span>
      </li>
    );
  }

  return (
    <li>
      <NavLink
        to={item.to}
        end={item.to === '/'}
        onClick={onNavigate}
        className={({ isActive }) =>
          cn(
            base,
            'transition-colors',
            isActive
              ? 'bg-surface-2 font-medium text-ink shadow-[inset_3px_0_0_var(--accent)]'
              : 'text-ink/85 hover:bg-surface-2 hover:text-ink',
          )
        }
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{item.label}</span>
      </NavLink>
    </li>
  );
}

export function Sidebar({ isOrgAdmin, onNavigate }: { isOrgAdmin: boolean; onNavigate?: () => void }) {
  const memberships = useMyMemberships();
  // El Operations Center se muestra a quien supervisa alguna aerolínea; la base de datos aplica el permiso real.
  const isStaff =
    isOrgAdmin ||
    (memberships.data ?? []).some((m) => m.status === 'active' && m.roles.some((r) => r === 'airline_admin' || r === 'ops_chief'));
  return (
    <nav aria-label="Navegación principal" className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 pb-4 pt-5">
        <LamMark />
        <div className="leading-tight">
          <p className="font-display text-lg font-semibold">LAM Virtual ACARS</p>
          <p className="text-xs text-muted">Líneas Aéreas Mexicanas</p>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-2 pb-4">
        {navigation.map((group) => {
          const items = group.items.filter((item) => (!item.adminOnly || isOrgAdmin) && (!item.staffOnly || isStaff));
          return (
            <div key={group.label}>
              <p className="px-2.5 pb-1 text-sm text-muted">{group.label}</p>
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <Item key={item.label} item={item} onNavigate={onNavigate} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="border-t border-line px-4 py-3 text-xs leading-snug text-muted">
        Simulación para Microsoft Flight Simulator 2024. Las aerolíneas basadas en marcas reales son operaciones
        virtuales no oficiales.
      </p>
    </nav>
  );
}
