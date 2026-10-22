// Generado desde el proyecto Supabase fnsfgjtmwfiizofsjajm (supabase gen types).
// No editar a mano: regenerar después de cada migración.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      aircraft: {
        Row: {
          aircraft_type_id: number
          airline_id: string
          base_airport_id: number | null
          configuration: string | null
          created_at: string
          current_airport_id: number | null
          cycles: number
          fleet_number: string | null
          id: string
          last_flight_at: string | null
          notes: string | null
          operation_type: string
          registration: string
          status: Database["public"]["Enums"]["aircraft_status"]
          total_minutes: number
          updated_at: string
        }
        Insert: {
          aircraft_type_id: number
          airline_id: string
          base_airport_id?: number | null
          configuration?: string | null
          created_at?: string
          current_airport_id?: number | null
          cycles?: number
          fleet_number?: string | null
          id?: string
          last_flight_at?: string | null
          notes?: string | null
          operation_type?: string
          registration: string
          status?: Database["public"]["Enums"]["aircraft_status"]
          total_minutes?: number
          updated_at?: string
        }
        Update: {
          aircraft_type_id?: number
          airline_id?: string
          base_airport_id?: number | null
          configuration?: string | null
          created_at?: string
          current_airport_id?: number | null
          cycles?: number
          fleet_number?: string | null
          id?: string
          last_flight_at?: string | null
          notes?: string | null
          operation_type?: string
          registration?: string
          status?: Database["public"]["Enums"]["aircraft_status"]
          total_minutes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "aircraft_aircraft_type_id_fkey"
            columns: ["aircraft_type_id"]
            isOneToOne: false
            referencedRelation: "aircraft_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aircraft_airline_id_fkey"
            columns: ["airline_id"]
            isOneToOne: false
            referencedRelation: "airlines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aircraft_base_airport_id_fkey"
            columns: ["base_airport_id"]
            isOneToOne: false
            referencedRelation: "airports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aircraft_current_airport_id_fkey"
            columns: ["current_airport_id"]
            isOneToOne: false
            referencedRelation: "airports"
            referencedColumns: ["id"]
          },
        ]
      }
      aircraft_types: {
        Row: {
          created_at: string
          cruise_speed_kts: number | null
          engine_type: string
          icao_code: string
          id: number
          manufacturer: string
          max_cargo_kg: number | null
          max_passengers: number | null
          model: string
          updated_at: string
          wake_category: string
        }
        Insert: {
          created_at?: string
          cruise_speed_kts?: number | null
          engine_type: string
          icao_code: string
          id?: never
          manufacturer: string
          max_cargo_kg?: number | null
          max_passengers?: number | null
          model: string
          updated_at?: string
          wake_category: string
        }
        Update: {
          created_at?: string
          cruise_speed_kts?: number | null
          engine_type?: string
          icao_code?: string
          id?: never
          manufacturer?: string
          max_cargo_kg?: number | null
          max_passengers?: number | null
          model?: string
          updated_at?: string
          wake_category?: string
        }
        Relationships: []
      }
      airline_memberships: {
        Row: {
          airline_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          requested_at: string
          roles: Database["public"]["Enums"]["airline_role"][]
          status: Database["public"]["Enums"]["membership_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          airline_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          requested_at?: string
          roles?: Database["public"]["Enums"]["airline_role"][]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          airline_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          requested_at?: string
          roles?: Database["public"]["Enums"]["airline_role"][]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "airline_memberships_airline_id_fkey"
            columns: ["airline_id"]
            isOneToOne: false
            referencedRelation: "airlines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "airline_memberships_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "airline_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      airline_settings: {
        Row: {
          airline_id: string
          auto_approve_pireps: boolean
          booking_expiry_hours: number
          delay_tolerance_minutes: number
          max_active_bookings: number
          public_tracking: boolean
          require_aircraft_at_origin: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          airline_id: string
          auto_approve_pireps?: boolean
          booking_expiry_hours?: number
          delay_tolerance_minutes?: number
          max_active_bookings?: number
          public_tracking?: boolean
          require_aircraft_at_origin?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          airline_id?: string
          auto_approve_pireps?: boolean
          booking_expiry_hours?: number
          delay_tolerance_minutes?: number
          max_active_bookings?: number
          public_tracking?: boolean
          require_aircraft_at_origin?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "airline_settings_airline_id_fkey"
            columns: ["airline_id"]
            isOneToOne: true
            referencedRelation: "airlines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "airline_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      airlines: {
        Row: {
          brand_primary_color: string
          brand_secondary_color: string | null
          created_at: string
          description: string | null
          flight_plan_remarks: string | null
          iata_code: string | null
          icao_code: string | null
          id: string
          is_active: boolean
          is_unofficial_brand: boolean
          logo_path: string | null
          name: string
          network: string
          operation_type: string
          organization_id: string
          radio_callsign: string | null
          slug: string
          updated_at: string
          website_url: string | null
        }
        Insert: {
          brand_primary_color?: string
          brand_secondary_color?: string | null
          created_at?: string
          description?: string | null
          flight_plan_remarks?: string | null
          iata_code?: string | null
          icao_code?: string | null
          id?: string
          is_active?: boolean
          is_unofficial_brand?: boolean
          logo_path?: string | null
          name: string
          network?: string
          operation_type?: string
          organization_id: string
          radio_callsign?: string | null
          slug: string
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          brand_primary_color?: string
          brand_secondary_color?: string | null
          created_at?: string
          description?: string | null
          flight_plan_remarks?: string | null
          iata_code?: string | null
          icao_code?: string | null
          id?: string
          is_active?: boolean
          is_unofficial_brand?: boolean
          logo_path?: string | null
          name?: string
          network?: string
          operation_type?: string
          organization_id?: string
          radio_callsign?: string | null
          slug?: string
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "airlines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      airports: {
        Row: {
          airport_type: string
          city: string | null
          country_code: string | null
          created_at: string
          elevation_ft: number | null
          iata_code: string | null
          icao_code: string
          id: number
          latitude: number
          longitude: number
          name: string
          source: string
          updated_at: string
        }
        Insert: {
          airport_type?: string
          city?: string | null
          country_code?: string | null
          created_at?: string
          elevation_ft?: number | null
          iata_code?: string | null
          icao_code: string
          id?: never
          latitude: number
          longitude: number
          name: string
          source?: string
          updated_at?: string
        }
        Update: {
          airport_type?: string
          city?: string | null
          country_code?: string | null
          created_at?: string
          elevation_ft?: number | null
          iata_code?: string | null
          icao_code?: string
          id?: never
          latitude?: number
          longitude?: number
          name?: string
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          airline_id: string | null
          entity_id: string
          entity_type: string
          id: number
          new_data: Json | null
          occurred_at: string
          old_data: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          airline_id?: string | null
          entity_id: string
          entity_type: string
          id?: never
          new_data?: Json | null
          occurred_at?: string
          old_data?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          airline_id?: string | null
          entity_id?: string
          entity_type?: string
          id?: never
          new_data?: Json | null
          occurred_at?: string
          old_data?: Json | null
        }
        Relationships: []
      }
      organization_members: {
        Row: {
          created_at: string
          created_by: string | null
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          account_status: Database["public"]["Enums"]["account_status"]
          country_code: string | null
          created_at: string
          display_name: string
          email: string
          id: string
          joined_at: string
          pilot_number: number
          primary_airline_id: string | null
          simbrief_username: string | null
          updated_at: string
        }
        Insert: {
          account_status?: Database["public"]["Enums"]["account_status"]
          country_code?: string | null
          created_at?: string
          display_name: string
          email: string
          id: string
          joined_at?: string
          pilot_number?: never
          primary_airline_id?: string | null
          simbrief_username?: string | null
          updated_at?: string
        }
        Update: {
          account_status?: Database["public"]["Enums"]["account_status"]
          country_code?: string | null
          created_at?: string
          display_name?: string
          email?: string
          id?: string
          joined_at?: string
          pilot_number?: never
          primary_airline_id?: string | null
          simbrief_username?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_primary_airline_id_fkey"
            columns: ["primary_airline_id"]
            isOneToOne: false
            referencedRelation: "airlines"
            referencedColumns: ["id"]
          },
        ]
      }
      route_aircraft_types: {
        Row: {
          aircraft_type_id: number
          route_id: string
        }
        Insert: {
          aircraft_type_id: number
          route_id: string
        }
        Update: {
          aircraft_type_id?: number
          route_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "route_aircraft_types_aircraft_type_id_fkey"
            columns: ["aircraft_type_id"]
            isOneToOne: false
            referencedRelation: "aircraft_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_aircraft_types_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "routes"
            referencedColumns: ["id"]
          },
        ]
      }
      routes: {
        Row: {
          airline_id: string
          created_at: string
          days_of_week: number
          departure_time_utc: string | null
          destination_airport_id: number
          distance_nm: number
          estimated_minutes: number
          flight_number: string
          id: string
          is_active: boolean
          notes: string | null
          operation_type: string
          origin_airport_id: number
          updated_at: string
        }
        Insert: {
          airline_id: string
          created_at?: string
          days_of_week?: number
          departure_time_utc?: string | null
          destination_airport_id: number
          distance_nm?: number
          estimated_minutes: number
          flight_number: string
          id?: string
          is_active?: boolean
          notes?: string | null
          operation_type?: string
          origin_airport_id: number
          updated_at?: string
        }
        Update: {
          airline_id?: string
          created_at?: string
          days_of_week?: number
          departure_time_utc?: string | null
          destination_airport_id?: number
          distance_nm?: number
          estimated_minutes?: number
          flight_number?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          operation_type?: string
          origin_airport_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "routes_airline_id_fkey"
            columns: ["airline_id"]
            isOneToOne: false
            referencedRelation: "airlines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routes_destination_airport_id_fkey"
            columns: ["destination_airport_id"]
            isOneToOne: false
            referencedRelation: "airports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routes_origin_airport_id_fkey"
            columns: ["origin_airport_id"]
            isOneToOne: false
            referencedRelation: "airports"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_dashboard_summary: { Args: { p_airline_id?: string }; Returns: Json }
      import_routes: {
        Args: { p_airline_id: string; p_dry_run?: boolean; p_rows: Json }
        Returns: Json
      }
    }
    Enums: {
      account_status: "active" | "suspended"
      aircraft_status:
        | "available"
        | "assigned"
        | "in_flight"
        | "maintenance"
        | "out_of_service"
      airline_role: "airline_admin" | "ops_chief" | "pilot"
      membership_status: "pending" | "active" | "suspended" | "rejected"
      org_role: "superadmin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database["public"]

export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"]
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T]
