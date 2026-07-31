import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.110.5'
import Stripe from 'npm:stripe@14.21.0'

type EntitlementStatus = 'active' | 'grace' | 'suspended' | 'expired'

export async function claimBillingEvent(
  admin: SupabaseClient,
  event: Stripe.Event,
): Promise<boolean> {
  const object = event.data.object as { id?: string }
  const encoded = new TextEncoder().encode(JSON.stringify({
    event_id: event.id,
    event_type: event.type,
    livemode: event.livemode,
    object_id: object?.id || null,
  }))
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  const payloadHash = [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0')).join('')
  const { data, error } = await admin.rpc('claim_billing_event', {
    p_event_id: event.id,
    p_event_type: event.type,
    p_livemode: event.livemode,
    p_payload_hash: payloadHash,
  })
  if (error) throw new Error(`Could not claim billing event: ${error.message}`)
  return Boolean(data)
}

export async function finalizeBillingEvent(
  admin: SupabaseClient,
  eventId: string,
  state: 'processed' | 'ignored' | 'failed',
  processingError?: string,
): Promise<void> {
  const retryAt = state === 'failed'
    ? new Date(Date.now() + 15 * 60_000).toISOString()
    : null
  const { error } = await admin.from('billing_events').update({
    processing_state: state,
    processing_error: processingError?.slice(0, 1000) || null,
    next_attempt_at: retryAt,
    processed_at: state === 'failed' ? null : new Date().toISOString(),
  }).eq('stripe_event_id', eventId)
  if (error) throw new Error(`Could not finalize billing event: ${error.message}`)
}

async function setEntitlement(
  admin: SupabaseClient,
  userId: string,
  status: EntitlementStatus,
  validUntil: string | null,
  graceUntil: string | null,
  sourceRef: string,
  reason: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await admin.rpc('set_entitlement', {
    p_user_id: userId,
    p_status: status,
    p_product_tier: 'pro',
    p_source: 'stripe',
    p_source_ref: sourceRef,
    p_valid_until: validUntil,
    p_grace_until: graceUntil,
    p_daily_limit: 50,
    p_reason: reason,
    p_metadata: metadata,
  })
  if (error) throw new Error(`Entitlement update failed: ${error.message}`)
}

function iso(seconds?: number | null): string | null {
  return seconds ? new Date(seconds * 1000).toISOString() : null
}

function billingStatus(status: Stripe.Subscription.Status): string {
  if (status === 'active' || status === 'trialing') return 'active'
  if (status === 'past_due' || status === 'unpaid') return 'grace'
  if (status === 'paused') return 'paused'
  if (status === 'canceled') return 'canceled'
  return 'expired'
}

function entitlementStatus(status: string): EntitlementStatus {
  if (status === 'active') return 'active'
  if (status === 'grace') return 'grace'
  if (status === 'paused') return 'suspended'
  return 'expired'
}

function planInterval(recurring: Stripe.Price.Recurring | null | undefined): string {
  if (recurring?.usage_type === 'metered') return 'metered'
  if (recurring?.interval === 'week') return 'weekly'
  if (recurring?.interval === 'year') return 'annual'
  return 'monthly'
}

async function knownUser(admin: SupabaseClient, userId: string): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return false
  }
  const { data, error } = await admin.auth.admin.getUserById(userId)
  if (error && (error.status === 400 || error.status === 404)) return false
  if (error) throw new Error(`Could not validate subscription owner: ${error.message}`)
  return Boolean(data.user)
}

async function resolveUserId(
  admin: SupabaseClient,
  stripe: Stripe,
  subscription: Stripe.Subscription,
): Promise<string | null> {
  const { data } = await admin.from('subscriptions').select('user_id')
    .or(`stripe_subscription_id.eq.${subscription.id},stripe_customer_id.eq.${String(subscription.customer)}`)
    .maybeSingle()
  if (data?.user_id) return data.user_id
  const customer = await stripe.customers.retrieve(String(subscription.customer))
  return customer.deleted ? null : customer.metadata?.supabase_user_id || null
}

export async function syncStripeSubscription(
  admin: SupabaseClient,
  stripe: Stripe,
  subscription: Stripe.Subscription,
  reason: string,
  explicitUserId?: string,
): Promise<void> {
  const userId = explicitUserId || await resolveUserId(admin, stripe, subscription)
  if (!userId || !(await knownUser(admin, userId))) {
    throw new Error(`No valid user mapping for subscription ${subscription.id}`)
  }
  const { data: previous } = await admin.from('subscriptions')
    .select('grace_ends_at').eq('user_id', userId).maybeSingle()
  const status = billingStatus(subscription.status)
  const graceUntil = status === 'grace'
    ? previous?.grace_ends_at || new Date(Date.now() + 3 * 86_400_000).toISOString()
    : null
  const item = subscription.items.data[0]
  const validUntil = iso(subscription.current_period_end)
  const { error } = await admin.from('subscriptions').upsert({
    user_id: userId,
    stripe_customer_id: String(subscription.customer),
    stripe_subscription_id: subscription.id,
    status,
    plan_interval: planInterval(item?.price?.recurring),
    price_id: item?.price?.id || null,
    quantity: Math.max(1, item?.quantity || 1),
    current_period_start: iso(subscription.current_period_start),
    current_period_end: validUntil,
    grace_ends_at: graceUntil,
    cancel_at_period_end: subscription.cancel_at_period_end,
    canceled_at: iso(subscription.canceled_at),
    last_reconciled_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
  if (error) throw new Error(`Subscription update failed: ${error.message}`)
  await setEntitlement(
    admin,
    userId,
    entitlementStatus(status),
    validUntil,
    graceUntil,
    subscription.id,
    reason,
    { subscription_id: subscription.id, stripe_status: subscription.status },
  )
}

async function userByCustomer(admin: SupabaseClient, customerId: string): Promise<string | null> {
  const { data } = await admin.from('subscriptions')
    .select('user_id').eq('stripe_customer_id', customerId).maybeSingle()
  return data?.user_id || null
}

export async function processStripeEvent(
  admin: SupabaseClient,
  stripe: Stripe,
  event: Stripe.Event,
): Promise<boolean> {
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const userId = session.client_reference_id || session.metadata?.supabase_user_id
    const subscriptionId = typeof session.subscription === 'string'
      ? session.subscription : session.subscription?.id
    if (!userId || !subscriptionId) throw new Error('Checkout has no user/subscription mapping')
    if (typeof session.customer === 'string') {
      await stripe.customers.update(session.customer, { metadata: { supabase_user_id: userId } })
    }
    await syncStripeSubscription(
      admin,
      stripe,
      await stripe.subscriptions.retrieve(subscriptionId),
      'checkout_completed',
      userId,
    )
    return true
  }

  if (event.type.startsWith('customer.subscription.')) {
    await syncStripeSubscription(
      admin,
      stripe,
      event.data.object as Stripe.Subscription,
      event.type,
    )
    return true
  }

  if (['invoice.paid', 'invoice.payment_succeeded', 'invoice.payment_failed'].includes(event.type)) {
    const invoice = event.data.object as Stripe.Invoice
    const subscriptionId = typeof invoice.subscription === 'string'
      ? invoice.subscription : invoice.subscription?.id
    if (!subscriptionId) return true
    await syncStripeSubscription(
      admin,
      stripe,
      await stripe.subscriptions.retrieve(subscriptionId),
      event.type,
    )
    await admin.from('subscriptions').update({ latest_invoice_id: invoice.id })
      .eq('stripe_subscription_id', subscriptionId)
    return true
  }

  if (event.type === 'charge.refunded' || event.type.startsWith('charge.dispute.')) {
    const object = event.data.object as Stripe.Charge | Stripe.Dispute
    const charge = 'charge' in object
      ? (typeof object.charge === 'string' ? await stripe.charges.retrieve(object.charge) : object.charge)
      : object
    const customerId = typeof charge.customer === 'string' ? charge.customer : charge.customer?.id
    if (!customerId) return true
    const userId = await userByCustomer(admin, customerId)
    if (!userId) return true
    if (event.type === 'charge.refunded' && charge.amount_refunded < charge.amount) return true
    const disputeWon = event.type === 'charge.dispute.closed'
      && (object as Stripe.Dispute).status === 'won'
    if (disputeWon) {
      const { data } = await admin.from('subscriptions')
        .select('stripe_subscription_id').eq('user_id', userId).maybeSingle()
      if (data?.stripe_subscription_id) {
        await syncStripeSubscription(
          admin,
          stripe,
          await stripe.subscriptions.retrieve(data.stripe_subscription_id),
          'charge.dispute.closed',
          userId,
        )
      }
      return true
    }
    await setEntitlement(admin, userId, 'suspended', null, null, event.id, event.type, {
      stripe_event_id: event.id,
    })
    return true
  }

  return false
}
