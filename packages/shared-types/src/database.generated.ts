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
      acars_devices: {
        Row: {
          app_version: string | null
          created_at: string
          id: string
          last_used_at: string | null
          name: string
          rate_count: number
          rate_window_start: string
          revoked_at: string | null
          revoked_by: string | null
          token_hash: string
          token_prefix: string
          user_id: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          id?: string
          last_used_at?: string | null
          name: string
          rate_count?: number
          rate_window_start?: string
          revoked_at?: string | null
          revoked_by?: string | null
          token_hash: string
          token_prefix: string
          user_id: string
        }
        Update: {
          app_version?: string | null
          created_at?: string
          id?: string
          last_used_at?: string | null
          name?: string
          rate_count?: number
          rate_window_start?: string
          revoked_at?: string | null
          revoked_by?: string | null
          token_hash?: string
          token_prefix?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acars_devices_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acars_devices_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      acars_link_codes: {
        Row: {
          app_version: string | null
          approved_at: string | null
          code: string
          consumed_at: string | null
          created_at: string
          device_id: string | null
          device_name: string
          expires_at: string
          id: string
          ip_hash: string | null
          poll_secret_hash: string
          status: string
          user_id: string | null
        }
        Insert: {
          app_version?: string | null
          approved_at?: string | null
          code: string
          consumed_at?: string | null
          created_at?: string
          device_id?: string | null
          device_name: string
          expires_at?: string
          id?: string
          ip_hash?: string | null
          poll_secret_hash: string
          status?: string
          user_id?: string | null
        }
        Update: {
          app_version?: string | null
          approved_at?: string | null
          code?: string
          consumed_at?: string | null
          created_at?: string
          device_id?: string | null
          device_name?: string
          expires_at?: string
          id?: string
          ip_hash?: string | null
          poll_secret_hash?: string
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "acars_link_codes_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "acars_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acars_link_codes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
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
          pirep_min_score: number
          booking_expiry_hours: number
          delay_tolerance_minutes: number
          max_active_bookings: number
          public_tracking: boolean
          require_aircraft_at_origin: boolean
          require_type_rating: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          airline_id: string
          auto_approve_pireps?: boolean
          pirep_min_score?: number
          booking_expiry_hours?: number
          delay_tolerance_minutes?: number
          max_active_bookings?: number
          public_tracking?: boolean
          require_aircraft_at_origin?: boolean
          require_type_rating?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          airline_id?: string
          auto_approve_pireps?: boolean
          pirep_min_score?: number
          booking_expiry_hours?: number
          delay_tolerance_minutes?: number
          max_active_bookings?: number
          public_tracking?: boolean
          require_aircraft_at_origin?: boolean
          require_type_rating?: boolean
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
      flight_bookings: {
        Row: {
          aircraft_id: string | null
          airline_id: string
          closed_at: string | null
          closed_by: string | null
          created_at: string
          expires_at: string
          id: string
          route_id: string | null
          status: Database["public"]["Enums"]["booking_status"]
          user_id: string
        }
        Insert: {
          aircraft_id?: string | null
          airline_id: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          expires_at: string
          id?: string
          route_id?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          user_id: string
        }
        Update: {
          aircraft_id?: string | null
          airline_id?: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          route_id?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flight_bookings_aircraft_id_fkey"
            columns: ["aircraft_id"]
            isOneToOne: false
            referencedRelation: "aircraft"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flight_bookings_airline_id_fkey"
            columns: ["airline_id"]
            isOneToOne: false
            referencedRelation: "airlines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flight_bookings_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flight_bookings_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flight_bookings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      flight_events: {
        Row: {
          airline_id: string
          altitude_ft: number | null
          data: Json
          flight_id: string
          id: string
          latitude: number | null
          longitude: number | null
          occurred_at: string
          phase: string
          received_at: string
          seq: number
          session_id: string
          type: string
          user_id: string
        }
        Insert: {
          airline_id: string
          altitude_ft?: number | null
          data?: Json
          flight_id: string
          id: string
          latitude?: number | null
          longitude?: number | null
          occurred_at: string
          phase: string
          received_at?: string
          seq: number
          session_id: string
          type: string
          user_id: string
        }
        Update: {
          airline_id?: string
          altitude_ft?: number | null
          data?: Json
          flight_id?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          occurred_at?: string
          phase?: string
          received_at?: string
          seq?: number
          session_id?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flight_events_airline_id_fkey"
            columns: ["airline_id"]
            isOneToOne: false
            referencedRelation: "airlines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flight_events_flight_id_fkey"
            columns: ["flight_id"]
            isOneToOne: false
            referencedRelation: "flights"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flight_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "flight_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flight_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      flight_positions_live: {
        Row: {
          agl_ft: number | null
          airline_id: string
          altitude_ft: number
          flight_id: string
          gs_kt: number | null
          heading_deg: number | null
          ias_kt: number | null
          latitude: number
          longitude: number
          on_ground: boolean
          phase: string
          sampled_at: string
          session_id: string
          updated_at: string
          user_id: string
          vs_fpm: number | null
        }
        Insert: {
          agl_ft?: number | null
          airline_id: string
          altitude_ft: number
          flight_id: string
          gs_kt?: number | null
          heading_deg?: number | null
          ias_kt?: number | null
          latitude: number
          longitude: number
          on_ground?: boolean
          phase: string
          sampled_at: string
          session_id: string
          updated_at?: string
          user_id: string
          vs_fpm?: number | null
        }
        Update: {
          agl_ft?: number | null
          airline_id?: string
          altitude_ft?: number
          flight_id?: string
          gs_kt?: number | null
          heading_deg?: number | null
          ias_kt?: number | null
          latitude?: number
          longitude?: number
          on_ground?: boolean
          phase?: string
          sampled_at?: string
          session_id?: string
          updated_at?: string
          user_id?: string
          vs_fpm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "flight_positions_live_airline_id_fkey"
            columns: ["airline_id"]
            isOneToOne: false
            referencedRelation: "airlines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flight_positions_live_flight_id_fkey"
            columns: ["flight_id"]
            isOneToOne: true
            referencedRelation: "flights"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flight_positions_live_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "flight_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flight_positions_live_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      flight_sessions: {
        Row: {
          airline_id: string
          client_version: string | null
          device_id: string | null
          end_reason: string | null
          ended_at: string | null
          final_airport_id: number | null
          flight_id: string
          id: string
          last_contact_at: string
          phase: string
          sim_aircraft_icao: string | null
          sim_aircraft_title: string | null
          sim_registration: string | null
          started_at: string
          status: string
          user_id: string
        }
        Insert: {
          airline_id: string
          client_version?: string | null
          device_id?: string | null
          end_reason?: string | null
          ended_at?: string | null
          final_airport_id?: number | null
          flight_id: string
          id?: string
          last_contact_at?: string
          phase?: string
          sim_aircraft_icao?: string | null
          sim_aircraft_title?: string | null
          sim_registration?: string | null
          started_at?: string
          status?: string
          user_id: string
        }
        Update: {
          airline_id?: string
          client_version?: string | null
          device_id?: string | null
          end_reason?: string | null
          ended_at?: string | null
          final_airport_id?: number | null
          flight_id?: string
          id?: string
          last_contact_at?: string
          phase?: string
          sim_aircraft_icao?: string | null
          sim_aircraft_title?: string | null
          sim_registration?: string | null
          started_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flight_sessions_airline_id_fkey"
            columns: ["airline_id"]
            isOneToOne: false
            referencedRelation: "airlines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flight_sessions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "acars_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flight_sessions_final_airport_id_fkey"
            columns: ["final_airport_id"]
            isOneToOne: false
            referencedRelation: "airports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flight_sessions_flight_id_fkey"
            columns: ["flight_id"]
            isOneToOne: true
            referencedRelation: "flights"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flight_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      flight_track_points: {
        Row: {
          airline_id: string
          altitude_ft: number
          flight_id: string
          fuel_kg: number | null
          gs_kt: number | null
          heading_deg: number | null
          ias_kt: number | null
          latitude: number
          longitude: number
          on_ground: boolean
          phase: string
          sampled_at: string
          seq: number
          session_id: string
          user_id: string
          vs_fpm: number | null
        }
        Insert: {
          airline_id: string
          altitude_ft: number
          flight_id: string
          fuel_kg?: number | null
          gs_kt?: number | null
          heading_deg?: number | null
          ias_kt?: number | null
          latitude: number
          longitude: number
          on_ground?: boolean
          phase: string
          sampled_at: string
          seq: number
          session_id: string
          user_id: string
          vs_fpm?: number | null
        }
        Update: {
          airline_id?: string
          altitude_ft?: number
          flight_id?: string
          fuel_kg?: number | null
          gs_kt?: number | null
          heading_deg?: number | null
          ias_kt?: number | null
          latitude?: number
          longitude?: number
          on_ground?: boolean
          phase?: string
          sampled_at?: string
          seq?: number
          session_id?: string
          user_id?: string
          vs_fpm?: number | null
        }
        Relationships: []
      }
      flights: {
        Row: {
          aircraft_id: string | null
          aircraft_registration: string
          aircraft_type_id: number
          airline_icao: string
          airline_id: string
          booking_id: string | null
          callsign: string
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          destination_airport_id: number
          flight_number: string
          flight_plan_remarks: string | null
          id: string
          network: string
          operation_type: string
          origin_airport_id: number
          planned_distance_nm: number
          planned_minutes: number
          route_id: string | null
          scheduled_departure_at: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["flight_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          aircraft_id?: string | null
          aircraft_registration: string
          aircraft_type_id: number
          airline_icao: string
          airline_id: string
          booking_id?: string | null
          callsign: string
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          destination_airport_id: number
          flight_number: string
          flight_plan_remarks?: string | null
          id?: string
          network: string
          operation_type: string
          origin_airport_id: number
          planned_distance_nm: number
          planned_minutes: number
          route_id?: string | null
          scheduled_departure_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["flight_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          aircraft_id?: string | null
          aircraft_registration?: string
          aircraft_type_id?: number
          airline_icao?: string
          airline_id?: string
          booking_id?: string | null
          callsign?: string
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          destination_airport_id?: number
          flight_number?: string
          flight_plan_remarks?: string | null
          id?: string
          network?: string
          operation_type?: string
          origin_airport_id?: number
          planned_distance_nm?: number
          planned_minutes?: number
          route_id?: string | null
          scheduled_departure_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["flight_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flights_aircraft_id_fkey"
            columns: ["aircraft_id"]
            isOneToOne: false
            referencedRelation: "aircraft"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flights_aircraft_type_id_fkey"
            columns: ["aircraft_type_id"]
            isOneToOne: false
            referencedRelation: "aircraft_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flights_airline_id_fkey"
            columns: ["airline_id"]
            isOneToOne: false
            referencedRelation: "airlines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flights_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "flight_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flights_destination_airport_id_fkey"
            columns: ["destination_airport_id"]
            isOneToOne: false
            referencedRelation: "airports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flights_origin_airport_id_fkey"
            columns: ["origin_airport_id"]
            isOneToOne: false
            referencedRelation: "airports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flights_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flights_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      pilot_type_ratings: {
        Row: {
          aircraft_type_id: number
          airline_id: string
          granted_at: string
          granted_by: string | null
          notes: string | null
          user_id: string
        }
        Insert: {
          aircraft_type_id: number
          airline_id: string
          granted_at?: string
          granted_by?: string | null
          notes?: string | null
          user_id: string
        }
        Update: {
          aircraft_type_id?: number
          airline_id?: string
          granted_at?: string
          granted_by?: string | null
          notes?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pilot_type_ratings_aircraft_type_id_fkey"
            columns: ["aircraft_type_id"]
            isOneToOne: false
            referencedRelation: "aircraft_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pilot_type_ratings_airline_id_fkey"
            columns: ["airline_id"]
            isOneToOne: false
            referencedRelation: "airlines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pilot_type_ratings_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pilot_type_ratings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pirep_rule_definitions: {
        Row: {
          code: string
          default_critical: boolean
          default_enabled: boolean
          default_penalty: number
          default_threshold: number | null
          description: string
          label: string
          sort_order: number
          threshold_unit: string | null
        }
        Insert: {
          code: string
          default_critical?: boolean
          default_enabled?: boolean
          default_penalty: number
          default_threshold?: number | null
          description: string
          label: string
          sort_order: number
          threshold_unit?: string | null
        }
        Update: {
          code?: string
          default_critical?: boolean
          default_enabled?: boolean
          default_penalty?: number
          default_threshold?: number | null
          description?: string
          label?: string
          sort_order?: number
          threshold_unit?: string | null
        }
        Relationships: [

        ]
      }
      pirep_scoring_rules: {
        Row: {
          airline_id: string
          critical: boolean
          enabled: boolean
          penalty: number
          rule_code: string
          threshold: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          airline_id: string
          critical: boolean
          enabled: boolean
          penalty: number
          rule_code: string
          threshold?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          airline_id?: string
          critical?: boolean
          enabled?: boolean
          penalty?: number
          rule_code?: string
          threshold?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pirep_scoring_rules_airline_id_fkey"
            columns: ["airline_id"]
            isOneToOne: false
            referencedRelation: "airlines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pirep_scoring_rules_rule_code_fkey"
            columns: ["rule_code"]
            isOneToOne: false
            referencedRelation: "pirep_rule_definitions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "pirep_scoring_rules_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pireps: {
        Row: {
          aircraft_id: string | null
          aircraft_registration: string
          aircraft_type_id: number
          airline_id: string
          arrival_airport_id: number | null
          auto_approved: boolean
          block_minutes: number
          block_off_at: string | null
          block_on_at: string | null
          callsign: string
          created_at: string
          destination_airport_id: number
          distance_nm: number | null
          diverted: boolean
          findings: Json
          flight_id: string
          flight_minutes: number | null
          flight_number: string
          fuel_used_kg: number | null
          has_critical: boolean
          id: string
          landing_at: string | null
          landing_bounces: number | null
          landing_g: number | null
          landing_vs_fpm: number | null
          max_altitude_ft: number | null
          metrics: Json
          origin_airport_id: number
          pilot_comment: string | null
          planned_distance_nm: number | null
          review_comment: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          score: number
          session_id: string
          status: Database["public"]["Enums"]["pirep_status"]
          takeoff_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          aircraft_id?: string | null
          aircraft_registration: string
          aircraft_type_id: number
          airline_id: string
          arrival_airport_id?: number | null
          auto_approved?: boolean
          block_minutes: number
          block_off_at?: string | null
          block_on_at?: string | null
          callsign: string
          created_at?: string
          destination_airport_id: number
          distance_nm?: number | null
          diverted?: boolean
          findings?: Json
          flight_id: string
          flight_minutes?: number | null
          flight_number: string
          fuel_used_kg?: number | null
          has_critical?: boolean
          id?: string
          landing_at?: string | null
          landing_bounces?: number | null
          landing_g?: number | null
          landing_vs_fpm?: number | null
          max_altitude_ft?: number | null
          metrics?: Json
          origin_airport_id: number
          pilot_comment?: string | null
          planned_distance_nm?: number | null
          review_comment?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          score: number
          session_id: string
          status?: Database["public"]["Enums"]["pirep_status"]
          takeoff_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          aircraft_id?: string | null
          aircraft_registration?: string
          aircraft_type_id?: number
          airline_id?: string
          arrival_airport_id?: number | null
          auto_approved?: boolean
          block_minutes?: number
          block_off_at?: string | null
          block_on_at?: string | null
          callsign?: string
          created_at?: string
          destination_airport_id?: number
          distance_nm?: number | null
          diverted?: boolean
          findings?: Json
          flight_id?: string
          flight_minutes?: number | null
          flight_number?: string
          fuel_used_kg?: number | null
          has_critical?: boolean
          id?: string
          landing_at?: string | null
          landing_bounces?: number | null
          landing_g?: number | null
          landing_vs_fpm?: number | null
          max_altitude_ft?: number | null
          metrics?: Json
          origin_airport_id?: number
          pilot_comment?: string | null
          planned_distance_nm?: number | null
          review_comment?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          score?: number
          session_id?: string
          status?: Database["public"]["Enums"]["pirep_status"]
          takeoff_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pireps_aircraft_id_fkey"
            columns: ["aircraft_id"]
            isOneToOne: false
            referencedRelation: "aircraft"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pireps_aircraft_type_id_fkey"
            columns: ["aircraft_type_id"]
            isOneToOne: false
            referencedRelation: "aircraft_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pireps_airline_id_fkey"
            columns: ["airline_id"]
            isOneToOne: false
            referencedRelation: "airlines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pireps_arrival_airport_id_fkey"
            columns: ["arrival_airport_id"]
            isOneToOne: false
            referencedRelation: "airports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pireps_destination_airport_id_fkey"
            columns: ["destination_airport_id"]
            isOneToOne: false
            referencedRelation: "airports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pireps_flight_id_fkey"
            columns: ["flight_id"]
            isOneToOne: true
            referencedRelation: "flights"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pireps_origin_airport_id_fkey"
            columns: ["origin_airport_id"]
            isOneToOne: false
            referencedRelation: "airports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pireps_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pireps_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "flight_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pireps_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
          time_zone: string | null
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
          time_zone?: string | null
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
          time_zone?: string | null
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
      simbrief_ofps: {
        Row: {
          air_distance_nm: number | null
          aircraft_icao: string | null
          airline_icao: string | null
          airline_id: string
          alternate_icao: string | null
          atc_callsign: string | null
          block_fuel: number | null
          cargo: number | null
          cruise_altitude_ft: number | null
          destination_icao: string
          est_block_minutes: number | null
          est_enroute_minutes: number | null
          fetched_at: string
          flight_id: string
          flight_number: string | null
          fuel_units: string | null
          generated_at: string | null
          ldw: number | null
          mismatches: Json
          origin_icao: string
          pax_count: number | null
          pdf_url: string | null
          registration: string | null
          request_id: string
          reserve_fuel: number | null
          route: string | null
          static_id: string | null
          tow: number | null
          trip_fuel: number | null
          user_id: string
          zfw: number | null
        }
        Insert: {
          air_distance_nm?: number | null
          aircraft_icao?: string | null
          airline_icao?: string | null
          airline_id: string
          alternate_icao?: string | null
          atc_callsign?: string | null
          block_fuel?: number | null
          cargo?: number | null
          cruise_altitude_ft?: number | null
          destination_icao: string
          est_block_minutes?: number | null
          est_enroute_minutes?: number | null
          fetched_at?: string
          flight_id: string
          flight_number?: string | null
          fuel_units?: string | null
          generated_at?: string | null
          ldw?: number | null
          mismatches?: Json
          origin_icao: string
          pax_count?: number | null
          pdf_url?: string | null
          registration?: string | null
          request_id: string
          reserve_fuel?: number | null
          route?: string | null
          static_id?: string | null
          tow?: number | null
          trip_fuel?: number | null
          user_id: string
          zfw?: number | null
        }
        Update: {
          air_distance_nm?: number | null
          aircraft_icao?: string | null
          airline_icao?: string | null
          airline_id?: string
          alternate_icao?: string | null
          atc_callsign?: string | null
          block_fuel?: number | null
          cargo?: number | null
          cruise_altitude_ft?: number | null
          destination_icao?: string
          est_block_minutes?: number | null
          est_enroute_minutes?: number | null
          fetched_at?: string
          flight_id?: string
          flight_number?: string | null
          fuel_units?: string | null
          generated_at?: string | null
          ldw?: number | null
          mismatches?: Json
          origin_icao?: string
          pax_count?: number | null
          pdf_url?: string | null
          registration?: string | null
          request_id?: string
          reserve_fuel?: number | null
          route?: string | null
          static_id?: string | null
          tow?: number | null
          trip_fuel?: number | null
          user_id?: string
          zfw?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "simbrief_ofps_airline_id_fkey"
            columns: ["airline_id"]
            isOneToOne: false
            referencedRelation: "airlines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simbrief_ofps_flight_id_fkey"
            columns: ["flight_id"]
            isOneToOne: true
            referencedRelation: "flights"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simbrief_ofps_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      pilot_statistics: {
        Row: {
          airline_id: string | null
          average_landing_vs_fpm: number | null
          average_score: number | null
          best_landing_vs_fpm: number | null
          block_minutes: number | null
          distance_nm: number | null
          flight_minutes: number | null
          fuel_used_kg: number | null
          last_flight_at: string | null
          pireps_accepted: number | null
          pireps_pending: number | null
          pireps_rejected: number | null
          pireps_total: number | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      approve_acars_link: { Args: { p_code: string }; Returns: Json }
      book_flight: {
        Args: { p_aircraft_id: string; p_callsign: string; p_route_id: string }
        Returns: Json
      }
      cancel_booking: { Args: { p_booking_id: string }; Returns: undefined }
      comment_pirep: {
        Args: { p_comment: string; p_pirep_id: string }
        Returns: Database["public"]["Tables"]["pireps"]["Row"]
      }
      get_dashboard_summary: { Args: { p_airline_id?: string }; Returns: Json }
      import_routes: {
        Args: { p_airline_id: string; p_dry_run?: boolean; p_rows: Json }
        Returns: Json
      }
      review_pirep: {
        Args: {
          p_comment?: string
          p_decision: Database["public"]["Enums"]["pirep_status"]
          p_pirep_id: string
        }
        Returns: Database["public"]["Tables"]["pireps"]["Row"]
      }
      revoke_acars_device: { Args: { p_device_id: string }; Returns: undefined }
      route_aircraft_options: {
        Args: { p_route_id: string }
        Returns: {
          aircraft_id: string
          aircraft_type_id: number
          block_reason: string | null
          fleet_number: string | null
          location_icao: string | null
          registration: string
          status: Database["public"]["Enums"]["aircraft_status"]
          type_icao: string
          type_model: string
        }[]
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
      booking_status: "active" | "completed" | "cancelled" | "expired"
      flight_status: "scheduled" | "in_progress" | "completed" | "cancelled"
      membership_status: "pending" | "active" | "suspended" | "rejected"
      org_role: "superadmin"
      pirep_status: "pending" | "accepted" | "rejected"
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
