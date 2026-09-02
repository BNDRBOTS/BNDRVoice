import assert from 'node:assert/strict'
import test from 'node:test'
import {
  REQUIRED_PUBLIC,
  REQUIRED_SERVER,
  missingMessage,
  missingNamed,
  testKeysInProdMessage,
  testStripeKeyInProduction,
  validateBoot,
} from '../scripts/env-validation.mjs'

test('boot fails fast with the named variable when each required public var is missing', () => {
  for (const name of REQUIRED_PUBLIC) {
    const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon' }
    delete env[name]
    const result = validateBoot(env, REQUIRED_PUBLIC)
    assert.equal(result.ok, false)
    assert.deepEqual(result.missing, [name])
    assert.equal(result.message, missingMessage([name]))
    assert.match(result.message, new RegExp(name))
  }
})

test('boot fails fast with named variables when required server vars are missing', () => {
  for (const name of REQUIRED_SERVER) {
    const result = validateBoot({}, [name])
    assert.equal(result.ok, false)
    assert.equal(result.message, `Missing required environment variable: ${name}`)
  }
})

test('production-flagged config rejects Stripe test keys', () => {
  assert.equal(testStripeKeyInProduction({
    APP_ENV: 'production',
    STRIPE_SECRET_KEY: 'sk_test_123',
  }), true)
  assert.equal(validateBoot({
    SUPABASE_URL: 'https://example.supabase.co',
    APP_ENV: 'production',
    STRIPE_SECRET_KEY: 'sk_test_123',
  }, ['SUPABASE_URL']).message, testKeysInProdMessage())
  assert.equal(testStripeKeyInProduction({
    APP_ENV: 'production',
    STRIPE_SECRET_KEY: 'sk_live_123',
  }), false)
  assert.equal(testStripeKeyInProduction({
    APP_ENV: 'development',
    STRIPE_SECRET_KEY: 'sk_test_123',
  }), false)
})

test('missingNamed ignores empty strings', () => {
  assert.deepEqual(missingNamed({ FOO: '  ' }, ['FOO']), ['FOO'])
  assert.deepEqual(missingNamed({ FOO: 'ok' }, ['FOO']), [])
})
