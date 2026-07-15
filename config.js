/* ══════════════════════════════════════════════════════════════
   BNDR VoiceEngine — SITE CONFIGURATION
   ──────────────────────────────────────────────────────────────
   THIS IS THE ONLY FILE YOU NEED TO EDIT.
   Every key, payment link, and access code lives here.
   All pages (index.html, app.html) read from window.BNDR_CONFIG.
   ══════════════════════════════════════════════════════════════ */

window.BNDR_CONFIG = {

  /* Release marker used by diagnostics and support. */
  APP_VERSION: '3.1.0',

  /* ── 1. SUPABASE (auth, subscriptions, cloud profiles) ────────
     Already deployed and working. Replace only if you migrate
     to a different Supabase project.                            */
  SUPABASE_URL: 'https://sdokwqjudvxeimbzsnqc.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkb2t3cWp1ZHZ4ZWltYnpzbnFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3ODIzMjEsImV4cCI6MjA4MTM1ODMyMX0.IvsVa0AfizrHkZjBQSYugRS5iXXCPyDRanOmyrMPYIU',

  /* ── 2. STRIPE (subscriptions) ────────────────────────────────
     monthly / annual: Stripe Payment Links
       (dashboard.stripe.com → Payment Links)
     portal: Customer Portal login link
       (dashboard.stripe.com → Settings → Billing → Customer portal)
     Until you paste a real portal link, the app shows a friendly
     "portal not configured" message instead of a broken link.   */
  STRIPE: {
    monthly: 'https://buy.stripe.com/00weVd2NReEO988gze0oM02',
    annual:  'https://buy.stripe.com/cNieVdgEHaoy0BCaaQ0oM03',
    portal:  '' // ← DROP YOUR STRIPE CUSTOMER PORTAL LINK HERE (optional)
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

  /* ── 5. GIFT / VIP ACCESS CODES (payment-gate bypass) ─────────
     Give the app away to anyone you choose. Hand them a code;
     they redeem it in the app ("Redeem access") and get full,
     unlimited use on that device — no account, no payment.
     Only SHA-256 hashes belong in this public file. Never place
     the original codes in this repository or its documentation.
     Codes are case-insensitive and should be rotated if shared
     publicly or committed in plaintext.

     To mint a new code, run this in any terminal:
       node -e "console.log(require('crypto').createHash('sha256').update('YOUR-NEW-CODE'.trim().toUpperCase()).digest('hex'))"
     …or open the browser console on any page of this site and run:
       bndrHashCode('YOUR-NEW-CODE').then(console.log)
     Then paste the printed hash into this list.                 */
  GIFT_CODE_HASHES: [
    '40d165af1976af26944ddce7054f23853e2aa5cf32d0f41eedc62d0e8c9e4b65',
    '80d567aea74b7666337ee89d4ad610d4b8a88ee70251c796762818f3794642ac'
  ],

  /* ── 6. PRICING (display only — charge amounts are set in
         Stripe / Gumroad) ───────────────────────────────────────*/
  PRICING: {
    monthly:  { price: '$19',  period: '/mo',      note: 'Billed monthly' },
    annual:   { price: '$149', period: '/yr',      note: '$12.42/mo — save 35%' },
    lifetime: { price: '$99',  period: ' once',    note: 'One payment. Yours forever.' }
  },

  /* ── 7. SUPPORT ───────────────────────────────────────────────*/
  SUPPORT_EMAIL: 'bndrbots@gmail.com'
};

/* Helper for minting gift-code hashes from the browser console. */
window.bndrHashCode = async function (code) {
  const data = new TextEncoder().encode(String(code).trim().toUpperCase());
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
};
