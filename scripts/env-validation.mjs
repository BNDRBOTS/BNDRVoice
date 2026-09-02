export const REQUIRED_PUBLIC = ['SUPABASE_URL', 'SUPABASE_ANON_KEY']
export const REQUIRED_SERVER = ['SUPABASE_URL']

export function missingNamed(env, names) {
  return names.filter((name) => !String(env[name] || '').trim())
}

export function missingMessage(names) {
  if (names.length === 1) return `Missing required environment variable: ${names[0]}`
  return `Missing required environment variables: ${names.join(', ')}`
}

export function testStripeKeyInProduction(env) {
  const flag = String(env.APP_ENV || env.NODE_ENV || '')
  const key = String(env.STRIPE_SECRET_KEY || '')
  return /^(prod|production)$/i.test(flag) && key.startsWith('sk_test_')
}

export function testKeysInProdMessage() {
  return 'Test-mode payment key present in production-flagged config (STRIPE_SECRET_KEY, APP_ENV)'
}

export function validateBoot(env, required) {
  const missing = missingNamed(env, required)
  if (missing.length) return { ok: false, message: missingMessage(missing), missing }
  if (testStripeKeyInProduction(env)) {
    return { ok: false, message: testKeysInProdMessage(), missing: ['STRIPE_SECRET_KEY'] }
  }
  return { ok: true, message: 'ok', missing: [] }
}
