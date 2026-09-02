import { jsonError } from '../_shared/errors.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import { serve } from '../_shared/serve.ts'
import { adminClient, serverConfigured, userClient } from '../_shared/supabase.ts'

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

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('authorization') || ''
  if (!serverConfigured(true)) return reply({ error: 'Server configuration incomplete' }, 503)
  if (!authHeader.startsWith('Bearer ')) return reply({ error: 'Unauthorized' }, 401)

  const client = userClient(authHeader)
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError || !user) return reply({ error: 'Unauthorized' }, 401)
  if (!(await enforceRateLimit(client, 'redeem-access', 10, 60))) {
    return jsonError(cors, 'RATE', 429, 'Too many redemption attempts. Try again in a minute.')
  }

  const input = await req.json().catch(() => null)
  const code = String(input?.code || '').trim()
  if (code.length < 6 || code.length > 300) return reply({ error: 'Invalid code' }, 400)

  const codeHash = await sha256(code)
  const configuredHashes = (Deno.env.get('GIFT_CODE_HASHES') || '')
    .split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
  const gift = configuredHashes.includes(codeHash)
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

  const admin = adminClient()
  const source = gift ? 'gift' : 'gumroad'
  const { error } = await admin.rpc('set_entitlement', {
    p_user_id: user.id,
    p_status: 'active',
    p_product_tier: 'lifetime',
    p_source: source,
    p_source_ref: codeHash,
    p_valid_until: null,
    p_grace_until: null,
    p_daily_limit: 1000000,
    p_reason: gift ? 'gift_code_redeemed' : 'gumroad_license_redeemed',
    p_metadata: { source },
  })
  if (error) return reply({ error: 'Could not grant access' }, 500)
  return reply({ granted: true, entitlement: 'lifetime' })
}

serve(handleRequest)
