import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';

export interface AuditFilters {
  entityType: string;
  airlineId: string;
  page: number;
  pageSize: number;
}

export function useAuditLog(filters: AuditFilters) {
  return useQuery({
    queryKey: ['audit', filters],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = getSupabase()
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .order('occurred_at', { ascending: false })
        .range(filters.page * filters.pageSize, (filters.page + 1) * filters.pageSize - 1);
      if (filters.entityType) query = query.eq('entity_type', filters.entityType);
      if (filters.airlineId) query = query.eq('airline_id', filters.airlineId);
      const { data, error, count } = await query;
      if (error) throw error;

      // Nombres de quienes hicieron los cambios (el superadministrador ve todos los perfiles).
      const actorIds = [...new Set(data.map((r) => r.actor_id).filter((id): id is string => Boolean(id)))];
      const actors = new Map<string, { display_name: string; pilot_number: number }>();
      if (actorIds.length > 0) {
        const { data: profiles, error: profileError } = await getSupabase()
          .from('profiles')
          .select('id, display_name, pilot_number')
          .in('id', actorIds);
        if (profileError) throw profileError;
        for (const p of profiles) actors.set(p.id, p);
      }
      return { rows: data, total: count ?? 0, actors };
    },
  });
}

export type AuditRow = NonNullable<ReturnType<typeof useAuditLog>['data']>['rows'][number];

export function useOrgAdmins() {
  return useQuery({
    queryKey: ['org-admins'],
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('organization_members')
        .select('organization_id, user_id, role, created_at, profile:profiles!organization_members_user_id_fkey(pilot_number, display_name, email)')
        .order('created_at');
      if (error) throw error;
      return data;
    },
  });
}
