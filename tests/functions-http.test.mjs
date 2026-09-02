import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import Stripe from 'stripe'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DENO = resolve(ROOT, 'node_modules/.bin/deno')

function startFunction(entry, port, extraEnv = {}) {
  const proc = spawn(DENO, [
    'run',
    '--config', 'supabase/functions/deno.json',
    '--node-modules-dir=manual',
    '--allow-env',
    '--allow-net',
    '--allow-read',
    entry,
  ], {
    cwd: ROOT,
    env: { ...process.env, LISTEN_PORT: String(port), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stderr.setEncoding('utf8')
  proc.stdout.setEncoding('utf8')
  proc.logs = ''
  const collect = (chunk) => { proc.logs += chunk }
  proc.stderr.on('data', collect)
  proc.stdout.on('data', collect)
  return proc
}

function waitListening(proc, timeoutMs = 15000) {
  return new Promise((resolveReady, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (!settled) reject(new Error(`function did not listen: ${proc.logs.slice(-1000)}`))
    }, timeoutMs)
    const onData = () => {
      if (settled || !/Listening on/.test(proc.logs)) return
      settled = true
      clearTimeout(timeout)
      resolveReady()
    }
    proc.stderr.on('data', onData)
    proc.stdout.on('data', onData)
    proc.once('exit', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(new Error(`function exited ${code}: ${proc.logs.slice(-1000)}`))
    })
    onData()
  })
}

function freePort() {
  return 20000 + Math.floor(Math.random() * 10000)
}

async function withFunction(entry, extraEnv, fn) {
  const port = freePort()
  const proc = startFunction(entry, port, extraEnv)
  try {
    await waitListening(proc)
    await new Promise((resolve) => setTimeout(resolve, 80))
    await fn(port)
  } finally {
    proc.kill('SIGTERM')
    await Promise.race([
      new Promise((resolve) => proc.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ])
    if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL')
  }
}

test('keyless checkout returns a designed not-enabled state', { timeout: 30_000 }, async () => {
  await withFunction('supabase/functions/create-checkout/index.ts', {}, async (port) => {
    const keyless = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', body: '{}' })
    assert.equal(keyless.status, 503)
    const keylessBody = await keyless.json()
    assert.match(String(keylessBody.error), /Billing is not enabled/)
    assert.match(String(keylessBody.error_code), /^BILLING-503-[A-F0-9]{4}$/)
    const method = await fetch(`http://127.0.0.1:${port}/`, { method: 'GET' })
    assert.equal(method.status, 405)
  })
})

test('unsigned and oversized webhooks are rejected; test keys in production fail closed', { timeout: 45_000 }, async () => {
  const billingEnv = {
    STRIPE_SECRET_KEY: 'sk_test_123',
    STRIPE_WEBHOOK_SECRET: 'whsec_testsecret',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
  }
  await withFunction('supabase/functions/stripe-webhook/index.ts', billingEnv, async (port) => {
    const unsigned = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', body: '{}' })
    assert.equal(unsigned.status, 400)
    assert.match(await unsigned.text(), /Missing stripe-signature header/)

    const badSig = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'POST',
      headers: { 'stripe-signature': 't=1,v1=deadbeef' },
      body: '{"id":"evt_1"}',
    })
    assert.equal(badSig.status, 400)
    assert.match(await badSig.text(), /Webhook signature invalid/)

    const huge = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'POST',
      headers: { 'stripe-signature': 't=1,v1=deadbeef' },
      body: 'x'.repeat(1_000_001),
    })
    assert.equal(huge.status, 413)
  })

  await withFunction('supabase/functions/stripe-webhook/index.ts', {
    ...billingEnv,
    APP_ENV: 'production',
  }, async (port) => {
    const testInProd = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', body: '{}' })
    assert.equal(testInProd.status, 500)
    assert.match(await testInProd.text(), /Test-mode payment key present in production-flagged config/)
  })

  const stripe = new Stripe('sk_test_123', { apiVersion: '2023-10-16' })
  const payload = JSON.stringify({ id: 'evt_test', object: 'event', type: 'ping', data: { object: {} } })
  assert.throws(() => stripe.webhooks.constructEvent(payload, 't=1,v1=nope', 'whsec_testsecret'))
  const stamp = Math.floor(Date.now() / 1000)
  const valid = createHmac('sha256', 'whsec_testsecret').update(`${stamp}.${payload}`).digest('hex')
  assert.doesNotThrow(() => stripe.webhooks.constructEvent(payload, `t=${stamp},v1=${valid}`, 'whsec_testsecret'))
})
