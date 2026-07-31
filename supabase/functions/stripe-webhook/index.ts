import Stripe from 'npm:stripe@14.21.0'
import {
  claimBillingEvent,
  finalizeBillingEvent,
  processStripeEvent,
} from '../_shared/stripe-workflows.ts'
import { adminClient, serverConfigured } from '../_shared/supabase.ts'

const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY') || ''
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') || ''
const stripe = new Stripe(stripeSecret || 'not-configured', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})
const text = (message: string, status = 200) =>
  new Response(message, { status, headers: { 'Cache-Control': 'no-store' } })

Deno.serve(async req => {
  if (req.method !== 'POST') return text('Method not allowed', 405)
  if (!stripeSecret || !webhookSecret || !serverConfigured(true)) {
    return text('Billing webhook is not configured', 503)
  }
  const signature = req.headers.get('stripe-signature')
  if (!signature) return text('Missing stripe-signature header', 400)
  if (Number(req.headers.get('content-length') || 0) > 1_000_000) return text('Payload too large', 413)
  const rawBody = await req.text()
  if (rawBody.length > 1_000_000) return text('Payload too large', 413)

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch {
    return text('Webhook signature invalid', 400)
  }

  const admin = adminClient()
  try {
    if (!(await claimBillingEvent(admin, event))) {
      return Response.json({ received: true, duplicate: true })
    }
    const handled = await processStripeEvent(admin, stripe, event)
    await finalizeBillingEvent(admin, event.id, handled ? 'processed' : 'ignored')
    return Response.json({ received: true })
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught)
    await finalizeBillingEvent(admin, event.id, 'failed', message).catch(() => undefined)
    return text('Handler failed', 500)
  }
})
