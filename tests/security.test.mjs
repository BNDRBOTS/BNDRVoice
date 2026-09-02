import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const read = (file) => readFileSync(join(ROOT, file), 'utf8')

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'SHIP_REVIEW') continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, acc)
    else acc.push(full)
  }
  return acc
}

test('no .env files or source maps are shipped, and client config has no server secrets', () => {
  const files = walk(ROOT)
  for (const file of files) {
    const rel = file.slice(ROOT.length + 1)
    assert.doesNotMatch(rel, /(^|\/)\.env$/, rel)
    assert.doesNotMatch(rel, /\.map$/, rel)
  }
  const config = read('config.js')
  assert.doesNotMatch(config, /sk_live_|sk_test_|whsec_|service_role|SUPABASE_SERVICE_ROLE/)
  assert.doesNotMatch(config, /ANTHROPIC_API_KEY|OPENAI_API_KEY|DEEPSEEK_API_KEY/)
  const app = read('app.html')
  assert.doesNotMatch(app, /service_role/)
  assert.match(read('.gitignore'), /\.env/)
  assert.match(read('.gitignore'), /\*\.map/)
})

test('mutating edge functions reject unauthenticated calls in source and paginate lists', () => {
  for (const file of [
    'supabase/functions/ai-proxy/index.ts',
    'supabase/functions/create-checkout/index.ts',
    'supabase/functions/billing-portal/index.ts',
    'supabase/functions/account-delete/index.ts',
    'supabase/functions/redeem-access/index.ts',
    'supabase/functions/error-report/index.ts',
  ]) {
    const src = read(file)
    assert.match(src, /Bearer /, file)
    assert.match(src, /401/, file)
  }
  assert.match(read('app.html'), /limit\(20\)/)
  assert.match(read('supabase/functions/ai-proxy/index.ts'), /check_rate_limit|enforceRateLimit/)
  assert.match(read('supabase/functions/create-checkout/index.ts'), /enforceRateLimit/)
  assert.doesNotMatch(read('supabase/functions/ai-proxy/index.ts'), /Access-Control-Allow-Origin': '\*'/)
})

test('production-content grep finds no lorem, TODO, or FIXME in shipped product files', () => {
  const shipped = [
    'index.html', 'app.html', 'privacy.html', 'terms.html', 'pricing.html', '404.html', '500.html',
    'config.js', 'README.md', 'DEPLOYMENT.md',
  ]
  for (const file of shipped) {
    const text = read(file)
    assert.doesNotMatch(text, /\bTODO\b|\bFIXME\b|\bHACK\b|lorem ipsum/i, file)
  }
})
