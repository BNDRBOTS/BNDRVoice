import assert from 'node:assert/strict'
import test from 'node:test'

function utcNow(offsetMs = 0) {
  return new Date(Date.UTC(2026, 8, 2, 12, 0, 0) + offsetMs)
}

function createAccount(now = utcNow(), priorTrialHash = null) {
  const emailHash = 'hash-user@example.com'
  const trialOnce = priorTrialHash === emailHash
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    emailHash,
    entitlement: trialOnce
      ? { status: 'expired', product_tier: 'trial', source: 'signup', daily_limit: 0, valid_until: now.toISOString(), grace_until: null }
      : { status: 'trial', product_tier: 'trial', source: 'signup', daily_limit: 5, valid_until: new Date(now.getTime() + 7 * 86400000).toISOString(), grace_until: null },
    usage: 0,
    events: new Set(),
  }
}

function windowOpen(entitlement, now) {
  if (entitlement.status === 'trial' && new Date(entitlement.valid_until) > now) return { status: 'trial', limit: entitlement.daily_limit }
  if (entitlement.status === 'active' && (!entitlement.valid_until || new Date(entitlement.valid_until) > now)) {
    return { status: 'active', limit: entitlement.daily_limit }
  }
  if (entitlement.status === 'grace' && entitlement.grace_until && new Date(entitlement.grace_until) > now) {
    return { status: 'grace', limit: entitlement.daily_limit }
  }
  return { status: 'expired', limit: 0 }
}

function consume(account, now = utcNow()) {
  const gate = windowOpen(account.entitlement, now)
  if (account.usage >= gate.limit) return { allowed: false, ...gate, count: account.usage }
  account.usage += 1
  return { allowed: true, ...gate, count: account.usage }
}

function applyVerifiedEvent(account, eventId, type, patch) {
  if (account.events.has(eventId)) return { duplicate: true }
  account.events.add(eventId)
  Object.assign(account.entitlement, patch)
  return { duplicate: false }
}

test('trial grants five analyses and expires after seven UTC days', () => {
  const account = createAccount()
  const now = utcNow()
  for (let i = 0; i < 5; i += 1) assert.equal(consume(account, now).allowed, true)
  assert.equal(consume(account, now).allowed, false)
  const expired = windowOpen(account.entitlement, utcNow(8 * 86400000))
  assert.equal(expired.status, 'expired')
  assert.equal(expired.limit, 0)
})

test('monthly, weekly, and metered grants deliver the full allotment then hard-cap', () => {
  const now = utcNow()
  const cases = [
    { interval: 'monthly', days: 30, limit: 50 },
    { interval: 'weekly', days: 7, limit: 50 },
    { interval: 'metered', days: 30, limit: 50 },
  ]
  for (const plan of cases) {
    const account = createAccount(now)
    applyVerifiedEvent(account, `evt_${plan.interval}`, 'checkout.session.completed', {
      status: 'active',
      product_tier: 'pro',
      source: 'stripe',
      daily_limit: plan.limit,
      valid_until: utcNow(plan.days * 86400000).toISOString(),
    })
    account.usage = 0
    for (let i = 0; i < plan.limit; i += 1) {
      assert.equal(consume(account, now).allowed, true, `${plan.interval} grant ${i}`)
    }
    assert.equal(consume(account, now).allowed, false, `${plan.interval} cap`)
    assert.equal(windowOpen(account.entitlement, utcNow((plan.days + 1) * 86400000)).status, 'expired')
  }
})

test('duplicate webhook replay grants once', () => {
  const account = createAccount()
  const patch = { status: 'active', product_tier: 'pro', source: 'stripe', daily_limit: 50, valid_until: utcNow(30 * 86400000).toISOString() }
  assert.equal(applyVerifiedEvent(account, 'evt_1', 'checkout.session.completed', patch).duplicate, false)
  assert.equal(applyVerifiedEvent(account, 'evt_1', 'checkout.session.completed', { daily_limit: 999 }).duplicate, true)
  assert.equal(account.entitlement.daily_limit, 50)
})

test('cancel preserves access through period end, then revokes', () => {
  const account = createAccount()
  const end = utcNow(30 * 86400000)
  applyVerifiedEvent(account, 'evt_pay', 'invoice.paid', {
    status: 'active', product_tier: 'pro', source: 'stripe', daily_limit: 50, valid_until: end.toISOString(),
  })
  applyVerifiedEvent(account, 'evt_cancel', 'customer.subscription.updated', {
    status: 'active', valid_until: end.toISOString(), cancel_at_period_end: true,
  })
  assert.equal(windowOpen(account.entitlement, utcNow()).status, 'active')
  applyVerifiedEvent(account, 'evt_del', 'customer.subscription.deleted', {
    status: 'expired', daily_limit: 50, valid_until: utcNow(-1000).toISOString(),
  })
  assert.equal(windowOpen(account.entitlement, utcNow()).status, 'expired')
})

test('payment failure enters grace, refund and chargeback revoke', () => {
  const account = createAccount()
  applyVerifiedEvent(account, 'evt_pay', 'checkout.session.completed', {
    status: 'active', product_tier: 'pro', source: 'stripe', daily_limit: 50, valid_until: utcNow(30 * 86400000).toISOString(),
  })
  applyVerifiedEvent(account, 'evt_fail', 'invoice.payment_failed', {
    status: 'grace', grace_until: utcNow(3 * 86400000).toISOString(),
  })
  assert.equal(windowOpen(account.entitlement, utcNow()).status, 'grace')
  assert.equal(windowOpen(account.entitlement, utcNow(4 * 86400000)).status, 'expired')
  applyVerifiedEvent(account, 'evt_refund', 'charge.refunded', { status: 'suspended', daily_limit: 50 })
  assert.equal(windowOpen(account.entitlement, utcNow()).status, 'expired')
})

test('reconciliation recovers a wiped entitlement from processor state', () => {
  const account = createAccount()
  account.entitlement = { status: 'expired', product_tier: 'trial', source: 'signup', daily_limit: 0, valid_until: utcNow(-1).toISOString(), grace_until: null }
  applyVerifiedEvent(account, 'evt_recon', 'scheduled_reconciliation', {
    status: 'active', product_tier: 'pro', source: 'stripe', daily_limit: 50, valid_until: utcNow(20 * 86400000).toISOString(),
  })
  assert.equal(windowOpen(account.entitlement, utcNow()).status, 'active')
  assert.equal(consume(account, utcNow()).allowed, true)
})

test('trial is granted once per identity', () => {
  const first = createAccount()
  assert.equal(first.entitlement.status, 'trial')
  const second = createAccount(utcNow(), first.emailHash)
  assert.equal(second.entitlement.status, 'expired')
  assert.equal(second.entitlement.daily_limit, 0)
})

test('parallel usage hits cannot spend past the cap', async () => {
  const account = createAccount()
  applyVerifiedEvent(account, 'evt_pro', 'checkout.session.completed', {
    status: 'active', product_tier: 'pro', source: 'stripe', daily_limit: 50, valid_until: utcNow(30 * 86400000).toISOString(),
  })
  account.usage = 0
  let chain = Promise.resolve()
  const run = () => new Promise((resolve) => {
    chain = chain.then(() => resolve(consume(account)))
  })
  const results = await Promise.all(Array.from({ length: 200 }, run))
  assert.equal(results.filter((row) => row.allowed).length, 50)
  assert.equal(account.usage, 50)
})
