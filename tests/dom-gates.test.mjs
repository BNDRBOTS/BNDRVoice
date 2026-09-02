import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(join(ROOT, file), 'utf8')

function loadStatic(file, url, extras = {}) {
  const html = read(file)
    .replace(/<script src="config\.js"><\/script>/, '')
    .replace(/<script src="assets\/error-report\.js"><\/script>/, '')
    .replace(/<script src="assets\/gsap\.min\.js"[^>]*><\/script>/g, '')
    .replace(/<script src="assets\/glass\.js"[^>]*><\/script>/g, '')
    .replace(/<script src="assets\/supabase\.min\.js"><\/script>/, '')
  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.BNDR_CONFIG = {
        APP_VERSION: '3.2.0',
        BUILD_COMMIT: '8389185',
        SUPPORT_EMAIL: 'bndr.labs@gmail.com',
        SUPABASE_URL: extras.supabaseUrl || '',
        SUPABASE_ANON_KEY: extras.anon || '',
        STRIPE: {},
        GUMROAD: {},
        PRICING: { monthly: { price: '$19', period: '/mo', note: 'Billed monthly' } },
      }
    },
  })
  if (file === '404.html' || file === '500.html') {
    dom.window.eval(read('assets/error-report.js'))
  }
  return dom
}

test('404 and 500 pages render a prefilled report path', () => {
  const missing = loadStatic('404.html', 'http://127.0.0.1/missing-route')
  const code = missing.window.document.getElementById('errorCode').textContent
  assert.match(code, /^NAV-404-[A-F0-9]{4}$/)
  assert.equal(missing.window.document.getElementById('reportBtn').textContent.trim(), 'Report this')
  assert.match(missing.window.document.getElementById('errorCopy').value, /You are debugging BNDR VoiceEngine/)
  assert.match(missing.window.document.getElementById('errorCopy').value, /bndr\.labs@gmail\.com|NAV-404/)
  assert.ok(missing.window.document.getElementById('errorCopy').value.length <= 1480)
  assert.equal(missing.window.document.getElementById('supportAddress').textContent, 'bndr.labs@gmail.com')

  const crash = loadStatic('500.html', 'http://127.0.0.1/500.html')
  assert.match(crash.window.document.getElementById('errorCode').textContent, /^NAV-500-[A-F0-9]{4}$/)
  assert.equal(crash.window.document.getElementById('reportBtn').textContent.trim(), 'Report this')
  assert.match(crash.window.document.getElementById('errorCopy').value, /correlation/)
})

test('pricing page is wired to trial, paid plans, and legal footer', () => {
  const dom = loadStatic('pricing.html', 'http://127.0.0.1/pricing')
  const text = dom.window.document.body.textContent
  assert.match(text, /Try it free/)
  assert.match(text, /Get Monthly/)
  assert.match(text, /Get Annual/)
  assert.match(dom.window.document.querySelector('footer').textContent, /Terms/i)
  assert.match(dom.window.document.querySelector('footer').textContent, /Privacy/i)
})

test('walkthrough offers skip, replays from help, and missing anchors do not freeze the app', async () => {
  const html = read('app.html')
    .replace(/<script src="config\.js"><\/script>/, '')
    .replace(/<script src="assets\/supabase\.min\.js"><\/script>/, '')
    .replace(/<script src="assets\/gsap\.min\.js"[^>]*><\/script>/g, '')
    .replace(/<script src="assets\/glass\.js"[^>]*><\/script>/g, '')
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1/app.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.BNDR_CONFIG = {
        APP_VERSION: '3.2.0',
        BUILD_COMMIT: 'test',
        SUPPORT_EMAIL: 'bndr.labs@gmail.com',
        SUPABASE_URL: '',
        SUPABASE_ANON_KEY: '',
        STRIPE: {},
        GUMROAD: {},
        PRICING: {},
      }
      window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      window.scrollTo = () => {}
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 1000))
  const overlay = dom.window.document.getElementById('tourOverlay')
  assert.ok(overlay)
  assert.equal(overlay.classList.contains('hidden'), false, 'fresh user is offered the tour')
  const skip = [...dom.window.document.querySelectorAll('button')].find((btn) => btn.textContent.trim() === 'Skip')
  assert.ok(skip)
  skip.click()
  assert.equal(overlay.classList.contains('hidden'), true)
  assert.equal(dom.window.localStorage.getItem('bndr_tour_done'), '1')
  dom.window.startTour()
  assert.equal(overlay.classList.contains('hidden'), false, 'Show me around replays the tour')
  const original = dom.window.document.querySelector
  dom.window.document.querySelector = (sel) => (sel === '#analyzeBtn' ? null : original.call(dom.window.document, sel))
  assert.doesNotThrow(() => dom.window._tourRender())
})

test('forced client error shows a coded dialog with report and copy fallback', async () => {
  const html = read('app.html')
    .replace(/<script src="config\.js"><\/script>/, '')
    .replace(/<script src="assets\/supabase\.min\.js"><\/script>/, '')
    .replace(/<script src="assets\/gsap\.min\.js"[^>]*><\/script>/g, '')
    .replace(/<script src="assets\/glass\.js"[^>]*><\/script>/g, '')
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1/app.html?force_error=client',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.BNDR_CONFIG = {
        APP_VERSION: '3.2.0',
        BUILD_COMMIT: 'test',
        SUPPORT_EMAIL: 'bndr.labs@gmail.com',
        SUPABASE_URL: '',
        SUPABASE_ANON_KEY: '',
        STRIPE: {},
        GUMROAD: {},
        PRICING: {},
      }
      window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      window.scrollTo = () => {}
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 200))
  const dialog = dom.window.document.getElementById('errorDialog')
  assert.equal(dialog.classList.contains('hidden'), false)
  assert.match(dom.window.document.getElementById('errorDialogCode').textContent, /CLIENT-500-[A-F0-9]{4}/)
  assert.match(dom.window.document.getElementById('errorDialogCopy').value, /You are debugging BNDR VoiceEngine/)
  assert.ok(dom.window.document.getElementById('errorDialogCopy').value.length <= 1480)
})
