import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.5'

function firstConfigured(name: string, legacyName: string): string {
  const encoded = Deno.env.get(name)
  if (encoded) {
    try {
      const values = JSON.parse(encoded)
      if (typeof values === 'string') return values
      if (values && typeof values === 'object') {
        const preferred = values.default || values.current || Object.values(values)[0]
        if (typeof preferred === 'string') return preferred
      }
    } catch {
      // Hosted environments may expose a single key instead of a key set.
      return encoded
    }
  }
  return Deno.env.get(legacyName) || ''
}

export function projectUrl(): string {
  return Deno.env.get('SUPABASE_URL') || ''
}

export function publishableKey(): string {
  return firstConfigured('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
}

export function secretKey(): string {
  return firstConfigured('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
}

export function userClient(authHeader: string): SupabaseClient {
  return createClient(projectUrl(), publishableKey(), {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function adminClient(): SupabaseClient {
  return createClient(projectUrl(), secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function serverConfigured(requireAdmin = false): boolean {
  return Boolean(projectUrl() && publishableKey() && (!requireAdmin || secretKey()))
}
