import Stripe from 'npm:stripe@14.21.0'
import { jsonError, publicCode, correlationId } from '../_shared/errors.ts'
import {
  missingMessage,
  missingNamed,
  testKeysInProdMessage,
  testStripeKeyInProduction,
} from '../_shared/env.ts'
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

const PRICE_ENV: Record<string, string> = {
  monthly: 'STRIPE_MONTHLY_PRICE_ID',
  annual: 'STRIPE_ANNUAL_PRICE_ID',
  weekly: 'STRIPE_WEEKLY_PRICE_ID',
  metered: 'STRIPE_METERED_PRICE_ID',
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return jsonError(cors, 'BILLING', 405, 'Method not allowed')

  if (testStripeKeyInProduction()) {
    return jsonError(cors, 'BILLING', 500, testKeysInProdMessage())
  }

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') || ''
  if (!stripeKey || !serverConfigured()) {
    return jsonError(cors, 'BILLING', 503, 'Billing is not enabled')
  }

  const authHeader = req.headers.get('authorization') || ''
  if (!authHeader.startsWith('Bearer ')) {
    return jsonError(cors, 'AUTH', 401, 'Unauthorized')
  }
  const client = userClient(authHeader)
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError || !user) return jsonError(cors, 'AUTH', 401, 'Unauthorized')

  if (!(await enforceRateLimit(client, 'checkout', 10, 60))) {
    return jsonError(cors, 'RATE', 429, 'Too many checkout attempts. Try again in a minute.')
  }

  const input = await req.json().catch(() => null)
  const interval = String(input?.interval || 'monthly')
  const priceEnv = PRICE_ENV[interval]
  if (!priceEnv) return jsonError(cors, 'BILLING', 400, 'Unknown plan interval')
  const priceId = Deno.env.get(priceEnv) || ''
  if (!priceId || priceId.includes('REPLACE_ME')) {
    const missing = missingNamed([priceEnv])
    return jsonError(cors, 'BILLING', 503, missing.length ? missingMessage(missing) : 'Billing is not enabled')
  }

  const stripe = new Stripe(stripeKey, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  })
  const correlation = correlationId()
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appOrigin}/app?upgraded=1`,
      cancel_url: `${appOrigin}/app`,
      client_reference_id: user.id,
      customer_email: user.email || undefined,
      metadata: { supabase_user_id: user.id, correlation_id: correlation },
      subscription_data: {
        metadata: { supabase_user_id: user.id },
      },
      allow_promotion_codes: true,
    })
    if (!session.url) return jsonError(cors, 'BILLING', 502, 'Checkout session missing URL')
    return reply({
      url: session.url,
      correlation_id: correlation,
      error_code: publicCode('BILLING', 200, correlation),
    })
  } catch {
    return jsonError(cors, 'BILLING', 502, 'Could not create checkout session')
  }
}

serve(handleRequest)
