import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PORT = 18080
const NGINX = process.env.NGINX_BIN || '/tmp/nginx-install/sbin/nginx'

async function waitHttp(url, timeoutMs = 8000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      return await fetch(url)
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error(`no response from ${url}`)
}

test('Dockerfile nginx config serves /health and public routes on the injected PORT', { timeout: 20_000 }, async () => {
  const prefix = join(tmpdir(), `bndr-nginx-${process.pid}`)
  mkdirSync(join(prefix, 'logs'), { recursive: true })
  mkdirSync(join(prefix, 'conf'), { recursive: true })
  const server = readFileSync(join(ROOT, 'nginx.conf'), 'utf8')
    .replaceAll('${PORT}', String(PORT))
    .replace(/^\s*listen \[::\]:[^\n]+\n/m, '')
    .replace('root /usr/share/nginx/html;', `root ${ROOT};`)
  const conf = `worker_processes 1;
error_log ${join(prefix, 'logs/error.log')};
pid ${join(prefix, 'logs/nginx.pid')};
events { worker_connections 64; }
http {
  access_log ${join(prefix, 'logs/access.log')};
  default_type application/octet-stream;
  ${server}
}
`
  const confPath = join(prefix, 'conf/nginx.conf')
  writeFileSync(confPath, conf)
  const proc = spawn(NGINX, ['-c', confPath, '-p', prefix, '-g', 'daemon off;'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logs = []
  proc.stderr.on('data', (c) => logs.push(String(c)))
  proc.stdout.on('data', (c) => logs.push(String(c)))
  try {
    const health = await waitHttp(`http://127.0.0.1:${PORT}/health`)
    assert.equal(health.status, 200, logs.join(''))
    assert.deepEqual(await health.json(), { status: 'ok', release: '3.2.0' })
    assert.equal((await fetch(`http://127.0.0.1:${PORT}/`)).status, 200)
    assert.equal((await fetch(`http://127.0.0.1:${PORT}/pricing`)).status, 200)
    assert.equal((await fetch(`http://127.0.0.1:${PORT}/app`)).status, 200)
    const missing = await fetch(`http://127.0.0.1:${PORT}/missing-route`)
    assert.equal(missing.status, 404)
    const headers = (await fetch(`http://127.0.0.1:${PORT}/`)).headers
    assert.equal(headers.get('x-bndr-release'), '3.2.0')
    assert.equal(headers.get('x-content-type-options'), 'nosniff')
  } finally {
    proc.kill('SIGTERM')
  }
})
