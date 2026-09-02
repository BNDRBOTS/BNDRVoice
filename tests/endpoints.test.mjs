import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PORT = 4179
const BASE = `http://127.0.0.1:${PORT}`

function waitForServer(proc) {
  return new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error('preview server did not start')), 5000)
    proc.stdout.on('data', (chunk) => {
      if (!String(chunk).includes('BNDR preview')) return
      clearTimeout(timeout)
      resolveReady()
    })
    proc.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`preview server exited early (${code})`))
    })
  })
}

test('production-mode preview serves every public route and a reporting 404', { timeout: 20_000 }, async () => {
  const server = spawn(process.execPath, ['tests/server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await waitForServer(server)
  try {
    const pages = {
      '/': 200,
      '/index.html': 200,
      '/app': 200,
      '/app.html': 200,
      '/privacy': 200,
      '/terms': 200,
      '/pricing': 200,
      '/pricing.html': 200,
      '/robots.txt': 200,
      '/sitemap.xml': 200,
      '/version.json': 200,
      '/health': 200,
      '/health.json': 200,
      '/500.html': 200,
    }
    for (const [path, status] of Object.entries(pages)) {
      const res = await fetch(`${BASE}${path}`)
      assert.equal(res.status, status, path)
      if (path === '/health') {
        assert.deepEqual(await res.json(), { status: 'ok', release: '3.2.0' })
      }
    }
    const missing = await fetch(`${BASE}/definitely-missing-page`)
    assert.equal(missing.status, 404)
    const body = await missing.text()
    assert.match(body, /Report this/)
    assert.match(body, /Wrong frequency/)
    const five = await fetch(`${BASE}/500.html`)
    assert.match(await five.text(), /Report this/)

    const injection = await fetch(`${BASE}/app.html`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: `${'{"probe":"'.padEnd(2_000_000, 'A')}"}`,
    })
    assert.ok([200, 404, 413, 405].includes(injection.status))

    const unicode = await fetch(`${BASE}/${encodeURIComponent('写作样本')}`)
    assert.equal(unicode.status, 404)
  } finally {
    server.kill('SIGTERM')
  }
})
