# BNDR VoiceEngine ship review

Release candidate: `3.2.0`  
Recovery branch: `ship/2026-07-30-2`

## Requirement ledger

| Contract area | Implementation | Evidence |
| --- | --- | --- |
| Exact input recovery | Hash-pinned recovered contract and legacy engine | `README.md` provenance |
| Forensic parity | Analysis dimensions, score calibration, compiler, filters, and QC preserved server-side | `supabase/functions/ai-proxy/forensic.ts` |
| Auth/account lifecycle | Password, magic link, reset/recovery, logout, protected gateway, account deletion | `app.html`, `account-delete` |
| Persistent shared state | Profiles, preferences, usage, subscriptions, reports | forward migration |
| RLS/storage | RLS on every application table; private owner-scoped export bucket | forward migration |
| Migration recovery | Forward migration plus explicit structural rollback | `supabase/migrations`, `supabase/rollbacks` |
| Entitlements | Trial, weekly, monthly, annual, metered, lifetime; fixed grace window, cancel, refund, dispute | webhook + migration |
| Account redemption | Server-only gift hashes and Gumroad verification grant account-owned lifetime access | `redeem-access` |
| Webhook safety | Stripe signature, size limit, durable idempotency, audit history | `stripe-webhook` |
| Reconciliation | Token-protected Stripe-to-Postgres reconciliation function | `reconcile-subscriptions` |
| Account deletion | Stripe subscription canceled before Storage/Auth deletion; database rows cascade | `account-delete` + migration |
| Error reporting | Stable codes, correlation IDs, database report, optional email, copy/mailto fallback | app + `error-report` |
| Walkthrough | First-run, skip/complete persistence per user, replay, missing-anchor fallback | app + preferences |
| Production web | Landing, pricing, legal, responsive app, 404/500, metadata, robots, sitemap | root pages/config |
| Legal/data handling | Product-specific Terms and Privacy match saved/transient data and deletion paths | `terms.html`, `privacy.html` |
| Deployment | Vercel, Netlify, Railway, Render, Docker, health | deployment contracts |
| Code protection | Forensic prompts removed from browser and kept in Edge Function | contract test |
| Keyless boot/env validation | Complete server-secret scaffold and clean 503 configuration states; no secret committed | `.env.example` + functions |
| Dependency/content security | Zero audit findings; no source maps, plaintext secrets, TODO/FIXME/HACK/lorem | final gate |
| Browser security/quality | Escaped hostile fixtures, accessibility checks, responsive matrix, export/save/load | Playwright matrix |

## Verification record

The final local gate ran after the last source change.

| Check | Command | Result |
| --- | --- | --- |
| Exact recovered inputs | SHA-256 comparison | exit 0; both hashes matched |
| Fresh install | `npm ci` | exit 0; 68 packages |
| Production/static build | `npm run build` | exit 0; 19 contracts + 6 HTML pages |
| Repeated full static suite | `npm test` | exit 0; 19 contracts + 6 HTML pages |
| Edge Function type gate | `npm run test:deno` | exit 0; 7 functions |
| Authenticated browser matrix | `npm run test:browser` | exit 0; desktop + 320/375/390/430/768/900 widths |
| Browser security/a11y | same Playwright run | exit 0; XSS fixtures inert, serious/critical a11y = 0 |
| Dependency security | `npm audit --audit-level=low` | exit 0; 0 vulnerabilities |
| Deploy config syntax | JSON + `tomllib` + PyYAML parsers | exit 0; 4 JSON, 3 TOML, 1 YAML |
| SQL syntax | PostgreSQL 17 parser on forward + rollback | exit 0; 2 scripts |
| Diff/content/security scan | `git diff --check`, source-map/content/secret scans | exit 0; 0 findings |
| Local route/concurrency smoke | preview + route crawl + 40 parallel `/health` requests | exit 0; 10 expected 200s, missing route 404 |
| Local Supabase runtime | `supabase start` | blocked: Docker socket access denied |
| Live Supabase | connected-project inventory | blocked: target `sdokwqjudvxeimbzsnqc` is not in the connected account |
| Live hosts | target inventory | blocked: no authorized Vercel/Railway/Render deployment targets supplied |

Because the exact Supabase project and live hosts are not connected, this ledger does not claim a live production deployment. The repository release candidate and every locally executable gate are complete.
