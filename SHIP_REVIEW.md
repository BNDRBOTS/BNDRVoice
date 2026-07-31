# BNDR VoiceEngine 3.2.0 ship review

Date: 2026-07-30
Branch: `ship/2026-07-30-2`

## Production architecture

| Area | Implemented contract |
| --- | --- |
| Runtime | Full-stack Railway UI plus Supabase Auth, Postgres, Storage, and Edge Functions |
| AI gateway | Authenticated, entitlement-gated, server-owned provider credentials and models |
| Entitlements | `entitlements` is authoritative; Stripe rows hold billing state only |
| Billing | Signed intake, atomic durable claims, modular processing, retries, reconciliation, retention purge |
| Lifetime access | Account-owned gift/Gumroad entitlement with a unique hashed source reference |
| Security | Client RLS plus explicit service-role-only mutation and audit grants |
| Deletion | Stripe cancellation, recursive Storage removal, database/Auth cascade, global refresh-session revocation, salted audit hash |
| Delivery | Railway and Supabase only; unrelated hosting abstractions removed |
| UI architecture | Existing landing, app, legal, and error pages retained without redefining the product as static |

## Verification

| Gate | Result |
| --- | --- |
| Contract suite | 19/19 passed |
| HTML validation | 6/6 pages passed |
| Edge Function type check | 7/7 entrypoints passed, including shared modules |
| Browser flow | Passed analysis, compilation, quality, profile persistence, private export archive, and download |
| Security rendering | XSS payload fixtures remained inert |
| AI request boundary | Browser payload verified to contain neither provider credentials nor model overrides |
| Accessibility | No serious/critical Axe findings across landing, app, Auth, legal, and mobile states |
| Responsive matrix | Passed 320, 375, 390, 430, 768, 900, and 1440 pixel widths |
| Deployment contracts | Railway health, release headers, and strict 404 behavior passed |

## Source integrity

- Ship contract SHA-256: `584bd7d9a3a5f6b468da0c49135d8d18d4722c62f7c1654c7aeb2cf4b361d2a2`
- Legacy engine SHA-256: `8dca6f654dcb9311da5d64c91a933dc0d5c1423bcc62152b34f0512664911d71`

## Remaining release actions

Create the approved Supabase project after cost confirmation, apply migrations, deploy functions, install server secrets, configure Auth/Stripe, run database advisors, and replace browser-safe project configuration.
