import type Stripe from 'npm:stripe@14.21.0'
import { processStripeEvent } from './stripe-workflows.ts'

function assertEquals(actual: unknown, expected: unknown, message = '') {
  if (actual !== expected) {
    throw new Error(`${message} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

const USER = '11111111-1111-4111-8111-111111111111'

function mockAdmin() {
  const entitlements = new Map<string, Record<string, unknown>>()
  const subscriptions = new Map<string, Record<string, unknown>>()
  const events = new Map<string, boolean>()
  return {
    entitlements,
    subscriptions,
    events,
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'claim_billing_event') {
        const id = String(args.p_event_id)
        if (events.get(id)) return { data: false, error: null }
        events.set(id, true)
        return { data: true, error: null }
      }
      if (name === 'set_entitlement') {
        entitlements.set(String(args.p_user_id), args)
        return { data: null, error: null }
      }
      return { data: null, error: null }
    },
    from(table: string) {
      const api: Record<string, unknown> = {}
      api.select = () => api
      api.eq = () => api
      api.or = () => api
      api.maybeSingle = async () => {
        if (table === 'subscriptions') {
          const row = [...subscriptions.values()][0] || null
          return { data: row, error: null }
        }
        return { data: null, error: null }
      }
      api.upsert = async (row: Record<string, unknown>) => {
        subscriptions.set(String(row.user_id), row)
        return { error: null }
      }
      api.update = () => ({ eq: async () => ({ error: null }) })
      return api
    },
    auth: {
      admin: {
        getUserById: async (id: string) => ({
          data: { user: id === USER ? { id } : null },
          error: id === USER ? null : { status: 404 },
        }),
      },
    },
  }
}

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    current_period_start: 1_788_000_000,
    current_period_end: 1_790_592_000,
    cancel_at_period_end: false,
    canceled_at: null,
    items: { data: [{ quantity: 1, price: { id: 'price_month', recurring: { interval: 'month', usage_type: 'licensed' } } }] },
    ...overrides,
  }
}

function stripeMock(sub = subscription()) {
  return {
    customers: {
      update: async () => ({}),
      retrieve: async () => ({ deleted: false, metadata: { supabase_user_id: USER } }),
    },
    subscriptions: { retrieve: async () => sub },
    charges: { retrieve: async () => ({ customer: 'cus_1', amount: 1900, amount_refunded: 1900 }) },
  } as unknown as Stripe
}

Deno.test('checkout.session.completed grants an active entitlement', async () => {
  const admin = mockAdmin()
  const sub = subscription()
  const event = {
    id: 'evt_checkout',
    type: 'checkout.session.completed',
    livemode: false,
    data: {
      object: {
        client_reference_id: USER,
        customer: 'cus_1',
        subscription: 'sub_1',
      },
    },
  } as unknown as Stripe.Event
  const handled = await processStripeEvent(admin as never, stripeMock(sub), event)
  assertEquals(handled, true)
  assertEquals(admin.entitlements.get(USER)?.p_status, 'active')
  assertEquals(admin.subscriptions.get(USER)?.status, 'active')
})

Deno.test('invoice.payment_failed moves the account into grace', async () => {
  const admin = mockAdmin()
  admin.subscriptions.set(USER, { user_id: USER, stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' })
  const sub = subscription({ status: 'past_due' })
  const event = {
    id: 'evt_fail',
    type: 'invoice.payment_failed',
    livemode: false,
    data: { object: { id: 'in_1', subscription: 'sub_1' } },
  } as unknown as Stripe.Event
  await processStripeEvent(admin as never, stripeMock(sub), event)
  assertEquals(admin.entitlements.get(USER)?.p_status, 'grace')
})

Deno.test('full refund suspends entitlement', async () => {
  const admin = mockAdmin()
  admin.subscriptions.set(USER, { user_id: USER, stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' })
  const event = {
    id: 'evt_refund',
    type: 'charge.refunded',
    livemode: false,
    data: { object: { customer: 'cus_1', amount: 1900, amount_refunded: 1900 } },
  } as unknown as Stripe.Event
  await processStripeEvent(admin as never, stripeMock(), event)
  assertEquals(admin.entitlements.get(USER)?.p_status, 'suspended')
})
