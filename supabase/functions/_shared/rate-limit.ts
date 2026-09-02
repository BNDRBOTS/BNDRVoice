import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.110.5'

export async function enforceRateLimit(
  client: SupabaseClient,
  scope: string,
  limit: number,
  windowSeconds = 60,
): Promise<boolean> {
  const { data, error } = await client.rpc('check_rate_limit', {
    p_scope: scope,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  })
  if (error) return false
  return data === true
}
