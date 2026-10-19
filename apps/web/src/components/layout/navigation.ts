import {
  Activity,
  Building2,
  CalendarPlus,
  FileText,
  LayoutDashboard,
  MapPin,
  Monitor,
  Plane,
  PlaneTakeoff,
  Radar,
  Route,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  icon: LucideIcon;
  /** Ruta disponible hoy. Si falta, el módulo llega en `phase`. */
  to?: string;
  phase?: number;
  adminOnly?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const navigation: NavGroup[] = [
  {
    label: 'Operación',
    items: [
      { label: 'Dashboard', icon: LayoutDashboard, to: '/' },
      { label: 'Live Flights', icon: Radar, phase: 6 },
      { label: 'Flight Booking', icon: CalendarPlus, phase: 3 },
      { label: 'My Flights', icon: PlaneTakeoff, phase: 3 },
      { label: 'PIREP', icon: FileText, phase: 5 },
    ],
  },
  {
    label: 'Red y flota',
    items: [
      { label: 'Pilots', icon: Users, phase: 2 },
      { label: 'Airlines', icon: Building2, phase: 2 },
      { label: 'Fleet', icon: Plane, phase: 2 },
      { label: 'Routes', icon: Route, phase: 2 },
      { label: 'Airports', icon: MapPin, phase: 2 },
    ],
  },
  {
    label: 'Control',
    items: [
      { label: 'Statistics', icon: Activity, phase: 6 },
      { label: 'Operations Center', icon: Monitor, phase: 6 },
      { label: 'Administration', icon: ShieldCheck, phase: 2, adminOnly: true },
      { label: 'Settings', icon: Settings, to: '/settings' },
    ],
  },
];
