// ══════════════════════════════════════════════════════════════
// APEX Voice Engine — Stripe Webhook Edge Function
//
// Deploy:
//   supabase functions deploy stripe-webhook --no-verify-jwt
//
// Required secrets (set in Supabase Dashboard → Edge Functions
// → stripe-webhook → Secrets):
//   STRIPE_SECRET_KEY         = sk_live_...
//   STRIPE_WEBHOOK_SECRET     = whsec_...  (from Stripe → Webhooks)
//   SUPABASE_SERVICE_ROLE_KEY = (Supabase Dashboard → Settings → API → service_role key)
// Note: SUPABASE_URL and SUPABASE_ANON_KEY are injected automatically by the runtime.
//
// Stripe Dashboard → Developers → Webhooks → Add endpoint:
//   URL: https://<project-ref>.supabase.co/functions/v1/stripe-webhook
//   Events to subscribe:
//     checkout.session.completed
//     customer.subscription.created
//     customer.subscription.updated
//     customer.subscription.deleted
//     invoice.payment_failed
// ══════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''

// Service-role client — bypasses RLS to write subscription rows
const adminClient = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } }
)

serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // ── 1. Verify Stripe signature ───────────────────────────────
  const sig = req.headers.get('stripe-signature')
  if (!sig) {
    return new Response('Missing stripe-signature header', { status: 400 })
  }

  const rawBody = await req.text()
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('Stripe signature verification failed:', msg)
    return new Response(`Webhook signature invalid: ${msg}`, { status: 400 })
  }

  // ── 2. Route to handler ──────────────────────────────────────
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
        break

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpsert(event.data.object as Stripe.Subscription)
        break

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
        break

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.Invoice)
        break

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`Handler error for ${event.type}:`, msg)
    // Return 500 so Stripe retries; idempotent handlers make this safe
    return new Response(`Handler failed: ${msg}`, { status: 500 })
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})

// ─────────────────────────────────────────────────────────────
// checkout.session.completed
// Links the Stripe customer to the Supabase user via
// client_reference_id (set to the Supabase user UUID in goStripe())
// ─────────────────────────────────────────────────────────────
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userId    = session.client_reference_id
  const subId     = session.subscription as string
  const customerId = session.customer as string

  if (!userId) {
    console.warn('checkout.session.completed — no client_reference_id, skipping')
    return
  }

  if (!subId) {
    console.warn('checkout.session.completed — no subscription ID, skipping')
    return
  }

  // Fetch the full subscription object from Stripe
  const sub = await stripe.subscriptions.retrieve(subId)
  await upsertSubscription(userId, sub, customerId)
}

// ─────────────────────────────────────────────────────────────
// customer.subscription.created / updated
// ─────────────────────────────────────────────────────────────
async function handleSubscriptionUpsert(sub: Stripe.Subscription) {
  // Look up the Supabase user_id from the customer metadata or
  // from our subscriptions table (customer may already be mapped)
  const userId = await resolveUserId(sub)
  if (!userId) {
    console.warn(`Could not resolve user_id for subscription ${sub.id}`)
    return
  }
  await upsertSubscription(userId, sub)
}

// ─────────────────────────────────────────────────────────────
// customer.subscription.deleted
// ─────────────────────────────────────────────────────────────
async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
  const { error } = await adminClient
    .from('subscriptions')
    .update({
      status:               'canceled',
      cancel_at_period_end: false,
      updated_at:           new Date().toISOString(),
    })
    .eq('stripe_subscription_id', sub.id)

  if (error) throw new Error(`DB update failed: ${error.message}`)
}

// ─────────────────────────────────────────────────────────────
// invoice.payment_failed
// ─────────────────────────────────────────────────────────────
async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const subId = typeof invoice.subscription === 'string'
    ? invoice.subscription
    : invoice.subscription?.id

  if (!subId) return

  const { error } = await adminClient
    .from('subscriptions')
    .update({
      status:     'past_due',
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', subId)

  if (error) throw new Error(`DB update failed: ${error.message}`)
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
async function resolveUserId(sub: Stripe.Subscription): Promise<string | null> {
  // 1. Check existing row in our DB
  const { data } = await adminClient
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', sub.customer as string)
    .maybeSingle()

  if (data?.user_id) return data.user_id

  // 2. Check Stripe customer metadata (populated if set at customer creation)
  try {
    const customer = await stripe.customers.retrieve(sub.customer as string)
    if (!customer.deleted && (customer as Stripe.Customer).metadata?.supabase_user_id) {
      return (customer as Stripe.Customer).metadata.supabase_user_id
    }
  } catch {
    // Customer retrieve failed — not a fatal error
  }

  return null
}

type StripeSubStatus = 'active' | 'past_due' | 'canceled' | 'incomplete' |
  'incomplete_expired' | 'trialing' | 'unpaid' | 'paused'

function mapStatus(stripeStatus: StripeSubStatus): string {
  const map: Record<StripeSubStatus, string> = {
    active:              'active',
    trialing:            'trial',
    past_due:            'past_due',
    canceled:            'canceled',
    unpaid:              'past_due',
    incomplete:          'past_due',
    incomplete_expired:  'expired',
    paused:              'canceled',
  }
  return map[stripeStatus] ?? 'canceled'
}

async function upsertSubscription(
  userId: string,
  sub: Stripe.Subscription,
  customerId?: string
) {
  const item        = sub.items.data[0]
  const interval    = item?.price?.recurring?.interval === 'year' ? 'annual' : 'monthly'
  const mappedStatus = mapStatus(sub.status as StripeSubStatus)

  const row = {
    user_id:                userId,
    stripe_customer_id:     (customerId ?? sub.customer) as string,
    stripe_subscription_id: sub.id,
    status:                 mappedStatus,
    plan_interval:          interval,
    current_period_start:   new Date(sub.current_period_start * 1000).toISOString(),
    current_period_end:     new Date(sub.current_period_end * 1000).toISOString(),
    cancel_at_period_end:   sub.cancel_at_period_end,
    updated_at:             new Date().toISOString(),
  }

  const { error } = await adminClient
    .from('subscriptions')
    .upsert(row, { onConflict: 'user_id' })

  if (error) throw new Error(`DB upsert failed: ${error.message}`)

  console.log(`Subscription upserted — user: ${userId}, status: ${mappedStatus}`)
}
