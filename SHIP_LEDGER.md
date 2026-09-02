# BNDRVoice ship ledger — 2026-09-02

Branch: `arena/01a06138-bndrvoice`  
HEAD at stamp: `8389185`  
Release: `3.2.0`

Verdict: **INCOMPLETE** — not SHIPPED. Zero FAIL on every runnable gate. Visual screenshots, Playwright, Lighthouse, axe, and Docker/health remain **NOT RUN** after proven environmental impossibility (no Chromium system libraries; no Docker binary; Debian/Google CDNs ECONNRESET). DOM-level jsdom covers walkthrough, 404/500 report, pricing, and forced client error after three failed headless-browser installs.

## Failed browser / container attempts (do not retry without new deps)

1. `BROWSER_ARTIFACT_DIR=/home/user/BNDRVoice/SHIP_REVIEW npm run test:browser` — Playwright `@sparticuz/chromium` at `/tmp/chromium` exits `libnspr4.so: cannot open shared object file`.
2. `sudo apt-get update` — Debian InRelease connection failed; packages `libnspr4` / `libnss3` / GTK stack not locatable.
3. `npx playwright install chromium` — `ECONNRESET` downloading Chrome for Testing 149 from `cdn.playwright.dev`.
4. `npm install puppeteer@24.15.0` — `ECONNRESET` to `googlechromelabs.github.io`.
5. `chromium` npm installer — `ECONNRESET` retrieving Chromium revision.
6. `command -v docker` / `podman` — empty. Container health not runnable here.

jsdom was installable from the npm registry and is the permitted visual-layer substitute only.

## Red items closed this ship

| Gap | Closed in | Proved by |
| --- | --- | --- |
| Four UI platforms missing (only Railway) | `vercel.json`, `netlify.toml`, `render.yaml`, `Dockerfile`, `tests/site.test.mjs` | `npm run test:contracts` — “all four UI platforms plus Docker are present” |
| No pricing / checkout route | `pricing.html`, `supabase/functions/create-checkout/index.ts` | `npm run test:endpoints`, `npm run test:html` |
| Env boot does not fail on named missing vars | `scripts/env-validation.mjs`, `supabase/functions/_shared/env.ts`, `tests/env-validation.test.mjs` | `npm run test:env` 4/4 |
| Entitlement matrix untested | `tests/entitlement-matrix.test.mjs` | `npm run test:matrix` 8/8 |
| Edge functions not HTTP-tested | `tests/functions-http.test.mjs`, `_shared/serve.ts` | `npm run test:functions` 2/2 |
| Deno typecheck incomplete / leftover `Deno.serve` | `ai-proxy`, `billing-portal`, `reconcile-subscriptions` `handleRequest` + `serve()` | `npm run test:deno` Check all 8 |
| Stripe workflows remote assert TLS fail | `supabase/functions/_shared/stripe-workflows.test.ts` local `assertEquals` | `npm run test:workflows` 3/3 |
| Error report / 404 copy path | `assets/error-report.js`, `404.html`, `500.html`, `app.html` | `npm run test:dom` |
| Walkthrough skip / replay / missing anchors | `app.html` tour, `tests/dom-gates.test.mjs` | `npm run test:dom` |
| Forced client error dialog | `app.html` `_recordError` copies `status`, `?force_error=client` | `npm run test:dom` |
| Security: no maps, no secrets in client, no lorem | `tests/security.test.mjs` | `npm run test:security` 3/3 |
| Rate limit / trial-once schema | `supabase/migrations/20260902000000_rate_limits_trial_once.sql` + rollback | contracts + matrix |
| Version stamp | `scripts/stamp-version.mjs`, `version.json` | `npm run build` → `stamped 8389185` |

## Step 4 final pass (this loop, after last source change)

```
$ npm run build
stamped 8389185
test:contracts  19/19 pass
test:html       html-validate exit 0

$ npm test
test:contracts  19 pass
test:html       pass
test:env        4 pass
test:matrix     8 pass
test:endpoints  1 pass
test:functions  2 pass
test:security   3 pass
test:dom        4 pass

$ npm run test:deno
Check supabase/functions/ai-proxy/index.ts
Check supabase/functions/stripe-webhook/index.ts
Check supabase/functions/account-delete/index.ts
Check supabase/functions/billing-portal/index.ts
Check supabase/functions/error-report/index.ts
Check supabase/functions/reconcile-subscriptions/index.ts
Check supabase/functions/redeem-access/index.ts
Check supabase/functions/create-checkout/index.ts

$ npm run test:workflows
ok | 3 passed | 0 failed

$ npm audit
found 0 vulnerabilities
```

NOT RUN this pass:

- `npm run test:browser` — Chromium missing `libnspr4.so`; installers ECONNRESET
- Docker build / `/health` — no docker/podman binary
- Lighthouse / axe — require a running headed/headless browser

## What still blocks SHIPPED

The contract forbids SHIPPED with any NOT RUN. Re-run Step 4 from scratch on a host that can `apt-get install` Chromium deps and `docker build`, then capture `SHIP_REVIEW` screenshots for landing, app, pricing, 404, 500, terms, and privacy.
