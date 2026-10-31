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
  /** Solo para administradores y jefes de operaciones de alguna aerolínea. */
  staffOnly?: boolean;
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
      { label: 'Live Flights', icon: Radar, to: '/live' },
      { label: 'Flight Booking', icon: CalendarPlus, to: '/booking' },
      { label: 'My Flights', icon: PlaneTakeoff, to: '/my-flights' },
      { label: 'PIREP', icon: FileText, to: '/pireps' },
    ],
  },
  {
    label: 'Red y flota',
    items: [
      { label: 'Pilots', icon: Users, to: '/pilots' },
      { label: 'Airlines', icon: Building2, to: '/airlines' },
      { label: 'Fleet', icon: Plane, to: '/fleet' },
      { label: 'Routes', icon: Route, to: '/routes' },
      { label: 'Airports', icon: MapPin, to: '/airports' },
    ],
  },
  {
    label: 'Control',
    items: [
      { label: 'Statistics', icon: Activity, to: '/statistics' },
      { label: 'Operations Center', icon: Monitor, to: '/operations', staffOnly: true },
      { label: 'Administration', icon: ShieldCheck, to: '/administration', adminOnly: true },
      { label: 'Settings', icon: Settings, to: '/settings' },
    ],
  },
];
