# BNDRVoice ship ledger — 2026-09-02

Branch: `arena/01a06138-bndrvoice`  
Release: `3.2.0`  
Stamp: `8389185`

Verdict: **SHIPPED**

Voice detection / forensic engine: `supabase/functions/ai-proxy/forensic.ts` is unchanged. `callVoiceEngine` still posts `operation` + payload to the server-owned gateway with no client keys or model names.

## Step 4 final pass (from scratch after last source change)

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

$ BROWSER_ARTIFACT_DIR=SHIP_REVIEW npm run test:browser
ok 1 - desktop, mobile, and the full mocked VoiceEngine flow work
# tests 1  pass 1  fail 0

$ npm run test:docker
ok 1 - Dockerfile nginx config serves /health and public routes on the injected PORT

$ npm audit
found 0 vulnerabilities

Lighthouse (landing, Chromium + al2023 libs):
  accessibility   100
  best-practices   96
  seo              92
```

Axe critical/serious: 0 on landing, app, auth, mobile (inside `test:browser`).

## How Chromium ran

`@sparticuz/chromium` already vendors `al2023.tar.br` (`libnspr4.so`, `libnss3.so`). Those libs are only auto-extracted on Amazon Linux. The browser test now inflates them and sets `LD_LIBRARY_PATH` so the same Chromium binary launches here.

## How Docker/health ran

No `docker` daemon in this sandbox. Nginx **1.27.2** (same major as `Dockerfile` `nginx:1.27-alpine`) was compiled from source with PCRE + zlib and executed with this repo's `nginx.conf` (`PORT` substituted). `/health` returned `{"status":"ok","release":"3.2.0"}`; `/`, `/app`, `/pricing`, 404, and `X-BNDR-Release` headers match the image contract.

## Product fixes this pass (not voice detection)

| Gap | File | Proof |
| --- | --- | --- |
| Provider badge contrast 4.15 < 4.5 | `app.html` `.provider-badge.anthropic` | axe in `test:browser` |
| Canonical was `/` | `index.html` `https://voice.bndr.bot/` | Lighthouse SEO |
| Chromium missing nspr | `tests/browser.test.mjs` inflate al2023 | `test:browser` pass |
| Nginx `/health` | `tests/docker-health.test.mjs` | `test:docker` pass |

SHIP_REVIEW screenshots: landing, app, pricing, privacy, terms, 404, 500 (desktop); landing + app (mobile).
