import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, LogOut, Menu, Moon, Sun, UserRound } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Select } from '@/components/ui/input';
import { useProfile } from '@/hooks/use-lam-data';
import { useAirlineScope } from '@/lib/airline-scope';
import { describeError } from '@/lib/errors';
import { formatPilotNumber } from '@/lib/format';
import { getSupabase } from '@/lib/supabase';
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

function UserMenu() {
  const profile = useProfile();
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

  const name = profile.data?.display_name ?? '…';
  const number = profile.data ? formatPilotNumber(profile.data.pilot_number) : '';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 items-center gap-2 rounded-md px-2 hover:bg-surface-2"
      >
        <UserRound className="size-4 text-muted" aria-hidden />
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
          className="absolute right-0 z-40 mt-1 w-56 rounded-md border border-line bg-surface p-1 shadow-lg shadow-black/20"
        >
          <Link
            role="menuitem"
            to="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded px-2.5 py-2 text-sm hover:bg-surface-2"
          >
            <UserRound className="size-4" aria-hidden />
            Mi perfil y seguridad
          </Link>
          <button
            role="menuitem"
            type="button"
            disabled={signingOut}
            onClick={signOut}
            className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm hover:bg-surface-2 disabled:opacity-60"
          >
            <LogOut className="size-4" aria-hidden />
            {signingOut ? 'Cerrando sesión…' : 'Cerrar sesión'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function TopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
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
      <AirlineSwitcher />
      <div className="ml-auto flex items-center gap-1 sm:gap-3">
        <UtcClock className="hidden md:block" />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
