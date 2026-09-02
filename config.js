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
  BUILD_COMMIT: '8389185',

  /* ── 1. SUPABASE (auth, entitlements, profiles, exports) ──────
     This must be a publishable key protected by Row Level Security. */
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

  /* ── 3. GUMROAD (public purchase link only) ───────────────────
     Product verification configuration remains server-side. */
  GUMROAD: {
    buyUrl: ''
  },

  /* ── 4. PRICING (display only — charge amounts are set in
         Stripe / Gumroad) ───────────────────────────────────────*/
  PRICING: {
    monthly:  { price: '$19',  period: '/mo',      note: 'Billed monthly' },
    annual:   { price: '$149', period: '/yr',      note: '$12.42/mo — save 35%' },
    lifetime: { price: '$99',  period: ' once',    note: 'One payment. Yours forever.' }
  },

  /* ── 5. SUPPORT ───────────────────────────────────────────────*/
  SUPPORT_EMAIL: 'bndr.labs@gmail.com'
};
