/* ══════════════════════════════════════════════════════════════
   BNDR VoiceEngine — SITE CONFIGURATION
   ──────────────────────────────────────────────────────────────
   This file contains browser-safe configuration only. Server secrets belong
   in Supabase Edge Function secrets and are documented in .env.example.
   All pages (index.html, app.html) read from window.BNDR_CONFIG.
   ══════════════════════════════════════════════════════════════ */

window.BNDR_CONFIG = {

  /* Release marker used by diagnostics and support. */
  APP_VERSION: '3.2.0',

  /* ── 1. SUPABASE (auth, subscriptions, cloud profiles) ────────
     The legacy anon key remains browser-safe under Row Level Security.
     New deployments should replace it with an sb_publishable_ key. */
  SUPABASE_URL: 'https://sdokwqjudvxeimbzsnqc.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkb2t3cWp1ZHZ4ZWltYnpzbnFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3ODIzMjEsImV4cCI6MjA4MTM1ODMyMX0.IvsVa0AfizrHkZjBQSYugRS5iXXCPyDRanOmyrMPYIU',

  /* ── 2. STRIPE (subscriptions) ────────────────────────────────
     monthly / annual: Stripe Payment Links
       (dashboard.stripe.com → Payment Links)
     Billing management is created server-side by billing-portal. */
  STRIPE: {
    monthly: 'https://buy.stripe.com/00weVd2NReEO988gze0oM02',
    annual:  'https://buy.stripe.com/cNieVdgEHaoy0BCaaQ0oM03',
    weekly:  '',
    metered: ''
  },

  /* ── 3. GUMROAD (lifetime license, one-time payment) ──────────
     buyUrl:    your Gumroad product page, e.g.
                'https://bndr.gumroad.com/l/voiceengine'
     productId: the product ID used to verify license keys, from
                Gumroad → Product → Advanced → product ID (or use
                the product permalink, e.g. 'voiceengine').
     Enable "Generate a unique license key per sale" on the
     Gumroad product. Buyers paste their key into the app's
     "Redeem access" screen and it verifies automatically.
     Until both values are set, the Lifetime plan card explains
     it isn't available yet instead of dead-linking.             */
  GUMROAD: {
    buyUrl:    '', // ← DROP YOUR GUMROAD PRODUCT URL HERE
    productId: ''  // ← DROP YOUR GUMROAD PRODUCT ID HERE
  },

  /* ── 4. AI MODELS ────────────────────────────────────────────
     Centralized so provider migrations never require editing the
     application. These IDs were current on July 14, 2026.       */
  AI_MODELS: {
    anthropic: 'claude-sonnet-5',
    openai:    'gpt-5.6-luna',
    deepseek:  'deepseek-v4-flash'
  },

  /* ── 5. PRICING (display only — charge amounts are set in
         Stripe / Gumroad) ───────────────────────────────────────*/
  PRICING: {
    monthly:  { price: '$19',  period: '/mo',      note: 'Billed monthly' },
    annual:   { price: '$149', period: '/yr',      note: '$12.42/mo — save 35%' },
    lifetime: { price: '$99',  period: ' once',    note: 'One payment. Yours forever.' }
  },

  /* ── 6. SUPPORT ───────────────────────────────────────────────*/
  SUPPORT_EMAIL: 'bndr.labs@gmail.com'
};
