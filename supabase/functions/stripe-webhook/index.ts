// BNDR VoiceEngine 3.2.0 — Stripe entitlement webhook.
// Signature verification, durable event idempotency, lifecycle mapping,
// three-day payment-failure grace, refunds/disputes, and audit history.

import { createClient } from 'npm:@supabase/supabase-js@2.110.5'
import Stripe from 'npm:stripe@14.21.0'

const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY') || ''
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') || ''
const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const stripe = new Stripe(stripeSecret || 'not-configured', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})
const adminClient = createClient(supabaseUrl || 'http://127.0.0.1:54321', serviceKey || 'not-configured', {
  auth: { persistSession: false, autoRefreshToken: false },
})

type EntitlementStatus = 'trial' | 'active' | 'grace' | 'past_due' | 'paused' | 'canceled' | 'expired'

function text(message: string, status = 200): Response {
  return new Response(message, { status, headers: { 'Cache-Control': 'no-store' } })
}

async function beginEvent(event: Stripe.Event): Promise<'process' | 'duplicate'> {
  const { error } = await adminClient.from('billing_events').insert({
    stripe_event_id: event.id,
    event_type: event.type,
    livemode: event.livemode,
    payload: event.data.object,
    processing_state: 'processing',
  })
  if (!error) return 'process'
  if (error.code === '23505') {
    const { data } = await adminClient
      .from('billing_events')
      .select('processing_state')
      .eq('stripe_event_id', event.id)
      .single()
    if (data?.processing_state === 'failed') {
      await adminClient
        .from('billing_events')
        .update({ processing_state: 'processing', processing_error: null })
        .eq('stripe_event_id', event.id)
      return 'process'
    }
    return 'duplicate'
  }
  throw new Error(`Could not persist billing event: ${error.message}`)
}

async function finishEvent(eventId: string, state: 'processed' | 'ignored' | 'failed', processingError?: string) {
  const { error } = await adminClient
    .from('billing_events')
    .update({
      processing_state: state,
      processing_error: processingError?.slice(0, 1000) || null,
      processed_at: new Date().toISOString(),
    })
    .eq('stripe_event_id', eventId)
  if (error) throw new Error(`Could not finalize billing event: ${error.message}`)
}

async function recordHistory(
  userId: string,
  event: Stripe.Event,
  fromStatus: string | null,
  toStatus: EntitlementStatus,
  reason: string,
  metadata: Record<string, unknown> = {},
) {
  const { error } = await adminClient.from('entitlement_history').insert({
    user_id: userId,
    source_event_id: event.id,
    from_status: fromStatus,
    to_status: toStatus,
    reason,
    metadata,
  })
  if (error) throw new Error(`Could not persist entitlement history: ${error.message}`)
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return text('Method not allowed', 405)
  if (!stripeSecret || !webhookSecret || !supabaseUrl || !serviceKey) {
    return text('Billing webhook is not configured', 503)
  }
  const signature = req.headers.get('stripe-signature')
  if (!signature) return text('Missing stripe-signature header', 400)

  const declaredSize = Number(req.headers.get('content-length') || 0)
  if (declaredSize > 1_000_000) return text('Payload too large', 413)
  const rawBody = await req.text()
  if (rawBody.length > 1_000_000) return text('Payload too large', 413)

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch {
    return text('Webhook signature invalid', 400)
  }

  try {
    if (await beginEvent(event) === 'duplicate') {
      return Response.json({ received: true, duplicate: true })
    }

    let handled = true
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckout(event, event.data.object as Stripe.Checkout.Session)
        break
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await handleSubscription(event, event.data.object as Stripe.Subscription)
        break
      case 'invoice.paid':
      case 'invoice.payment_succeeded':
        await handleInvoicePaid(event, event.data.object as Stripe.Invoice)
        break
      case 'invoice.payment_failed':
        await handleInvoiceFailed(event, event.data.object as Stripe.Invoice)
        break
      case 'charge.refunded':
        await handleRefund(event, event.data.object as Stripe.Charge)
        break
      case 'charge.dispute.created':
      case 'charge.dispute.closed':
        await handleDispute(event, event.data.object as Stripe.Dispute)
        break
      default:
        handled = false
    }

    await finishEvent(event.id, handled ? 'processed' : 'ignored')
    return Response.json({ received: true })
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught)
    try {
      await finishEvent(event.id, 'failed', message)
    } catch {
      // Stripe will retry because the request still returns 500.
    }
    return text('Handler failed', 500)
  }
})

async function handleCheckout(event: Stripe.Event, session: Stripe.Checkout.Session) {
  const userId = session.client_reference_id || session.metadata?.supabase_user_id
  const subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id
  if (!userId || !subscriptionId || !(await isKnownUser(userId))) {
    throw new Error('Checkout has no valid Supabase user mapping')
  }

  if (typeof session.customer === 'string') {
    await stripe.customers.update(session.customer, {
      metadata: { supabase_user_id: userId },
    })
  }
  const subscription = await stripe.subscriptions.retrieve(subscriptionId)
  await upsertSubscription(event, userId, subscription, 'checkout_completed')
}

async function handleSubscription(event: Stripe.Event, subscription: Stripe.Subscription) {
  const userId = await resolveUserId(subscription)
  if (!userId) throw new Error(`No user mapping for subscription ${subscription.id}`)
  await upsertSubscription(event, userId, subscription, event.type)
}

async function upsertSubscription(
  event: Stripe.Event,
  userId: string,
  subscription: Stripe.Subscription,
  reason: string,
) {
  if (!(await isKnownUser(userId))) throw new Error('Subscription owner is not a known user')

  const { data: previous } = await adminClient
    .from('subscriptions')
    .select('status,grace_ends_at')
    .eq('user_id', userId)
    .maybeSingle()

  const item = subscription.items.data[0]
  const status = mapStatus(subscription.status)
  const interval = mapInterval(item?.price?.recurring)
  const row = {
    user_id: userId,
    stripe_customer_id: String(subscription.customer),
    stripe_subscription_id: subscription.id,
    status,
    plan_interval: interval,
    price_id: item?.price?.id || null,
    quantity: Math.max(1, item?.quantity || 1),
    current_period_start: iso(subscription.current_period_start),
    current_period_end: iso(subscription.current_period_end),
    grace_ends_at: status === 'grace'
      ? previous?.grace_ends_at || new Date(Date.now() + 3 * 86_400_000).toISOString()
      : null,
    cancel_at_period_end: subscription.cancel_at_period_end,
    canceled_at: subscription.canceled_at ? iso(subscription.canceled_at) : null,
    last_reconciled_at: new Date().toISOString(),
  }
  const { error } = await adminClient.from('subscriptions').upsert(row, { onConflict: 'user_id' })
  if (error) throw new Error(`Subscription upsert failed: ${error.message}`)
  if (previous?.status !== status) {
    await recordHistory(userId, event, previous?.status || null, status, reason, {
      subscription_id: subscription.id,
      interval,
      cancel_at_period_end: subscription.cancel_at_period_end,
    })
  }
}

async function handleInvoicePaid(event: Stripe.Event, invoice: Stripe.Invoice) {
  const subscriptionId = getSubscriptionId(invoice)
  if (!subscriptionId) return
  const { data: previous } = await adminClient
    .from('subscriptions')
    .select('user_id,status,grace_ends_at')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle()
  if (!previous?.user_id) return
  const { error } = await adminClient
    .from('subscriptions')
    .update({
      status: 'active',
      grace_ends_at: null,
      latest_invoice_id: invoice.id,
      last_reconciled_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', subscriptionId)
  if (error) throw new Error(`Invoice activation failed: ${error.message}`)
  if (previous.status !== 'active') {
    await recordHistory(previous.user_id, event, previous.status, 'active', 'invoice_paid', {
      invoice_id: invoice.id,
    })
  }
}

async function handleInvoiceFailed(event: Stripe.Event, invoice: Stripe.Invoice) {
  const subscriptionId = getSubscriptionId(invoice)
  if (!subscriptionId) return
  const { data: previous } = await adminClient
    .from('subscriptions')
    .select('user_id,status,grace_ends_at')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle()
  if (!previous?.user_id) return
  const graceEndsAt = previous.grace_ends_at || new Date(Date.now() + 3 * 86_400_000).toISOString()
  const { error } = await adminClient
    .from('subscriptions')
    .update({
      status: 'grace',
      grace_ends_at: graceEndsAt,
      latest_invoice_id: invoice.id,
      last_reconciled_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', subscriptionId)
  if (error) throw new Error(`Payment-failure transition failed: ${error.message}`)
  await recordHistory(previous.user_id, event, previous.status, 'grace', 'invoice_payment_failed', {
    invoice_id: invoice.id,
    grace_ends_at: graceEndsAt,
  })
}

async function handleRefund(event: Stripe.Event, charge: Stripe.Charge) {
  if (!charge.refunded) return
  const customerId = typeof charge.customer === 'string' ? charge.customer : charge.customer?.id
  if (!customerId) return
  await revokeByCustomer(event, customerId, 'refund')
}

async function handleDispute(event: Stripe.Event, dispute: Stripe.Dispute) {
  const charge = typeof dispute.charge === 'string'
    ? await stripe.charges.retrieve(dispute.charge)
    : dispute.charge
  const customerId = typeof charge.customer === 'string' ? charge.customer : charge.customer?.id
  if (!customerId) return
  const won = event.type === 'charge.dispute.closed' && dispute.status === 'won'
  if (won) {
    const { data } = await adminClient.from('subscriptions')
      .select('user_id,status').eq('stripe_customer_id', customerId).maybeSingle()
    if (!data?.user_id) return
    await adminClient.from('subscriptions').update({ status: 'active', grace_ends_at: null })
      .eq('stripe_customer_id', customerId)
    await recordHistory(data.user_id, event, data.status, 'active', 'dispute_won')
    return
  }
  await revokeByCustomer(event, customerId, `dispute_${dispute.status}`)
}

async function revokeByCustomer(event: Stripe.Event, customerId: string, reason: string) {
  const { data } = await adminClient.from('subscriptions')
    .select('user_id,status').eq('stripe_customer_id', customerId).maybeSingle()
  if (!data?.user_id) return
  const { error } = await adminClient.from('subscriptions')
    .update({ status: 'canceled', grace_ends_at: null, canceled_at: new Date().toISOString() })
    .eq('stripe_customer_id', customerId)
  if (error) throw new Error(`Entitlement revocation failed: ${error.message}`)
  await recordHistory(data.user_id, event, data.status, 'canceled', reason)
}

function getSubscriptionId(invoice: Stripe.Invoice): string | null {
  return typeof invoice.subscription === 'string'
    ? invoice.subscription
    : invoice.subscription?.id || null
}

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString()
}

function mapStatus(status: Stripe.Subscription.Status): EntitlementStatus {
  if (status === 'active' || status === 'trialing') return 'active'
  if (status === 'past_due' || status === 'unpaid') return 'grace'
  if (status === 'incomplete' || status === 'incomplete_expired') return 'expired'
  if (status === 'paused') return 'paused'
  if (status === 'canceled') return 'canceled'
  return 'expired'
}

function mapInterval(recurring: Stripe.Price.Recurring | null | undefined): string {
  if (recurring?.usage_type === 'metered') return 'metered'
  if (recurring?.interval === 'week') return 'weekly'
  if (recurring?.interval === 'year') return 'annual'
  return 'monthly'
}

async function resolveUserId(subscription: Stripe.Subscription): Promise<string | null> {
  const { data } = await adminClient
    .from('subscriptions')
    .select('user_id')
    .or(`stripe_subscription_id.eq.${subscription.id},stripe_customer_id.eq.${String(subscription.customer)}`)
    .maybeSingle()
  if (data?.user_id) return data.user_id
  const customer = await stripe.customers.retrieve(String(subscription.customer))
  if (!customer.deleted) return customer.metadata?.supabase_user_id || null
  return null
}

async function isKnownUser(userId: string): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return false
  }
  const { data, error } = await adminClient.auth.admin.getUserById(userId)
  if (error && (error.status === 400 || error.status === 404)) return false
  if (error) throw new Error(`Could not validate subscription owner: ${error.message}`)
  return Boolean(data.user)
}
