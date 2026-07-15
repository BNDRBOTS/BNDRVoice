# BNDR VoiceEngine

Release **3.1.0** of a frontend-first BYOK app that turns writing into a machine-readable voice profile and a human instruction document.

## Pages

| File | Purpose |
|---|---|
| `index.html` | SaaS landing page (hero, features, pricing, FAQ, legal links) |
| `app.html` | The VoiceEngine application (4-step flow, auth, paywall, tour) |
| `privacy.html` | Privacy policy |
| `terms.html` | Terms of service |
| `config.js` | Runtime links, public client configuration, model IDs, prices, and access-code hashes |
| `assets/` | Supplied BNDR logo, pinned GSAP/Supabase browser clients, and the shared sharp-glass visual system |
| `version.json` | Machine-readable deployed release marker |
| `supabase/` | Database schema and Edge Functions |

## Configure (`config.js`)

Everything configurable lives in `window.BNDR_CONFIG` in `config.js`:

- **Supabase** — `SUPABASE_URL`, `SUPABASE_ANON_KEY` (already filled with the project's working values).
- **Stripe** — `STRIPE.monthly`, `STRIPE.annual` payment links (filled), `STRIPE.portal` customer-portal login link (empty — paste yours from Stripe Dashboard → Settings → Billing → Customer portal; the in-app “Manage Billing” item appears once set).
- **Gumroad (lifetime $99)** — `GUMROAD.buyUrl` (your product page URL) and `GUMROAD.productId` (from the product's edit page). Both empty until you create the product; until then the Lifetime buttons route users to the redeem screen, which still accepts gift codes.
- **Pricing display** — `PRICING` controls what prices render on the landing page and in-app paywall. Change numbers here (and in Stripe/Gumroad) to reprice.
- **Support email** — `SUPPORT_EMAIL`.

## Access passes

Two mechanisms, both handled by the in-app **Redeem Access** screen:

1. **Gift codes** — `GIFT_CODE_HASHES` holds SHA-256 hashes only; do not commit plaintext codes.
   Mint a new code by running this in any browser console on the site:
   ```js
   bndrHashCode('YOUR-NEW-CODE')  // prints the hash to add to GIFT_CODE_HASHES
   ```
   or with Node:
   ```bash
   node -e "console.log(require('crypto').createHash('sha256').update('YOUR-NEW-CODE'.trim().toUpperCase()).digest('hex'))"
   ```
2. **Gumroad license keys** — verified live against Gumroad's license API (refunded/disputed keys are rejected).

Redeemed passes unlock unlimited use on that device, no account required. Pass holders get on-device profile storage (up to 20 profiles).

Client-side gift-code checks are a convenience mechanism, not tamper-proof authorization: a determined visitor controls the JavaScript and local storage. Put entitlements behind a server-side check if they must resist deliberate bypass.

## Architecture

- **Static multi-page HTML** — no build step, no framework, deploys anywhere.
- **Supabase** — auth, Postgres (subscriptions, usage counts, saved profiles), and two edge functions: `ai-proxy` (JWT-verified DeepSeek relay) and `stripe-webhook` (subscription sync). Schema in `supabase/schema.sql`.
- **BYOK AI calls** — Anthropic Sonnet 5 and OpenAI GPT-5.6 Luna are called directly from the browser with a tab-scoped key. DeepSeek V4 Flash goes through the authenticated `ai-proxy` Edge Function because of browser CORS; its request body is forwarded and not stored by the function.
- **Local Mode failsafe** — if the Supabase client library or configuration cannot initialize, core work stays on-device and cloud actions return friendly errors.
- **Plan limits** — trial 5/day for 7 days; Pro 50/day; pass holders unlimited.

## Deploy

### Railway / any Docker host
```bash
docker build -t voiceengine .
docker run --rm -p 8080:8080 -e PORT=8080 voiceengine
```
The container binds to Railway's injected `PORT`; `railway.toml` checks `/health`. Verify a deployment with:

```bash
curl -i https://YOUR-SERVICE.up.railway.app/health
curl -s https://YOUR-SERVICE.up.railway.app/version.json
```

Both should report release `3.1.0`. Railway activates a new deployment only after the healthcheck returns HTTP 200, so a failed new build leaves the previous healthy version serving traffic.

### Any static host (Netlify, Vercel, S3, GitHub Pages)
Upload the four HTML files, `config.js`, `version.json`, and `assets/`.

### Supabase setup
1. Run `supabase/schema.sql` in the SQL editor.
2. Deploy edge functions: `supabase functions deploy ai-proxy` and `supabase functions deploy stripe-webhook`.
3. Set the Stripe webhook secret and API key as function secrets; point a Stripe webhook at the `stripe-webhook` function URL for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.payment_failed`.

The schema is idempotent, enables RLS, grants only the required authenticated operations, and binds usage increments to `auth.uid()`. Apply it before relying on the cloud plan gate.

## Verify before deployment

```bash
npm ci
npm test
npm run test:deno
npx playwright install chromium
npm run test:browser
```

The suite checks HTML structure and scripts, local asset references, release/model consistency, Nginx/Railway health contracts, security-sensitive SQL, both Edge Functions, and the absence of the retired grain treatment. The browser pass verifies desktop/mobile layouts, navigation, the supplied logo, an entire mocked AI analysis/generation/quality-check flow, downloads, saved profiles, accessibility, and XSS regression cases without calling a live AI provider. GitHub Actions also builds the real Docker image, runs it with a non-default injected port, checks `/health`, verifies the release header, and confirms missing pages return 404.

## Stripe notes

Payment links pass the signed-in user's email (`prefilled_email`) and user ID (`client_reference_id`) so the webhook can attach the subscription to the right account. After checkout the app polls for activation when it sees `?upgraded=1`.

## Data stored in the browser

| Key | Storage | Purpose |
|---|---|---|
| `apex_key`, `apex_oai_key`, `apex_ds_key`, `apex_provider` | session | API keys + provider (tab-only) |
| `bndr_pass` | local | Redeemed access pass |
| `bndr_profiles` | local | On-device profiles (pass holders / Local Mode) |
| `bndr_local_usage` | local | Local Mode daily counter |
| `bndr_consent` | local | Cookie-notice acknowledgment |
| `bndr_tour_done` | local | Guided tour completion |

## Pricing source of truth

Keep the displayed values in `config.js` synchronized with the actual Stripe payment-link prices and the future Gumroad product. The application deliberately does not infer or advertise checkout prices that cannot be verified from those providers.
