import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML_FILES = ['index.html', 'app.html', 'privacy.html', 'terms.html', '404.html', '500.html'];
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
      const routedTarget = pathname === '/'
        ? 'index.html'
        : (pathname.startsWith('/') ? pathname.slice(1) : pathname) || sourceFile;
      const targetFile = existsSync(resolve(ROOT, routedTarget))
        ? routedTarget
        : existsSync(resolve(ROOT, `${routedTarget}.html`))
          ? `${routedTarget}.html`
          : routedTarget;
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

test('release 3.2.0 is consistent across pages and deployment contracts', () => {
  const release = '3.2.0';
  for (const [file, html] of Object.entries(htmlByFile)) {
    assert.match(html, new RegExp(`<meta name=["']application-version["'] content=["']${release.replaceAll('.', '\\.')}`), `${file}: version meta`);
  }
  assert.equal(JSON.parse(read('version.json')).release, release);
  assert.match(read('config.js'), /APP_VERSION:\s*'3\.2\.0'/);
  assert.match(read('nginx.conf'), /X-BNDR-Release "3\.2\.0"/);
  assert.match(read('nginx.conf'), /"release":"3\.2\.0"/);
  assert.match(read('package.json'), /"version": "3\.2\.0"/);
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

test('current model IDs agree between client and the secure provider gateway', () => {
  const config = read('config.js');
  const app = read('app.html');
  const proxy = read('supabase/functions/ai-proxy/index.ts');
  for (const id of ['claude-sonnet-5', 'gpt-5.6-luna', 'deepseek-v4-flash']) {
    assert.ok(config.includes(id), `config missing ${id}`);
    assert.ok(app.includes(id), `app fallback missing ${id}`);
  }
  assert.ok(proxy.includes("'deepseek-v4-flash'"));
  assert.match(proxy, /anthropic:\s*new Set\(\['claude-sonnet-5'\]\)/);
  assert.match(proxy, /openai:\s*new Set\(\['gpt-5\.6-luna'\]\)/);
  assert.doesNotMatch(`${config}\n${app}\n${proxy}`, /deepseek-(?:chat|reasoner)|gpt-4o|claude-3-/i);
});

test('security controls cover browser rendering, proxy input, and database ownership', () => {
  const app = read('app.html');
  const proxy = read('supabase/functions/ai-proxy/index.ts');
  const webhook = read('supabase/functions/stripe-webhook/index.ts');
  const schema = read('supabase/migrations/20260730000000_voiceengine_3_2_0.sql');

  assert.match(app, /function escapeHtml[\s\S]*?replace\(\/&\/g,'&amp;'\)[\s\S]*?replace\(\/</);
  assert.match(app, /one_sentence_summary\)\}<\/p>/);
  assert.match(app, /qc\?\.verdict \|\| ''/);
  assert.match(proxy, /JSON\.stringify\(body\.payload\)\.length > MAX_MESSAGE_BYTES/);
  assert.match(proxy, /const MODELS:/);
  assert.match(proxy, /client\.auth\.getUser\(\)/);
  assert.match(proxy, /Request body too large/);
  assert.match(proxy, /check_and_increment_usage/);
  assert.doesNotMatch(proxy, /Access-Control-Allow-Origin': '\*'/);
  assert.match(webhook, /stripe\.webhooks\.constructEvent\(rawBody, signature, webhookSecret\)/);
  assert.match(webhook, /async function isKnownUser/);
  assert.match(webhook, /text\('Webhook signature invalid', 400\)/);
  assert.match(webhook, /Payload too large/);
  assert.match(schema, /GRANT USAGE ON SCHEMA public TO authenticated/);
  assert.match(schema, /CHECK \(CHAR_LENGTH\(BTRIM\(name\)\) BETWEEN 1 AND 120\) NOT VALID/);
  assert.match(schema, /SECURITY DEFINER\s+SET search_path = ''[\s\S]*?auth\.uid\(\)\) <> p_user_id/);
  assert.match(schema, /REVOKE ALL ON FUNCTION public\.check_and_increment_usage\(UUID\) FROM PUBLIC/);
  assert.match(schema, /GRANT\s+EXECUTE ON FUNCTION public\.check_and_increment_usage\(UUID\) TO authenticated/);
  assert.match(schema, /CREATE POLICY "profiles_all_own"[\s\S]*?TO authenticated[\s\S]*?WITH CHECK/);
  assert.match(schema, /ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ/);
  assert.match(schema, /DROP FUNCTION IF EXISTS public\.check_and_increment_usage\(UUID\)/);
  assert.ok(existsSync(join(ROOT, 'supabase/rollbacks/20260730000000_voiceengine_3_2_0.down.sql')));
});

test('auth, account ownership, tour state, and error reporting are fully wired', () => {
  const app = read('app.html');
  const schema = read('supabase/migrations/20260730000000_voiceengine_3_2_0.sql');
  const accountDelete = read('supabase/functions/account-delete/index.ts');
  const errorReport = read('supabase/functions/error-report/index.ts');
  const redemption = read('supabase/functions/redeem-access/index.ts');

  assert.match(app, /resetPasswordForEmail/);
  assert.match(app, /updateUser\(\{ password \}\)/);
  assert.match(app, /PASSWORD_RECOVERY/);
  assert.match(app, /functions\/v1\/account-delete/);
  assert.match(app, /functions\/v1\/redeem-access/);
  assert.match(accountDelete, /auth\.admin\.deleteUser\(user\.id\)/);
  assert.match(accountDelete, /stripe\.subscriptions\.cancel\(subscription\.stripe_subscription_id\)/);
  assert.match(redemption, /userClient\.auth\.getUser\(\)/);
  assert.match(redemption, /GIFT_CODE_HASHES/);
  assert.match(redemption, /gumroad\.com\/v2\/licenses\/verify/);
  assert.match(redemption, /plan_interval:\s*'lifetime'/);
  assert.match(redemption, /entitlement_history/);
  assert.doesNotMatch(read('config.js'), /GIFT_CODE_HASHES|bndrHashCode/);
  assert.doesNotMatch(app, /localStorage\.setItem\(['"]bndr_pass/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS public\.user_preferences/);
  assert.match(schema, /tour_completed_at/);
  assert.match(app, /user_preferences/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS public\.error_reports/);
  assert.match(errorReport, /RESEND_API_KEY/);
  assert.match(app, /correlation_id/);
  assert.match(app, /reportLastError/);
  assert.match(app, /You are debugging BNDR VoiceEngine/);
  assert.match(app, /slice\(0, 1480\)/);
});

test('billing lifecycle is idempotent and covers recovery, disputes, and reconciliation', () => {
  const webhook = read('supabase/functions/stripe-webhook/index.ts');
  const reconciliation = read('supabase/functions/reconcile-subscriptions/index.ts');
  const portal = read('supabase/functions/billing-portal/index.ts');
  const schema = read('supabase/migrations/20260730000000_voiceengine_3_2_0.sql');

  assert.match(schema, /CREATE TABLE IF NOT EXISTS public\.billing_events/);
  assert.match(webhook, /beginEvent\(event\)/);
  assert.match(webhook, /error\.code === '23505'/);
  for (const event of ['invoice.payment_failed', 'invoice.paid', 'charge.refunded', 'charge.dispute.created']) {
    assert.ok(webhook.includes(event), `missing lifecycle event ${event}`);
  }
  assert.match(webhook, /3 \* 86_400_000/);
  assert.match(webhook, /previous\?\.grace_ends_at \|\| new Date/);
  assert.match(reconciliation, /daily_reconciliation/);
  assert.match(reconciliation, /row\.grace_ends_at \|\| new Date/);
  assert.match(portal, /billingPortal\.sessions\.create/);
  assert.match(schema, /'weekly','monthly','annual','metered','lifetime'/);
});

test('proprietary forensic prompts are server-only and retain the recovered engine dimensions', () => {
  const app = read('app.html');
  const forensic = read('supabase/functions/ai-proxy/forensic.ts');
  assert.doesNotMatch(app, /<score_calibration>|precision voice-pattern extraction engine|<output_schema>/);
  for (const dimension of [
    'tone_primary', 'sentence_rhythm', 'paragraph_style', 'structural_pattern',
    'risk_handling', 'signature_moves', 'vocabulary_register', 'phrasing_habits',
    'what_they_avoid', 'one_sentence_summary'
  ]) {
    assert.ok(forensic.includes(dimension), `server forensic engine missing ${dimension}`);
  }
  assert.match(forensic, /buildForensicRequest/);
  assert.match(read('supabase/functions/ai-proxy/index.ts'), /buildForensicRequest\(body\.operation, body\.payload\)/);
});

test('all four hosting targets, Docker, health, metadata, and error routes are present', () => {
  for (const file of ['vercel.json', 'netlify.toml', 'railway.toml', 'render.yaml', 'Dockerfile']) {
    assert.ok(existsSync(join(ROOT, file)), `${file} missing`);
  }
  for (const file of ['robots.txt', 'sitemap.xml', 'health.json', '404.html', '500.html', '.env.example']) {
    assert.ok(existsSync(join(ROOT, file)), `${file} missing`);
  }
  assert.match(read('Dockerfile'), /COPY 404\.html/);
  assert.match(read('nginx.conf'), /error_page 404 \/404\.html/);
  assert.equal(JSON.parse(read('health.json')).release, '3.2.0');
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

test('walkthrough persists, replays, skips missing anchors, and offers feedback', () => {
  const app = read('app.html');
  assert.match(app, /tour_completed_at/);
  assert.match(app, /tour_skipped_at/);
  assert.match(app, /Show Me Around/);
  assert.match(app, /step\.sel && \(!target \|\| target\.offsetParent === null\)/);
  assert.match(app, /tourSupportBtn/);
  assert.match(app, /bndr\.labs@gmail\.com/);
});

test('edge-function environment example covers every server-side variable read', () => {
  const env = read('.env.example');
  const functions = [
    'supabase/functions/ai-proxy/index.ts',
    'supabase/functions/stripe-webhook/index.ts',
    'supabase/functions/account-delete/index.ts',
    'supabase/functions/billing-portal/index.ts',
    'supabase/functions/error-report/index.ts',
    'supabase/functions/reconcile-subscriptions/index.ts',
    'supabase/functions/redeem-access/index.ts',
  ].map(read).join('\n');
  const names = [...functions.matchAll(/Deno\.env\.get\(['"]([A-Z0-9_]+)['"]\)/g)]
    .map((match) => match[1]);
  for (const name of new Set(names)) {
    assert.match(env, new RegExp(`^${name}=`, 'm'), `.env.example missing ${name}`);
  }
});

test('keyless edge functions return designed configuration states instead of boot crashes', () => {
  const webhook = read('supabase/functions/stripe-webhook/index.ts');
  const accountDelete = read('supabase/functions/account-delete/index.ts');
  const portal = read('supabase/functions/billing-portal/index.ts');
  const reconciliation = read('supabase/functions/reconcile-subscriptions/index.ts');
  assert.doesNotMatch(webhook, /throw new Error\('Missing required Stripe/);
  assert.match(webhook, /Billing webhook is not configured/);
  assert.match(accountDelete, /Server configuration incomplete/);
  assert.match(portal, /Billing is not configured/);
  assert.match(reconciliation, /Reconciliation is not configured/);
});

test('retired plaintext gift codes are absent', () => {
  const textFiles = [
    ...HTML_FILES,
    'README.md',
    'config.js',
    'supabase/functions/ai-proxy/index.ts',
    'supabase/functions/stripe-webhook/index.ts',
    'supabase/migrations/20260730000000_voiceengine_3_2_0.sql'
  ].map(read).join('\n');
  assert.doesNotMatch(textFiles, /BNDR-VIP-2026|FRIENDS-OF-BNDR/);
});
