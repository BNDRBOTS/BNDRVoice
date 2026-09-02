import Stripe from 'npm:stripe@14.21.0'
import { jsonError } from '../_shared/errors.ts'
import { testKeysInProdMessage, testStripeKeyInProduction } from '../_shared/env.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import { serve } from '../_shared/serve.ts'
import { serverConfigured, userClient } from '../_shared/supabase.ts'

const appOrigin = Deno.env.get('APP_ORIGIN') || 'https://voice.bndr.bot'
const cors = {
  'Access-Control-Allow-Origin': appOrigin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { ...cors, 'Cache-Control': 'no-store' } })

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405)

  if (testStripeKeyInProduction()) return jsonError(cors, 'BILLING', 500, testKeysInProdMessage())
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') || ''
  const authHeader = req.headers.get('authorization') || ''
  if (!serverConfigured() || !stripeKey) return reply({ error: 'Billing is not configured' }, 503)
  if (!authHeader.startsWith('Bearer ')) return reply({ error: 'Unauthorized' }, 401)
  const client = userClient(authHeader)
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError || !user) return reply({ error: 'Unauthorized' }, 401)
  if (!(await enforceRateLimit(client, 'billing-portal', 10, 60))) {
    return jsonError(cors, 'RATE', 429, 'Too many billing requests. Try again in a minute.')
  }
  const { data: subscription } = await client.from('subscriptions')
    .select('stripe_customer_id').eq('user_id', user.id).maybeSingle()
  if (!subscription?.stripe_customer_id) return reply({ error: 'No billing account found' }, 404)

  const stripe = new Stripe(stripeKey, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  })
  const portal = await stripe.billingPortal.sessions.create({
    customer: subscription.stripe_customer_id,
    return_url: `${appOrigin}/app`,
    configuration: Deno.env.get('STRIPE_PORTAL_CONFIGURATION_ID') || undefined,
  })
  return reply({ url: portal.url })
}

serve(handleRequest)
