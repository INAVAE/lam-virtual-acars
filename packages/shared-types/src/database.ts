/**
 * Tipos de la base de datos de LAM Virtual ACARS.
 *
 * Escritos a mano a partir de supabase/migrations para la Fase 1.
 * Regenerar con `supabase gen types typescript` cuando cambie el esquema
 * y comparar con este archivo antes de reemplazarlo.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type OrgRole = 'superadmin';
export type AirlineRole = 'airline_admin' | 'ops_chief' | 'pilot';
export type MembershipStatus = 'pending' | 'active' | 'suspended' | 'rejected';
export type AccountStatus = 'active' | 'suspended';
export type AirlineNetwork = 'IVAO' | 'VATSIM' | 'OFFLINE';

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          slug: string;
          name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
        };
        Relationships: [];
      };
      airlines: {
        Row: {
          id: string;
          organization_id: string;
          slug: string;
          name: string;
          icao_code: string | null;
          iata_code: string | null;
          radio_callsign: string | null;
          description: string | null;
          brand_primary_color: string;
          brand_secondary_color: string | null;
          logo_path: string | null;
          is_unofficial_brand: boolean;
          is_active: boolean;
          network: AirlineNetwork;
          flight_plan_remarks: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          slug: string;
          name: string;
          icao_code?: string | null;
          iata_code?: string | null;
          radio_callsign?: string | null;
          description?: string | null;
          brand_primary_color?: string;
          brand_secondary_color?: string | null;
          logo_path?: string | null;
          is_unofficial_brand?: boolean;
          is_active?: boolean;
          network?: AirlineNetwork;
          flight_plan_remarks?: string | null;
        };
        Update: {
          name?: string;
          icao_code?: string | null;
          iata_code?: string | null;
          radio_callsign?: string | null;
          description?: string | null;
          brand_primary_color?: string;
          brand_secondary_color?: string | null;
          logo_path?: string | null;
          is_unofficial_brand?: boolean;
          is_active?: boolean;
          network?: AirlineNetwork;
          flight_plan_remarks?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          pilot_number: number;
          email: string;
          display_name: string;
          country_code: string | null;
          simbrief_username: string | null;
          primary_airline_id: string | null;
          account_status: AccountStatus;
          joined_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          display_name: string;
        };
        Update: {
          display_name?: string;
          country_code?: string | null;
          simbrief_username?: string | null;
          primary_airline_id?: string | null;
          account_status?: AccountStatus;
        };
        Relationships: [];
      };
      organization_members: {
        Row: {
          organization_id: string;
          user_id: string;
          role: OrgRole;
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          organization_id: string;
          user_id: string;
          role: OrgRole;
        };
        Update: {
          role?: OrgRole;
        };
        Relationships: [];
      };
      airline_memberships: {
        Row: {
          id: string;
          airline_id: string;
          user_id: string;
          roles: AirlineRole[];
          status: MembershipStatus;
          requested_at: string;
          decided_at: string | null;
          decided_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          airline_id: string;
          user_id: string;
          roles?: AirlineRole[];
          status?: MembershipStatus;
        };
        Update: {
          roles?: AirlineRole[];
          status?: MembershipStatus;
        };
        Relationships: [];
      };
      airline_settings: {
        Row: {
          airline_id: string;
          max_active_bookings: number;
          booking_expiry_hours: number;
          require_aircraft_at_origin: boolean;
          auto_approve_pireps: boolean;
          public_tracking: boolean;
          delay_tolerance_minutes: number;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          airline_id: string;
        };
        Update: {
          max_active_bookings?: number;
          booking_expiry_hours?: number;
          require_aircraft_at_origin?: boolean;
          auto_approve_pireps?: boolean;
          public_tracking?: boolean;
          delay_tolerance_minutes?: number;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: number;
          occurred_at: string;
          actor_id: string | null;
          airline_id: string | null;
          action: 'insert' | 'update' | 'delete';
          entity_type: string;
          entity_id: string;
          old_data: Json | null;
          new_data: Json | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      get_dashboard_summary: {
        Args: { p_airline_id?: string | null };
        Returns: Json;
      };
    };
    Enums: {
      org_role: OrgRole;
      airline_role: AirlineRole;
      membership_status: MembershipStatus;
      account_status: AccountStatus;
    };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicSchema = Database['public'];

export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row'];
export type TablesInsert<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Update'];

/** Respuesta de get_dashboard_summary. */
export interface DashboardSummary {
  scope: 'organization' | 'airline' | 'member';
  airlines_total: number;
  airlines_active: number;
  pilots_active_members: number;
  pending_requests: number;
  profiles_total: number | null;
}
