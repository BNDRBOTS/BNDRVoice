import { createClient } from 'npm:@supabase/supabase-js@2.110.5'
import Stripe from 'npm:stripe@14.21.0'

Deno.serve(async req => {
  const expected = Deno.env.get('RECONCILE_TOKEN') || ''
  if (!expected) return Response.json({ error: 'Reconciliation is not configured' }, { status: 503 })
  if (req.headers.get('authorization') !== `Bearer ${expected}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = Deno.env.get('SUPABASE_URL') || ''
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') || ''
  if (!url || !service || !stripeKey) {
    return Response.json({ error: 'Server configuration incomplete' }, { status: 503 })
  }
  const admin = createClient(url, service, { auth: { persistSession: false } })
  const stripe = new Stripe(stripeKey, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  })
  const { data: rows, error } = await admin.from('subscriptions')
    .select('user_id,stripe_subscription_id,status,grace_ends_at')
    .not('stripe_subscription_id', 'is', null)
    .limit(500)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  let changed = 0
  for (const row of rows || []) {
    const subscription = await stripe.subscriptions.retrieve(row.stripe_subscription_id)
    const nextStatus = subscription.status === 'active' || subscription.status === 'trialing'
      ? 'active'
      : subscription.status === 'past_due' || subscription.status === 'unpaid'
        ? 'grace'
        : subscription.status === 'paused' ? 'paused'
          : subscription.status === 'canceled' ? 'canceled' : 'expired'
    const item = subscription.items.data[0]
    const interval = item?.price?.recurring?.usage_type === 'metered' ? 'metered'
      : item?.price?.recurring?.interval === 'week' ? 'weekly'
        : item?.price?.recurring?.interval === 'year' ? 'annual' : 'monthly'
    const patch = {
      status: nextStatus,
      plan_interval: interval,
      price_id: item?.price?.id || null,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
      grace_ends_at: nextStatus === 'grace'
        ? row.grace_ends_at || new Date(Date.now() + 3 * 86_400_000).toISOString()
        : null,
      last_reconciled_at: new Date().toISOString(),
    }
    const { error: updateError } = await admin.from('subscriptions')
      .update(patch).eq('user_id', row.user_id)
    if (!updateError && row.status !== nextStatus) {
      changed += 1
      await admin.from('entitlement_history').insert({
        user_id: row.user_id,
        from_status: row.status,
        to_status: nextStatus,
        reason: 'daily_reconciliation',
        metadata: { subscription_id: row.stripe_subscription_id },
      })
    }
  }
  return Response.json({ checked: rows?.length || 0, changed })
})
