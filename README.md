# BNDR VoiceEngine

BNDR VoiceEngine converts a real writing sample into two synchronized assets: a machine-readable voice profile and a human operating guide. The recovered v5 forensic sequence remains intact—analysis, profile compilation, and quality control—but its proprietary prompt logic runs only in a Supabase Edge Function.

Release: `3.2.0`

## Architecture

- Full-stack application: Railway serves the responsive browser UI; Supabase provides Auth, Postgres, Storage, and server-side functions.
- Server-owned AI gateway credentials for Anthropic, OpenAI, and DeepSeek. Provider secrets never enter browser storage, requests, or shipped source.
- `entitlements` is the sole product-access authority. Stripe subscriptions are billing state; verified gift and Gumroad grants are account-owned lifetime entitlements.
- Stripe workflows are separated into signature intake, durable event claiming, lifecycle processing, retry/reconciliation, and retention cleanup.
- Explicit client RLS plus service-role-only grants for entitlement mutation, billing events, and deletion audits.
- Account deletion cancels billing, removes every private export, scrubs retained event payloads, revokes refresh sessions, deletes Auth/database records, and retains only a salted subject hash for operational audit.
- Structured error reports, correlation IDs, mailto/copy fallback, and optional Resend delivery.

The UI contains separate landing, application, privacy, terms, and error pages. Its core product, identity, billing, redemption, email, deletion, and reconciliation paths require server execution.

## Local verification

```bash
npm ci
npm test
npm run test:browser
npm run test:deno
npm run test:workflows
```

`npm run test:browser` writes screenshots to `BROWSER_ARTIFACT_DIR` when set, otherwise `/tmp/bndr-browser-artifacts`.

## One-command deploy

```bash
# Vercel
npx vercel --prod

# Netlify
npx netlify deploy --prod --dir .

# Railway
railway up

# Render
# Connect this repo in the Render dashboard; render.yaml builds the Dockerfile.

# Docker
docker build -t bndr-voiceengine .
docker run --rm -p 8080:8080 bndr-voiceengine
```

## Configuration

Browser-safe values live in `config.js`. Server-only values are documented in `.env.example` and must be installed as Supabase Edge Function secrets. Never place AI-provider, Stripe, Supabase secret/service-role, reconciliation, audit-salt, or email credentials in browser code.

Apply migrations in timestamp order, deploy every function declared in `supabase/config.toml`, configure Auth and server secrets, then deploy the UI through Railway. See `DEPLOYMENT.md` for the exact release order.

## Data handling

Writing samples are forwarded transiently by the AI gateway and are not written to Postgres, Storage, analytics, or application logs. Finished profiles and exports are stored only when the user explicitly saves or exports them. Provider credentials remain server-side. Account deletion removes Auth, owned database rows, and all private exports; a non-reversible salted audit hash is retained for seven years, and identifier-free Stripe event receipts for up to 400 days.

## Source provenance

The production recovery used the exact two files attached immediately before the original task:

- Ship contract SHA-256: `584bd7d9a3a5f6b468da0c49135d8d18d4722c62f7c1654c7aeb2cf4b361d2a2`
- Legacy engine SHA-256: `8dca6f654dcb9311da5d64c91a933dc0d5c1423bcc62152b34f0512664911d71`

Those hashes identify the recovered inputs; the attachments themselves are not duplicated into the public repository.
