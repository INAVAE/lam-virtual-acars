import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, CircleHelp, IdCard, KeyRound, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Settings, Sun, UserRound } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Select } from '@/components/ui/input';
import { Avatar } from '@/components/avatar';
import { useAirlines, useMyMemberships, useProfile } from '@/hooks/use-lam-data';
import { useCanHandleTickets, useTicketInboxCount } from '@/hooks/use-support';
import { useAirlineScope } from '@/lib/airline-scope';
import { describeError } from '@/lib/errors';
import { useAuth } from '@/lib/auth';
import { formatLocalDateTime, formatPilotNumber, formatRoles } from '@/lib/format';
import { getSupabase } from '@/lib/supabase';
import { cn } from '@/lib/cn';
import { useTheme } from '@/lib/theme';
import { UtcClock } from './utc-clock';

const ALL_AIRLINES = '__all__';

function AirlineSwitcher() {
  const { options, selected, canSeeAll, select, ready } = useAirlineScope();
  const id = useId();

  if (!ready) return <div className="h-9 w-52 animate-pulse rounded-md bg-surface-2" aria-hidden />;
  if (options.length === 0 && !canSeeAll) {
    return <p className="text-sm text-muted">Sin aerolínea asignada</p>;
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span aria-hidden className="size-3 shrink-0 rounded-full bg-accent ring-2 ring-surface-2" />
      <label htmlFor={id} className="sr-only">
        Aerolínea
      </label>
      <Select
        id={id}
        className="h-9 w-auto min-w-0 max-w-[22rem] bg-surface"
        value={selected?.id ?? ALL_AIRLINES}
        onChange={(e) => select(e.target.value === ALL_AIRLINES ? null : e.target.value)}
      >
        {canSeeAll ? <option value={ALL_AIRLINES}>LAM, todas las aerolíneas</option> : null}
        {options.map((airline) => (
          <option key={airline.id} value={airline.id}>
            {airline.name}
            {airline.icao_code ? ` (${airline.icao_code})` : ''}
            {airline.is_active ? '' : ' (inactiva)'}
          </option>
        ))}
      </Select>
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className="inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
    >
      {theme === 'dark' ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
    </button>
  );
}

/** Ayuda: manual, preguntas frecuentes y reporte de incidencias. Para el staff, con los reportes sin revisar. */
function HelpButton() {
  const location = useLocation();
  const canHandle = useCanHandleTickets();
  const pending = useTicketInboxCount(canHandle).data ?? 0;
  const active = location.pathname === '/help';
  const label = pending > 0 ? `Ayuda: ${pending} reportes sin revisar` : 'Ayuda: manual, preguntas frecuentes y reporte de incidencias';
  return (
    <Link
      to={pending > 0 ? '/help?tab=inbox' : '/help'}
      state={active ? location.state : { from: `${location.pathname}${location.search}` }}
      aria-label={label}
      title={label}
      className={cn(
        'relative inline-flex size-9 items-center justify-center rounded-md hover:bg-surface-2 hover:text-ink',
        active ? 'bg-surface-2 text-ink' : 'text-muted',
      )}
    >
      <CircleHelp className="size-[18px]" aria-hidden />
      {pending > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-white">
          {pending > 99 ? '99+' : pending}
        </span>
      ) : null}
    </Link>
  );
}

function MenuItem({
  to,
  icon: Icon,
  label,
  hint,
  onClick,
}: {
  to: string;
  icon: typeof UserRound;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <Link role="menuitem" to={to} onClick={onClick} className="flex items-start gap-2.5 rounded px-2.5 py-2 hover:bg-surface-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </Link>
  );
}

/** Menú de la cuenta: quién eres, tu perfil, tus datos, tu contraseña y cerrar sesión. */
function UserMenu() {
  const profile = useProfile();
  const memberships = useMyMemberships();
  const airlines = useAirlines();
  const { isOrgAdmin } = useAirlineScope();
  const { session } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function signOut() {
    setSigningOut(true);
    const { error } = await getSupabase().auth.signOut();
    setSigningOut(false);
    if (error) {
      toast.error(describeError(error));
      return;
    }
    queryClient.clear();
    navigate('/bienvenida', { replace: true });
  }

  const p = profile.data;
  const name = p?.display_name ?? '…';
  const number = p ? formatPilotNumber(p.pilot_number) : '';
  const airlineName = new Map((airlines.data ?? []).map((a) => [a.id, a.icao_code ?? a.name]));
  const active = (memberships.data ?? []).filter((m) => m.status === 'active');
  const roleLine = isOrgAdmin
    ? 'Superadministrador'
    : active.length > 0
      ? active.map((m) => `${formatRoles(m.roles)} · ${airlineName.get(m.airline_id) ?? ''}`).join(' / ')
      : 'Sin aerolínea';
  const close = () => setOpen(false);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Tu cuenta: ${name}`}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 items-center gap-2 rounded-md px-1.5 hover:bg-surface-2"
      >
        <Avatar name={p?.display_name} url={p?.avatar_url} size="xs" />
        <span className="hidden text-left leading-tight sm:block">
          <span className="block max-w-[10rem] truncate text-sm font-medium">{name}</span>
          <span className="block font-mono text-xs text-muted">{number}</span>
        </span>
        <ChevronDown className="size-4 text-muted" aria-hidden />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Tu cuenta"
          className="absolute right-0 z-40 mt-1 w-80 max-w-[calc(100vw-1.5rem)] rounded-md border border-line bg-surface p-1 shadow-lg shadow-black/20"
        >
          <div className="flex items-center gap-3 border-b border-line px-2.5 pb-3 pt-2">
            <Avatar name={p?.display_name} url={p?.avatar_url} size="md" />
            <div className="min-w-0">
              <p className="truncate font-medium">{name}</p>
              <p className="truncate text-xs text-muted">{p?.email ?? session?.user.email}</p>
              <p className="mt-1 text-xs">
                <span className="font-mono">{number}</span> · <span className="text-muted">{roleLine}</span>
              </p>
            </div>
          </div>
          {session?.user.last_sign_in_at ? (
            <p className="flex justify-between px-2.5 py-2 text-xs text-muted">
              <span>Sesión iniciada</span>
              <span className="text-ink">{formatLocalDateTime(session.user.last_sign_in_at)}</span>
            </p>
          ) : null}
          <div className="border-t border-line pt-1">
            {p ? (
              <MenuItem to={`/pilots/${p.pilot_number}`} icon={IdCard} label="Mi perfil de piloto" hint="Estadísticas, historial e insignias" onClick={close} />
            ) : null}
            <MenuItem to="/account" icon={UserRound} label="Mi cuenta" hint="Datos personales y foto" onClick={close} />
            <MenuItem to="/account?tab=security" icon={KeyRound} label="Contraseña y sesiones" hint="Cambia tu contraseña o cierra otras sesiones" onClick={close} />
            <MenuItem to="/settings" icon={Settings} label="Settings" hint="SimBrief, hora local y conector LAM ACARS" onClick={close} />
          </div>
          <div className="mt-1 border-t border-line pt-1">
            <button
              role="menuitem"
              type="button"
              disabled={signingOut}
              onClick={signOut}
              className="flex w-full items-start gap-2.5 rounded px-2.5 py-2 text-left hover:bg-surface-2 disabled:opacity-60"
            >
              <LogOut className="mt-0.5 size-4 shrink-0 text-danger-ink" aria-hidden />
              <span>
                <span className="block text-sm">{signingOut ? 'Cerrando sesión…' : 'Cerrar sesión'}</span>
                <span className="block text-xs text-muted">Se cierra también en las demás pestañas</span>
              </span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function TopBar({
  onOpenMenu,
  sidebarCollapsed,
  onToggleSidebar,
}: {
  onOpenMenu: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const sidebarLabel = sidebarCollapsed ? 'Mostrar el menú lateral' : 'Ocultar el menú lateral';
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg/90 px-3 backdrop-blur sm:px-5">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Abrir navegación"
        className="inline-flex size-9 items-center justify-center rounded-md hover:bg-surface-2 lg:hidden"
      >
        <Menu className="size-5" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label={sidebarLabel}
        aria-pressed={sidebarCollapsed}
        title={sidebarLabel}
        className="hidden size-9 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink lg:inline-flex"
      >
        {sidebarCollapsed ? <PanelLeftOpen className="size-5" aria-hidden /> : <PanelLeftClose className="size-5" aria-hidden />}
      </button>
      <AirlineSwitcher />
      <div className="ml-auto flex items-center gap-1 sm:gap-3">
        <UtcClock className="hidden md:flex" />
        <HelpButton />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
