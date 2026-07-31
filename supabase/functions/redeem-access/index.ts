import { createClient } from 'npm:@supabase/supabase-js@2.110.5'

const appOrigin = Deno.env.get('APP_ORIGIN') || 'https://voice.bndr.bot'
const cors = {
  'Access-Control-Allow-Origin': appOrigin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { ...cors, 'Cache-Control': 'no-store' } })

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value.trim().toUpperCase()))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL') || ''
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || ''
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const authHeader = req.headers.get('authorization') || ''
  if (!url || !anon || !service) return reply({ error: 'Server configuration incomplete' }, 503)
  if (!authHeader.startsWith('Bearer ')) return reply({ error: 'Unauthorized' }, 401)

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return reply({ error: 'Unauthorized' }, 401)

  const input = await req.json().catch(() => null)
  const code = String(input?.code || '').trim()
  if (code.length < 6 || code.length > 300) return reply({ error: 'Invalid code' }, 400)

  const configuredHashes = (Deno.env.get('GIFT_CODE_HASHES') || '')
    .split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
  const gift = configuredHashes.includes(await sha256(code))
  let gumroad = false
  if (!gift && Deno.env.get('GUMROAD_PRODUCT_ID')) {
    const response = await fetch('https://api.gumroad.com/v2/licenses/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        product_id: Deno.env.get('GUMROAD_PRODUCT_ID') || '',
        license_key: code,
        increment_uses_count: 'false',
      }),
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null)
    const result = await response?.json().catch(() => null)
    gumroad = Boolean(result?.success && result?.purchase
      && !result.purchase.refunded && !result.purchase.chargebacked && !result.purchase.disputed)
  }
  if (!gift && !gumroad) return reply({ error: 'Code or license not recognized' }, 404)

  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { data: previous } = await admin.from('subscriptions')
    .select('status').eq('user_id', user.id).maybeSingle()
  const { error } = await admin.from('subscriptions').upsert({
    user_id: user.id,
    status: 'active',
    plan_interval: 'lifetime',
    current_period_start: new Date().toISOString(),
    current_period_end: null,
    grace_ends_at: null,
    cancel_at_period_end: false,
    last_reconciled_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
  if (error) return reply({ error: 'Could not grant access' }, 500)
  await admin.from('entitlement_history').insert({
    user_id: user.id,
    from_status: previous?.status || null,
    to_status: 'active',
    reason: gift ? 'gift_code_redeemed' : 'gumroad_license_redeemed',
    metadata: { source: gift ? 'gift' : 'gumroad' },
  })
  return reply({ granted: true, entitlement: 'lifetime' })
})
