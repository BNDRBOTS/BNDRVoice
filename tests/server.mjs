import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png'
};

const headers = {
  'Cache-Control': 'no-cache',
  'Content-Security-Policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://sdokwqjudvxeimbzsnqc.supabase.co https://api.anthropic.com https://api.openai.com https://api.gumroad.com",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-BNDR-Release': '3.1.0',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
};

createServer((request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (url.pathname === '/health') {
    response.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
    response.end('{"status":"ok","release":"3.1.0"}');
    return;
  }

  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const cleanPath = requested.endsWith('/') ? `${requested}index.html` : requested;
  const candidates = [cleanPath, extname(cleanPath) ? '' : `${cleanPath}.html`].filter(Boolean);
  const target = candidates
    .map((candidate) => resolve(root, `.${candidate}`))
    .find((candidate) => candidate.startsWith(`${root}/`) && existsSync(candidate) && statSync(candidate).isFile());

  if (!target) {
    response.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  response.writeHead(200, { ...headers, 'Content-Type': types[extname(target)] || 'application/octet-stream' });
  createReadStream(target).pipe(response);
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`BNDR preview http://127.0.0.1:${port}\n`);
});
