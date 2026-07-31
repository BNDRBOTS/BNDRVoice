import { createClient } from 'npm:@supabase/supabase-js@2.110.5'
import Stripe from 'npm:stripe@14.21.0'

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') || 'https://voice.bndr.bot',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { ...cors, 'Cache-Control': 'no-store' } })

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('authorization') || ''
  const url = Deno.env.get('SUPABASE_URL') || ''
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || ''
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!url || !anon || !service) return reply({ error: 'Server configuration incomplete' }, 503)
  if (!authHeader.startsWith('Bearer ')) return reply({ error: 'Unauthorized' }, 401)
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return reply({ error: 'Unauthorized' }, 401)

  const body = await req.json().catch(() => ({}))
  if (body?.confirmation !== 'DELETE') {
    return reply({ error: 'Type DELETE to confirm account deletion' }, 400)
  }

  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { data: subscription } = await admin.from('subscriptions')
    .select('stripe_subscription_id,status').eq('user_id', user.id).maybeSingle()
  if (subscription?.stripe_subscription_id && !['canceled', 'expired'].includes(subscription.status)) {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') || ''
    if (!stripeKey) return reply({ error: 'Billing cancellation is unavailable; account was not deleted' }, 503)
    const stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient(),
    })
    try {
      await stripe.subscriptions.cancel(subscription.stripe_subscription_id)
    } catch {
      return reply({ error: 'Subscription cancellation failed; account was not deleted' }, 502)
    }
  }
  const { data: files } = await admin.storage.from('voice-profile-exports').list(user.id, { limit: 1000 })
  if (files?.length) {
    await admin.storage.from('voice-profile-exports')
      .remove(files.map(file => `${user.id}/${file.name}`))
  }
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
  if (deleteError) return reply({ error: 'Account deletion failed' }, 500)
  return reply({ deleted: true })
})
