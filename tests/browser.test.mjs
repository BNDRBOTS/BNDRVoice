import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import serverlessChromium from '@sparticuz/chromium';
import { chromium as playwrightChromium } from 'playwright';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const BASE_URL = 'http://127.0.0.1:4173';
const ARTIFACT_DIR = resolve(process.env.BROWSER_ARTIFACT_DIR || '/tmp/bndr-browser-artifacts');
mkdirSync(ARTIFACT_DIR, { recursive: true });
process.env.FONTCONFIG_PATH ||= '/tmp/fonts';
process.env.XDG_CACHE_HOME ||= '/tmp/bndr-browser-cache';
mkdirSync(process.env.XDG_CACHE_HOME, { recursive: true });

const analysisFixture = {
  energy_level: 74,
  formality_score: 38,
  directness_score: 91,
  specificity_score: 86,
  confidence_score: 89,
  tone_primary: '<img src=x onerror="window.__bndrXss=1">direct',
  tone_secondary: 'wry',
  sentence_rhythm: 'Short setup, hard landing.',
  paragraph_style: 'Compact and single-purpose.',
  structural_pattern: 'Claim, evidence, consequence.',
  risk_handling: 'Names the tradeoff without hedging.',
  vocabulary_register: 'Plainspoken technical language.',
  signature_moves: ['Opens at the conclusion', 'Uses contrast for pressure'],
  phrasing_habits: ['Short punch; longer build', 'Concrete verbs'],
  what_they_avoid: ['Generic optimism', 'Corporate filler'],
  one_sentence_summary: 'Sharp, specific, and willing to call out what is not working.'
};

const profileFixture = {
  profile_name: 'Sharp Test Voice',
  voice_identity: {
    one_line: '<svg onload="window.__bndrXss=1">Direct and specific',
    tone_stack: ['direct', 'wry', 'practical'],
    energy: 'high but controlled',
    formality: 'conversational professional'
  },
  writing_rules: {
    sentence_structure: 'Lead short, then expand only when evidence earns it.',
    paragraph_structure: 'Keep each paragraph to one job.',
    opening_style: 'Start with the conclusion.',
    closing_style: 'End on the implication.',
    rhythm_pattern: 'Alternate clipped and medium sentences.',
    transition_style: 'Use logical turns, never filler transitions.'
  },
  vocabulary: {
    register: 'Concrete, modern, technically exact.',
    preferred_patterns: ['Here is the problem:', 'That means…'],
    banned_words: ['delve', 'game-changing'],
    brand_words: ['sharp', 'specific', 'working'],
  },
  structural_logic: {
    argument_style: 'State the claim before the context.',
    evidence_preference: 'Use concrete examples and measurable facts.',
    tension_handling: 'Name disagreement directly.',
    opinion_expression: 'Commit without false certainty.'
  },
  active_filters: [{ id: 'no_hype', name: 'NO HYPE', rule: 'Remove inflated claims.' }],
  context: {
    goal: 'build trust and authority',
    audience: 'product leaders',
    content_type: 'short-form social posts',
    avoid: 'empty certainty'
  },
  system_prompt: 'Write with direct conclusions, concrete nouns, active verbs, and explicit tradeoffs. Never use hype, canned transitions, or generic optimism.'
};

const qualityFixture = {
  overall_score: 93,
  pass: true,
  dimensions: {
    tone_accuracy: { score: 95, note: '<img src=x onerror="window.__bndrXss=1">Tone matches.' },
    rhythm_capture: { score: 92, note: 'Rhythm alternates cleanly.' },
    vocabulary_match: { score: 94, note: 'Vocabulary stays concrete.' },
    filter_coverage: { score: 91, note: 'Hard filters are explicit.' },
    drift_resistance: { score: 90, note: 'Instructions resist generic output.' }
  },
  strengths: ['Specific sentence rules', 'Clear banned language'],
  gaps: [],
  verdict: '<svg onload="window.__bndrXss=1">Ready to deploy.'
};

function waitForServer(proc) {
  return new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error('Preview server did not start')), 5000);
    proc.stdout.on('data', (chunk) => {
      if (!String(chunk).includes('BNDR preview')) return;
      clearTimeout(timeout);
      resolveReady();
    });
    proc.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Preview server exited early (${code})`));
    });
  });
}

async function addDeterministicEnvironment(context) {
  // Deterministic in-browser Supabase contract. The real vendored client gets
  // a separate smoke pass below; this shim exercises authenticated SaaS paths.
  await context.route('**/assets/supabase.min.js', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript; charset=utf-8',
    body: String.raw`
      (() => {
        const user = { id: '11111111-1111-4111-8111-111111111111', email: 'test@example.com' };
        const session = { access_token: 'test-access-token', user };
        const profiles = [];
        const entitlement = {
          user_id: user.id, status: 'trial', product_tier: 'trial',
          source: 'signup', daily_limit: 5,
          valid_until: new Date(Date.now() + 6 * 86400000).toISOString(),
          grace_until: null
        };
        function builder(table) {
          const query = { action: 'select', payload: null, filters: {}, single: false };
          const api = {
            select() { query.action = 'select'; return api; },
            insert(value) { query.action = 'insert'; query.payload = value; return api; },
            upsert(value) { query.action = 'upsert'; query.payload = value; return api; },
            update(value) { query.action = 'update'; query.payload = value; return api; },
            delete() { query.action = 'delete'; return api; },
            eq(key, value) { query.filters[key] = value; return api; },
            order() { return api; },
            limit() { return api; },
            single() { query.single = true; return run(); },
            maybeSingle() { query.single = true; return run(); },
            then(resolve, reject) { return run().then(resolve, reject); },
            catch(reject) { return run().catch(reject); }
          };
          async function run() {
            if (table === 'entitlements') return { data: entitlement, error: null };
            if (table === 'usage_tracking') return { data: { request_count: 0 }, error: null };
            if (table === 'user_preferences') {
              return { data: query.action === 'select' ? null : query.payload, error: null };
            }
            if (table === 'error_reports') return { data: query.payload, error: null };
            if (table === 'voice_profiles') {
              if (query.action === 'upsert' || query.action === 'insert') {
                const existing = profiles.findIndex(item => item.name === query.payload.name);
                const saved = {
                  ...query.payload,
                  id: existing >= 0 ? profiles[existing].id : crypto.randomUUID(),
                  created_at: query.payload.created_at || new Date().toISOString(),
                  updated_at: new Date().toISOString()
                };
                if (existing >= 0) profiles[existing] = saved; else profiles.push(saved);
                return { data: saved, error: null };
              }
              if (query.action === 'delete') {
                const index = profiles.findIndex(item => item.id === query.filters.id);
                if (index >= 0) profiles.splice(index, 1);
                return { data: null, error: null };
              }
              let rows = profiles.filter(item =>
                Object.entries(query.filters).every(([key, value]) => item[key] === value)
              );
              return { data: query.single ? (rows[0] || null) : rows, error: null };
            }
            return { data: null, error: null };
          }
          return api;
        }
        window.supabase = {
          createClient() {
            return {
              from: builder,
              rpc: async () => ({ data: [{ allowed: true, current_count: 1, daily_limit: 5 }], error: null }),
              storage: {
                from: () => ({
                  upload: async () => ({ data: { path: 'archived' }, error: null })
                })
              },
              auth: {
                getSession: async () => ({ data: { session }, error: null }),
                getUser: async () => ({ data: { user }, error: null }),
                onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
                signInWithPassword: async () => ({ data: { session, user }, error: null }),
                signUp: async () => ({ data: { session, user }, error: null }),
                signInWithOtp: async () => ({ error: null }),
                resetPasswordForEmail: async () => ({ error: null }),
                updateUser: async () => ({ data: { user }, error: null }),
                signOut: async () => ({ error: null })
              }
            };
          }
        };
      })();
    `
  }));
  await context.route('https://fonts.googleapis.com/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/css; charset=utf-8',
    body: ''
  }));
  await context.route('https://fonts.gstatic.com/**', (route) => route.fulfill({ status: 204, body: '' }));
  await context.addInitScript(({ analysis, profile, quality }) => {
    localStorage.setItem('bndr_consent', new Date().toISOString());
    localStorage.setItem('bndr_tour_done', '1');
    window.__bndrAiRequests = [];
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = String(input);
      if (url.endsWith('/functions/v1/ai-proxy')) {
        const request = JSON.parse(String(init.body || '{}'));
        window.__bndrAiRequests.push(request);
        let fixture = analysis;
        if (request.operation === 'compile') fixture = profile;
        if (request.operation === 'quality') fixture = quality;
        return new Response(JSON.stringify({
          content: JSON.stringify(fixture),
          usage: { current_count: 1, daily_limit: 5, entitlement_status: 'trial' },
          correlation_id: '22222222-2222-4222-8222-222222222222'
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return nativeFetch(input, init);
    };
  }, { analysis: analysisFixture, profile: profileFixture, quality: qualityFixture });
}

function watchForErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    if (request.url().startsWith(BASE_URL)) errors.push(`request: ${request.url()} ${request.failure()?.errorText}`);
  });
  return errors;
}

test('desktop, mobile, and the full mocked VoiceEngine flow work', { timeout: 180_000 }, async () => {
  const server = spawn(process.execPath, ['tests/server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: '4173' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForServer(server);

  let browser;
  try {
    const libDir = join(tmpdir(), 'al2023', 'lib');
    if (!existsSync(join(libDir, 'libnspr4.so'))) {
      const { inflate } = await import(pathToFileURL(join(ROOT, 'node_modules/@sparticuz/chromium/build/lambdafs.js')).href);
      await inflate(join(ROOT, 'node_modules/@sparticuz/chromium/bin/al2023.tar.br'));
    }
    process.env.LD_LIBRARY_PATH = [libDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      || await serverlessChromium.executablePath();
    browser = await playwrightChromium.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-setuid-sandbox', '--enable-unsafe-swiftshader']
    });

    const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    await addDeterministicEnvironment(desktop);
    const page = await desktop.newPage();
    const desktopErrors = watchForErrors(page);
    await page.addInitScript(() => {
      window.__bndrTerminalFrames = [];
      document.addEventListener('DOMContentLoaded', () => {
        let frames = 0;
        const sample = () => {
          const terminal = document.querySelector('.term');
          if (terminal) {
            const style = getComputedStyle(terminal);
            window.__bndrTerminalFrames.push({
              opacity: Number(style.opacity),
              visibility: style.visibility,
              width: terminal.getBoundingClientRect().width
            });
          }
          frames += 1;
          if (frames < 90) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }, { once: true });
    });

    const healthResponse = await desktop.request.get(`${BASE_URL}/health`);
    assert.equal(healthResponse.status(), 200);
    assert.deepEqual(await healthResponse.json(), { status: 'ok', release: '3.2.0' });
    const versionResponse = await desktop.request.get(`${BASE_URL}/version.json`);
    assert.equal(versionResponse.status(), 200);
    assert.equal(versionResponse.headers()['x-bndr-release'], '3.2.0');
    assert.equal((await desktop.request.get(`${BASE_URL}/definitely-missing.js`)).status(), 404);

    const homeResponse = await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    assert.equal(homeResponse?.status(), 200);
    await page.locator('h1').waitFor();
    assert.match(await page.title(), /BNDR VoiceEngine/);
    assert.match(await page.locator('h1').innerText(), /Your voice\.\s*Every AI\./);
    assert.equal(await page.locator('.brand-logo').evaluate((img) => img.naturalWidth > 0), true);
    assert.match(await page.locator('footer').innerText(), /v3\.2\.0/);
    assert.equal((await page.locator('#lifetimeBtn').textContent())?.trim(), 'Redeem a Code');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    await page.waitForTimeout(1600);
    assert.equal(await page.locator('.term').isVisible(), true);
    assert.equal(await page.locator('.term').evaluate((node) => Number(getComputedStyle(node).opacity)), 1);
    assert.equal(await page.evaluate(() => window.__bndrTerminalFrames.length >= 30), true);
    assert.equal(await page.evaluate(() => window.__bndrTerminalFrames.every((frame) => frame.opacity === 1 && frame.visibility === 'visible' && frame.width > 0)), true);
    const desktopHero = await page.locator('.hero').boundingBox();
    const desktopCopy = await page.locator('.hero > div:first-child').boundingBox();
    const desktopTerminal = await page.locator('.term').boundingBox();
    assert.ok(desktopHero && desktopCopy && desktopTerminal);
    assert.ok(desktopTerminal.x > desktopCopy.x + desktopCopy.width, 'Desktop terminal must occupy the right hero column');
    assert.ok(desktopTerminal.x + desktopTerminal.width <= desktopHero.x + desktopHero.width + 1, 'Desktop terminal must remain inside the hero');
    assert.equal(await page.locator('.card').first().evaluate((node) => getComputedStyle(node).backdropFilter.includes('blur')), true);
    assert.equal(await page.evaluate(() => getComputedStyle(document.body, '::before').display), 'none');
    const landingA11y = await new AxeBuilder({ page }).analyze();
    assert.deepEqual(
      landingA11y.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact)),
      [],
      'Landing page has serious accessibility violations'
    );
    for (const selector of ['#how', '#features', '#pricing', '#faq']) {
      await page.locator(selector).scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      assert.equal(await page.locator(`${selector} .reveal`).first().evaluate((node) => Number(getComputedStyle(node).opacity) > 0), true);
    }
    await page.locator('body').press('Home');
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(ARTIFACT_DIR, 'landing-desktop.png'), fullPage: true });

    await page.getByRole('link', { name: /Start free/ }).click();
    await page.locator('#view-1').waitFor();
    assert.equal(await page.locator('.brand-logo--app').evaluate((img) => img.naturalWidth > 0), true);
    assert.match(await page.locator('.app-footer').innerText(), /v3\.2\.0/i);
    assert.equal(await page.locator('.step-item[data-step="2"]').isDisabled(), true);
    const appA11y = await new AxeBuilder({ page }).analyze();
    assert.deepEqual(
      appA11y.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact)),
      [],
      'App has serious accessibility violations'
    );

    await page.getByRole('button', { name: 'Load Example' }).click();
    assert.ok((await page.locator('#sampleText').inputValue()).split(/\s+/).length >= 50);
    await page.locator('#tourKeyBtn').click();
    await page.getByRole('button', { name: /OpenAI/ }).click();
    await page.getByRole('button', { name: /Use This Provider/ }).click();
    await page.locator('#analyzeBtn').click();
    await page.locator('#analysisOutput:not(.hidden)').waitFor();
    assert.match(await page.locator('#analysisSummary').innerText(), /Sharp, specific/);
    assert.equal(await page.evaluate(() => window.__bndrXss === 1), false);
    assert.equal(await page.evaluate(() => {
      const request = window.__bndrAiRequests[0];
      return request.provider === 'openai' && !('key' in request) && !('model' in request);
    }), true);

    await page.getByRole('button', { name: /Configure Profile/ }).click();
    await page.locator('#profileName').fill('Sharp Test Voice');
    await page.locator('#audienceInput').fill('product leaders');
    await page.locator('#generateBtn').click();
    await page.locator('#outputPanel:not(.hidden)').waitFor();
    assert.match(await page.locator('#machineOutput').innerText(), /Sharp Test Voice/);

    await page.getByRole('button', { name: /Human Instructions/ }).click();
    assert.match(await page.locator('#humanOutput').innerText(), /Direct and specific/);
    assert.equal(await page.locator('#humanOutput img, #humanOutput svg').count(), 0);

    await page.getByRole('button', { name: /Quality Check/ }).click();
    await page.locator('#qcBtn').click();
    await page.getByText('93', { exact: true }).waitFor();
    assert.match(await page.locator('#qualityOutput').innerText(), /Ready to deploy/);
    assert.equal(await page.locator('#qualityOutput img, #qualityOutput svg').count(), 0);
    assert.equal(await page.evaluate(() => window.__bndrXss === 1), false);

    await page.getByRole('button', { name: /Machine File/ }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '↓ JSON' }).click();
    const download = await downloadPromise;
    const downloadPath = join(ARTIFACT_DIR, await download.suggestedFilename());
    await download.saveAs(downloadPath);
    assert.equal(JSON.parse(readFileSync(downloadPath, 'utf8')).profile_name, 'Sharp Test Voice');

    await page.getByRole('button', { name: 'Save Profile' }).click();
    await page.locator('#savedProfilesList').getByText('Sharp Test Voice', { exact: true }).waitFor();
    await page.screenshot({ path: join(ARTIFACT_DIR, 'app-complete-desktop.png'), fullPage: true });
    assert.deepEqual(desktopErrors, []);

    const legalPage = await desktop.newPage();
    for (const [path, heading] of [['/privacy', 'Privacy Policy'], ['/terms', 'Terms of Service']]) {
      const response = await legalPage.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle' });
      assert.equal(response?.status(), 200);
      assert.equal(await legalPage.locator('h1').innerText(), heading);
      assert.equal(await legalPage.locator('.brand-logo--legal').evaluate((img) => img.naturalWidth > 0), true);
      assert.equal(await legalPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
      await legalPage.screenshot({ path: join(ARTIFACT_DIR, `${path.slice(1)}-desktop.png`), fullPage: true });
    }
    const pricingResponse = await legalPage.goto(`${BASE_URL}/pricing`, { waitUntil: 'networkidle' });
    assert.equal(pricingResponse?.status(), 200);
    assert.match(await legalPage.locator('h1').innerText(), /Costs less than the words it saves you/);
    await legalPage.screenshot({ path: join(ARTIFACT_DIR, 'pricing-desktop.png'), fullPage: true });
    const missingPage = await legalPage.goto(`${BASE_URL}/definitely-missing-page`, { waitUntil: 'networkidle' });
    assert.equal(missingPage?.status(), 404);
    assert.equal(await legalPage.getByRole('button', { name: 'Report this' }).count(), 1);
    assert.equal(await legalPage.getByRole('button', { name: 'Copy report' }).count(), 1);
    await legalPage.screenshot({ path: join(ARTIFACT_DIR, '404-desktop.png'), fullPage: true });
    const crashStatic = await legalPage.goto(`${BASE_URL}/500.html`, { waitUntil: 'networkidle' });
    assert.equal(crashStatic?.status(), 200);
    assert.equal(await legalPage.getByRole('button', { name: 'Report this' }).count(), 1);
    await legalPage.screenshot({ path: join(ARTIFACT_DIR, '500-desktop.png'), fullPage: true });
    await legalPage.close();

    const crashPage = await desktop.newPage();
    await crashPage.goto(`${BASE_URL}/app.html?force_error=client`, { waitUntil: 'networkidle' });
    await crashPage.locator('#errorDialog:not(.hidden)').waitFor();
    assert.match(await crashPage.locator('#errorDialogCode').innerText(), /CLIENT-500-[A-F0-9]{4}/);
    assert.equal(await crashPage.getByRole('button', { name: 'Report this' }).count(), 1);
    await crashPage.close();

    const tourPage = await desktop.newPage();
    await tourPage.addInitScript(() => {
      localStorage.setItem('bndr_consent', new Date().toISOString());
      localStorage.removeItem('bndr_tour_done');
    });
    await tourPage.goto(`${BASE_URL}/app`, { waitUntil: 'networkidle' });
    await tourPage.locator('#tourOverlay:not(.hidden)').waitFor();
    assert.equal(await tourPage.getByRole('button', { name: 'Skip' }).count(), 1);
    await tourPage.getByRole('button', { name: 'Skip' }).click();
    await tourPage.locator('#tourOverlay').waitFor({ state: 'hidden' });
    await tourPage.getByRole('button', { name: 'Open the guided tour' }).click();
    await tourPage.locator('#tourOverlay:not(.hidden)').waitFor();
    await tourPage.close();

    const redeemPage = await desktop.newPage();
    await redeemPage.goto(`${BASE_URL}/app.html?redeem=1`, { waitUntil: 'networkidle' });
    await redeemPage.locator('#passModal:not(.hidden)').waitFor();
    assert.equal(await redeemPage.locator('#passInput').isVisible(), true);
    await redeemPage.close();
    await desktop.close();

    // Load the actual vendored Supabase client once (without signing in or
    // making a provider call) to catch bundle/init regressions.
    const productionClient = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await productionClient.route('https://fonts.googleapis.com/**', (route) => route.fulfill({
      status: 200, contentType: 'text/css; charset=utf-8', body: ''
    }));
    await productionClient.route('https://fonts.gstatic.com/**', (route) => route.fulfill({ status: 204, body: '' }));
    await productionClient.addInitScript(() => {
      localStorage.setItem('bndr_consent', new Date().toISOString());
      localStorage.setItem('bndr_tour_done', '1');
    });
    const productionPage = await productionClient.newPage();
    const productionErrors = watchForErrors(productionPage);
    await productionPage.goto(`${BASE_URL}/app`, { waitUntil: 'networkidle' });
    assert.equal(await productionPage.evaluate(() => typeof window.supabase?.createClient), 'function');
    await productionPage.locator('#authModal:not(.hidden)').waitFor();
    const authA11y = await new AxeBuilder({ page: productionPage }).analyze();
    assert.deepEqual(authA11y.violations.filter((v) => ['critical', 'serious'].includes(v.impact)), []);
    assert.deepEqual(productionErrors, []);
    await productionClient.close();

    for (const width of [320, 375, 430, 768, 900]) {
      const height = width <= 430 ? 844 : 1024;
      const responsive = await browser.newContext({ viewport: { width, height }, isMobile: width <= 430 });
      await addDeterministicEnvironment(responsive);
      const responsivePage = await responsive.newPage();
      const responsiveErrors = watchForErrors(responsivePage);
      await responsivePage.goto(BASE_URL, { waitUntil: 'networkidle' });
      await responsivePage.waitForTimeout(900);
      assert.equal(await responsivePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `Landing overflows at ${width}px`);
      assert.equal(await responsivePage.locator('.term').isVisible(), true, `Terminal is hidden at ${width}px`);
      assert.equal(await responsivePage.locator('.term').evaluate((node) => Number(getComputedStyle(node).opacity)), 1, `Terminal opacity regressed at ${width}px`);
      const heroBox = await responsivePage.locator('.hero').boundingBox();
      const copyBox = await responsivePage.locator('.hero > div:first-child').boundingBox();
      const terminalBox = await responsivePage.locator('.term').boundingBox();
      assert.ok(heroBox && copyBox && terminalBox);
      assert.ok(copyBox.x >= heroBox.x - 1 && copyBox.x + copyBox.width <= heroBox.x + heroBox.width + 1, `Hero copy escapes at ${width}px`);
      assert.ok(terminalBox.x >= heroBox.x - 1 && terminalBox.x + terminalBox.width <= heroBox.x + heroBox.width + 1, `Terminal escapes at ${width}px`);
      assert.ok(Math.abs(copyBox.x - terminalBox.x) <= 1, `Stacked hero edges do not align at ${width}px`);
      assert.ok(Math.abs(copyBox.width - terminalBox.width) <= 1, `Stacked hero widths do not align at ${width}px`);
      if (width <= 600) {
        const buttons = await responsivePage.locator('.hero-ctas .btn').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width));
        assert.equal(buttons.length, 2);
        assert.ok(Math.abs(buttons[0] - buttons[1]) <= 1, `Mobile hero buttons are not evenly aligned at ${width}px`);
      }
      assert.deepEqual(responsiveErrors, [], `Browser errors at ${width}px`);
      await responsive.close();
    }

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    await addDeterministicEnvironment(mobile);
    const mobilePage = await mobile.newPage();
    const mobileErrors = watchForErrors(mobilePage);
    await mobilePage.goto(BASE_URL, { waitUntil: 'networkidle' });
    assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    const mobileLandingA11y = await new AxeBuilder({ page: mobilePage }).analyze();
    assert.deepEqual(mobileLandingA11y.violations.filter((v) => ['critical', 'serious'].includes(v.impact)), []);
    await mobilePage.locator('#navBurger').click();
    await mobilePage.getByRole('link', { name: 'Features' }).waitFor({ state: 'visible' });
    await mobilePage.screenshot({ path: join(ARTIFACT_DIR, 'landing-mobile.png') });
    await mobilePage.goto(`${BASE_URL}/app`, { waitUntil: 'networkidle' });
    assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    assert.equal(await mobilePage.locator('.brand-logo--app').evaluate((img) => img.naturalWidth > 0), true);
    const mobileAppA11y = await new AxeBuilder({ page: mobilePage }).analyze();
    assert.deepEqual(mobileAppA11y.violations.filter((v) => ['critical', 'serious'].includes(v.impact)), []);
    await mobilePage.screenshot({ path: join(ARTIFACT_DIR, 'app-mobile.png') });
    assert.deepEqual(mobileErrors, []);
    await mobile.close();
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
});
