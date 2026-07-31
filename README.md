# BNDR VoiceEngine

BNDR VoiceEngine converts a real writing sample into two synchronized assets: a machine-readable voice profile and a human operating guide. The recovered v5 forensic sequence remains intact—analysis, profile compilation, and quality control—but its proprietary prompt logic now runs only in a Supabase Edge Function.

Release: `3.2.0`

## Architecture

- Static, responsive multi-page web app deployable to Vercel, Netlify, Railway, or Render.
- Supabase Auth for email/password, magic link, reset, session recovery, logout, and account deletion.
- Supabase Postgres with RLS on every application table.
- Private Supabase Storage bucket for user-scoped exports.
- Authenticated BYOK AI gateway for Anthropic, OpenAI, and DeepSeek. Provider keys stay in tab-scoped session storage, cross the gateway only for the current request, and are never stored by BNDR.
- Stripe webhook with signature verification, durable event idempotency, audit history, refunds, disputes, three-day payment-failure grace, upgrade/downgrade propagation, and a reconciliation function.
- Authenticated server-side gift-code and Gumroad license redemption; lifetime access is attached to the signed-in account.
- Per-user walkthrough state, structured error codes, correlation IDs, durable reports, mailto/copy fallback, and optional Resend delivery.

## Local verification

```bash
npm ci
npm test
npm run test:browser
npm run test:deno
```

`npm run test:browser` writes screenshots to `BROWSER_ARTIFACT_DIR` when set, otherwise `/tmp/bndr-browser-artifacts`.

## Configuration

Browser-safe values live in `config.js`. Server-only values are documented in `.env.example` and must be installed as Supabase Edge Function secrets. Never place Stripe, Supabase secret/service-role, reconciliation, or email credentials in browser code.

Run `supabase db push` to apply `supabase/migrations/20260730000000_voiceengine_3_2_0.sql`, then deploy the functions declared in `supabase/config.toml`. The committed target project ref is `sdokwqjudvxeimbzsnqc`; confirm that the connected Supabase account owns that project before applying anything.

See `DEPLOYMENT.md` for the exact release order and `SHIP_REVIEW.md` for the requirement ledger and test evidence.

## Data handling

Writing samples and provider keys are forwarded transiently to the selected provider and are not written to Postgres, Storage, analytics, or application logs. The database stores account-linked entitlements, daily usage totals, tour state, reports explicitly submitted by the user, and profiles the user explicitly saves. Account deletion removes the Auth user and cascades owned database data; the deletion function also removes private exports.

## Source provenance

The production recovery used the exact two files attached immediately before the original task:

- Ship contract SHA-256: `584bd7d9a3a5f6b468da0c49135d8d18d4722c62f7c1654c7aeb2cf4b361d2a2`
- Legacy engine SHA-256: `8dca6f654dcb9311da5d64c91a933dc0d5c1423bcc62152b34f0512664911d71`

Those hashes are evidence of the exact recovered inputs; the attachments themselves are not duplicated into the public repository.
