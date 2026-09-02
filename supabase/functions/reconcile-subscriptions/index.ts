import Stripe from 'npm:stripe@14.21.0'
import {
  claimBillingEvent,
  finalizeBillingEvent,
  processStripeEvent,
  syncStripeSubscription,
} from '../_shared/stripe-workflows.ts'
import { serve } from '../_shared/serve.ts'
import { adminClient, serverConfigured } from '../_shared/supabase.ts'

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 })
  const expected = Deno.env.get('RECONCILE_TOKEN') || ''
  if (!expected) return Response.json({ error: 'Reconciliation is not configured' }, { status: 503 })
  if (req.headers.get('authorization') !== `Bearer ${expected}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') || ''
  if (!serverConfigured(true) || !stripeKey) {
    return Response.json({ error: 'Server configuration incomplete' }, { status: 503 })
  }

  const admin = adminClient()
  const stripe = new Stripe(stripeKey, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  })
  let checked = 0
  let changed = 0
  let failed = 0
  for (let from = 0; ; from += 200) {
    const { data: rows, error } = await admin.from('subscriptions')
      .select('user_id,stripe_subscription_id,status')
      .not('stripe_subscription_id', 'is', null)
      .order('user_id')
      .range(from, from + 199)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    for (const row of rows || []) {
      checked += 1
      try {
        const subscription = await stripe.subscriptions.retrieve(row.stripe_subscription_id)
        await syncStripeSubscription(admin, stripe, subscription, 'scheduled_reconciliation', row.user_id)
        const next = ['active', 'trialing'].includes(subscription.status) ? 'active'
          : ['past_due', 'unpaid'].includes(subscription.status) ? 'grace'
            : subscription.status === 'paused' ? 'paused'
              : subscription.status === 'canceled' ? 'canceled' : 'expired'
        if (next !== row.status) changed += 1
      } catch {
        failed += 1
      }
    }
    if ((rows || []).length < 200) break
  }

  let retried = 0
  const retryBefore = new Date().toISOString()
  const staleBefore = new Date(Date.now() - 30 * 60_000).toISOString()
  const { data: retryRows } = await admin.from('billing_events')
    .select('stripe_event_id')
    .or(`and(processing_state.eq.failed,next_attempt_at.lte.${retryBefore}),and(processing_state.eq.processing,claimed_at.lte.${staleBefore})`)
    .order('received_at')
    .limit(100)
  for (const row of retryRows || []) {
    try {
      const event = await stripe.events.retrieve(row.stripe_event_id)
      if (!(await claimBillingEvent(admin, event))) continue
      const handled = await processStripeEvent(admin, stripe, event)
      await finalizeBillingEvent(admin, event.id, handled ? 'processed' : 'ignored')
      retried += 1
    } catch (caught) {
      failed += 1
      const message = caught instanceof Error ? caught.message : String(caught)
      await finalizeBillingEvent(admin, row.stripe_event_id, 'failed', message).catch(() => undefined)
    }
  }

  const { error: purgeError } = await admin.rpc('purge_expired_audit_records')
  return Response.json({ checked, changed, retried, failed, audit_purged: !purgeError })
}

serve(handleRequest)
