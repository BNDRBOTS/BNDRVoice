# BNDR VoiceEngine

A frontend-first SaaS that turns a sample of someone's writing into a deployable **voice profile**: a machine-readable JSON system prompt any AI tool obeys, plus a human-readable instruction doc. BYOK (bring your own key) — user writing and API keys never touch your servers.

## Pages

| File | Purpose |
|---|---|
| `index.html` | SaaS landing page (hero, features, pricing, FAQ, legal links) |
| `app.html` | The VoiceEngine application (4-step flow, auth, paywall, tour) |
| `privacy.html` | Privacy policy |
| `terms.html` | Terms of service |
| `config.js` | **The only file you edit.** All keys, links, prices, and gift codes |

## Drop in your keys (`config.js`)

Everything configurable lives in `window.BNDR_CONFIG` in `config.js`:

- **Supabase** — `SUPABASE_URL`, `SUPABASE_ANON_KEY` (already filled with the project's working values).
- **Stripe** — `STRIPE.monthly`, `STRIPE.annual` payment links (filled), `STRIPE.portal` customer-portal login link (empty — paste yours from Stripe Dashboard → Settings → Billing → Customer portal; the in-app “Manage Billing” item appears once set).
- **Gumroad (lifetime $99)** — `GUMROAD.buyUrl` (your product page URL) and `GUMROAD.productId` (from the product's edit page). Both empty until you create the product; until then the Lifetime buttons route users to the redeem screen, which still accepts gift codes.
- **Pricing display** — `PRICING` controls what prices render on the landing page and in-app paywall. Change numbers here (and in Stripe/Gumroad) to reprice.
- **Support email** — `SUPPORT_EMAIL`.

## Payment-gate bypass (give it away free)

Two mechanisms, both handled by the in-app **Redeem Access** screen:

1. **Gift codes** — `GIFT_CODE_HASHES` in `config.js` holds SHA-256 hashes of codes (never the codes themselves, so they can't be scraped from source). Two codes ship ready to use: `BNDR-VIP-2026` and `FRIENDS-OF-BNDR` (documented in the config comments — rotate them before wide release if you want).
   Mint a new code by running this in any browser console on the site:
   ```js
   bndrHashCode('YOUR-NEW-CODE')  // prints the hash to add to GIFT_CODE_HASHES
   ```
   or with Node:
   ```bash
   node -e "console.log(require('crypto').createHash('sha256').update('YOUR-NEW-CODE'.trim().toUpperCase()).digest('hex'))"
   ```
2. **Gumroad license keys** — verified live against Gumroad's public license API (refunded/disputed keys rejected).

Redeemed passes unlock unlimited use on that device, no account required. Pass holders get on-device profile storage (up to 20 profiles).

## Architecture

- **Static multi-page HTML** — no build step, no framework, deploys anywhere.
- **Supabase** — auth, Postgres (subscriptions, usage counts, saved profiles), and two edge functions: `ai-proxy` (JWT-verified DeepSeek relay) and `stripe-webhook` (subscription sync). Schema in `supabase/schema.sql`.
- **BYOK AI calls** — Anthropic and OpenAI are called directly from the browser with the user's key (session storage only); DeepSeek goes through the `ai-proxy` edge function.
- **Local Mode failsafe** — if the Supabase CDN or config is unreachable, the app degrades gracefully: 5 free analyses/day enforced on-device, profiles save locally, no crashes, a toast explains the state.
- **Plan limits** — trial 5/day for 7 days; Pro 50/day; pass holders unlimited.

## Deploy

### Railway / any Docker host
```bash
docker build -t voiceengine .
docker run -p 8080:80 voiceengine
```
The container serves all pages via nginx with a `/health` endpoint (Railway healthcheck is preconfigured in `railway.toml`).

### Any static host (Netlify, Vercel, S3, GitHub Pages)
Upload `index.html`, `app.html`, `privacy.html`, `terms.html`, and `config.js`. That's the whole site.

### Supabase setup (already provisioned for this project)
1. Run `supabase/schema.sql` in the SQL editor.
2. Deploy edge functions: `supabase functions deploy ai-proxy` and `supabase functions deploy stripe-webhook`.
3. Set the Stripe webhook secret and API key as function secrets; point a Stripe webhook at the `stripe-webhook` function URL for `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`.

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

## Pricing rationale

Comparable brand-voice tools charge $29–$69/user/month (Copy.ai $29–$49, Jasper $59–$69). Because VoiceEngine is BYOK (no compute resale), $19/mo, $149/yr (35% off), and $99 lifetime undercut the market while staying high-margin — infrastructure cost is a static host plus Supabase free tier.
