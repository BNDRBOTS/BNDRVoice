export function readEnv(name: string): string {
  return Deno.env.get(name) || ''
}

export function missingNamed(names: readonly string[]): string[] {
  return names.filter(name => !readEnv(name).trim())
}

export function missingMessage(names: string[]): string {
  if (names.length === 1) return `Missing required environment variable: ${names[0]}`
  return `Missing required environment variables: ${names.join(', ')}`
}

export function testStripeKeyInProduction(): boolean {
  const flag = readEnv('APP_ENV') || readEnv('NODE_ENV')
  const key = readEnv('STRIPE_SECRET_KEY')
  return /^(prod|production)$/i.test(flag) && key.startsWith('sk_test_')
}

export function testKeysInProdMessage(): string {
  return 'Test-mode payment key present in production-flagged config (STRIPE_SECRET_KEY, APP_ENV)'
}
