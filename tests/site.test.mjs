import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML_FILES = ['index.html', 'app.html', 'privacy.html', 'terms.html'];
const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const htmlByFile = Object.fromEntries(HTML_FILES.map((file) => [file, read(file)]));

function attrs(html, name) {
  return [...html.matchAll(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'gi'))]
    .map((match) => match[1]);
}

function ids(html) {
  return attrs(html, 'id');
}

test('all local href/src references exist and fragments resolve', () => {
  for (const [sourceFile, html] of Object.entries(htmlByFile)) {
    for (const reference of [...attrs(html, 'href'), ...attrs(html, 'src')]) {
      if (/^(?:[a-z]+:|\/\/)/i.test(reference) || reference.startsWith('data:')) continue;

      const [withoutFragment, fragment = ''] = reference.split('#', 2);
      const pathname = withoutFragment.split('?', 1)[0];
      const targetFile = pathname || sourceFile;
      const absolute = resolve(ROOT, targetFile);

      assert.ok(
        absolute.startsWith(`${ROOT}/`) || absolute === ROOT,
        `${sourceFile}: local reference escapes the repository: ${reference}`
      );
      assert.ok(existsSync(absolute), `${sourceFile}: missing local reference ${reference}`);

      if (fragment && targetFile.endsWith('.html')) {
        assert.ok(ids(read(targetFile)).includes(fragment), `${sourceFile}: missing #${fragment} in ${targetFile}`);
      }
    }
  }
});

test('IDs are unique and every button has an explicit type', () => {
  for (const [file, html] of Object.entries(htmlByFile)) {
    // Ignore template strings inside scripts: auth views intentionally reuse
    // field IDs but are mutually exclusive and never coexist in the DOM.
    const staticMarkup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    const allIds = ids(staticMarkup);
    assert.equal(new Set(allIds).size, allIds.length, `${file}: duplicate id`);
    const buttons = [...html.matchAll(/<button\b[^>]*>/gi)].map((match) => match[0]);
    for (const button of buttons) {
      assert.match(button, /\btype=["'](?:button|submit|reset)["']/i, `${file}: ${button}`);
    }
  }
});

test('inline JavaScript parses on every page', () => {
  for (const [file, html] of Object.entries(htmlByFile)) {
    const scripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
    scripts.forEach((match, index) => {
      assert.doesNotThrow(
        () => new vm.Script(match[1], { filename: `${file}:inline-${index + 1}` }),
        `${file}: inline script ${index + 1} has invalid syntax`
      );
    });
  }
});

test('the supplied logo is used consistently and retains its expected bytes', () => {
  for (const [file, html] of Object.entries(htmlByFile)) {
    assert.match(html, /<img\b[^>]*src=["']assets\/bndr-logo\.png["'][^>]*>/i, `${file}: logo missing`);
    assert.match(html, /<img\b[^>]*alt=["']BNDR LLC["'][^>]*>/i, `${file}: accessible logo text missing`);
  }
  const digest = createHash('sha256').update(readFileSync(join(ROOT, 'assets/bndr-logo.png'))).digest('hex');
  assert.equal(digest, '4ae994281e3bfddeb1ffd567f55204d58d439c9cdcf3ca22781c1c7b41b602b5');
});

test('browser dependencies are pinned and served locally', () => {
  const app = read('app.html');
  assert.match(app, /src=["']assets\/gsap\.min\.js["']/);
  assert.match(app, /src=["']assets\/supabase\.min\.js["']/);
  assert.doesNotMatch(app, /cdn\.jsdelivr\.net/);
  const supabaseDigest = createHash('sha256').update(readFileSync(join(ROOT, 'assets/supabase.min.js'))).digest('hex');
  assert.equal(supabaseDigest, 'a3c3d33ccc28187a3880db0e7d8c6b7bf9fb542fd310c6b152cdc68f4ed63b6d');
});

test('release 3.1.0 is consistent across pages and deployment contracts', () => {
  const release = '3.1.0';
  for (const [file, html] of Object.entries(htmlByFile)) {
    assert.match(html, new RegExp(`<meta name=["']application-version["'] content=["']${release.replaceAll('.', '\\.')}`), `${file}: version meta`);
  }
  assert.equal(JSON.parse(read('version.json')).release, release);
  assert.match(read('config.js'), /APP_VERSION:\s*'3\.1\.0'/);
  assert.match(read('nginx.conf'), /X-BNDR-Release "3\.1\.0"/);
  assert.match(read('nginx.conf'), /"release":"3\.1\.0"/);
  assert.match(read('package.json'), /"version": "3\.1\.0"/);
});

test('Railway container binds its injected port and exposes a strict health endpoint', () => {
  const docker = read('Dockerfile');
  const nginx = read('nginx.conf');
  const railway = read('railway.toml');

  assert.match(docker, /ENV PORT=8080/);
  assert.match(docker, /COPY nginx\.conf \/etc\/nginx\/templates\/default\.conf\.template/);
  assert.match(docker, /COPY assets\/ \/usr\/share\/nginx\/html\/assets\//);
  assert.match(docker, /127\.0\.0\.1:\$\{PORT\}\/health/);
  assert.match(nginx, /listen \$\{PORT\} default_server;/);
  assert.match(nginx, /location = \/health[\s\S]*?return 200/);
  assert.match(nginx, /try_files \$uri \$uri\.html \$uri\/ =404;/);
  assert.match(railway, /healthcheckPath\s*=\s*"\/health"/);
});

test('current model IDs agree between client and DeepSeek relay', () => {
  const config = read('config.js');
  const app = read('app.html');
  const proxy = read('supabase/functions/ai-proxy/index.ts');
  for (const id of ['claude-sonnet-5', 'gpt-5.6-luna', 'deepseek-v4-flash']) {
    assert.ok(config.includes(id), `config missing ${id}`);
    assert.ok(app.includes(id), `app fallback missing ${id}`);
  }
  assert.ok(proxy.includes("'deepseek-v4-flash'"));
  assert.doesNotMatch(`${config}\n${app}\n${proxy}`, /deepseek-(?:chat|reasoner)|gpt-4o|claude-3-/i);
});

test('security controls cover browser rendering, proxy input, and database ownership', () => {
  const app = read('app.html');
  const proxy = read('supabase/functions/ai-proxy/index.ts');
  const webhook = read('supabase/functions/stripe-webhook/index.ts');
  const schema = read('supabase/schema.sql');

  assert.match(app, /function escapeHtml[\s\S]*?replace\(\/&\/g,'&amp;'\)[\s\S]*?replace\(\/</);
  assert.match(app, /one_sentence_summary\)\}<\/p>/);
  assert.match(app, /qc\?\.verdict \|\| ''/);
  assert.match(proxy, /messages\.length > 8/);
  assert.match(proxy, /message\.content\.length > 200_000/);
  assert.match(proxy, /ALLOWED_MODELS/);
  assert.match(proxy, /supabase\.auth\.getUser\(\)/);
  assert.match(proxy, /Request body too large/);
  assert.match(webhook, /stripe\.webhooks\.constructEvent\(rawBody, sig, webhookSecret\)/);
  assert.match(webhook, /async function isKnownUser/);
  assert.match(webhook, /Webhook signature invalid'\s*,\s*\{ status: 400 \}/);
  assert.match(webhook, /Payload too large/);
  assert.match(schema, /GRANT USAGE ON SCHEMA public TO authenticated/);
  assert.match(schema, /CHECK \(CHAR_LENGTH\(BTRIM\(name\)\) BETWEEN 1 AND 120\) NOT VALID/);
  assert.match(schema, /SECURITY DEFINER\s+SET search_path = ''[\s\S]*?auth\.uid\(\)\) <> p_user_id/);
  assert.match(schema, /REVOKE ALL ON FUNCTION public\.check_and_increment_usage\(UUID\) FROM PUBLIC/);
  assert.match(schema, /GRANT\s+EXECUTE ON FUNCTION public\.check_and_increment_usage\(UUID\) TO authenticated/);
  assert.match(schema, /CREATE POLICY "profiles_all_own"[\s\S]*?TO authenticated[\s\S]*?WITH CHECK/);
});

test('visual system has GSAP glass, reduced-motion support, and no retired grain filter', () => {
  const css = read('assets/glass.css');
  const motion = read('assets/glass.js');
  const combined = Object.values(htmlByFile).join('\n');

  assert.match(css, /backdrop-filter: blur\(/);
  assert.match(css, /--glass-edge-hot/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(motion, /window\.gsap/);
  assert.match(motion, /IntersectionObserver/);
  assert.doesNotMatch(combined, /feTurbulence|fractalNoise/i);
});

test('landing hero keeps one animation owner and explicit responsive balance', () => {
  const landing = read('index.html');
  const motion = read('assets/glass.js');

  assert.doesNotMatch(
    landing,
    /class=["'][^"']*\bterm\b[^"']*\breveal\b[^"']*["']/i,
    'the terminal must not also be owned by scroll-reveal animation'
  );
  assert.match(motion, /function animatePageEntry\(\)/);
  assert.doesNotMatch(motion, /querySelector\(["']\.hero \.term["']\)/);
  assert.match(landing, /grid-template-columns:minmax\(0,1\.08fr\) minmax\(360px,0\.92fr\)/);
  assert.match(landing, /@media\(max-width:900px\)[\s\S]*?grid-template-columns:minmax\(0,1fr\)/);
  assert.match(landing, /@media\(max-width:600px\)[\s\S]*?\.hero-ctas \{ display:grid; grid-template-columns:minmax\(0,1fr\)/);
});

test('retired plaintext gift codes are absent', () => {
  const textFiles = [
    ...HTML_FILES,
    'README.md',
    'config.js',
    'supabase/functions/ai-proxy/index.ts',
    'supabase/functions/stripe-webhook/index.ts',
    'supabase/schema.sql'
  ].map(read).join('\n');
  assert.doesNotMatch(textFiles, /BNDR-VIP-2026|FRIENDS-OF-BNDR/);
});
