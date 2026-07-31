# BNDR VoiceEngine deployment

## 1. Supabase

Confirm the intended project ref is `sdokwqjudvxeimbzsnqc`.

```bash
supabase link --project-ref sdokwqjudvxeimbzsnqc
supabase db push
supabase secrets set --env-file .env.production
supabase functions deploy ai-proxy
supabase functions deploy stripe-webhook
supabase functions deploy account-delete
supabase functions deploy billing-portal
supabase functions deploy error-report
supabase functions deploy reconcile-subscriptions
supabase functions deploy redeem-access
```

Required secrets are listed in `.env.example`. Configure a daily authenticated request to `reconcile-subscriptions` using the same `RECONCILE_TOKEN`.

The forward migration is `supabase/migrations/20260730000000_voiceengine_3_2_0.sql`. Its manual structural rollback is `supabase/rollbacks/20260730000000_voiceengine_3_2_0.down.sql`; export production data before rollback because 3.2.0-only records and intentionally erased legacy sample previews are not reconstructible.

In Supabase Auth:

1. Set the production site URL and add every production/preview redirect URL.
2. Keep email confirmation enabled.
3. Configure SMTP for production delivery.
4. Confirm leaked-password protection and rate limits.

In Stripe, send these events to `/functions/v1/stripe-webhook`:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_succeeded`
- `invoice.payment_failed`
- `charge.refunded`
- `charge.dispute.created`
- `charge.dispute.closed`

## 2. Static hosts

The same source tree is ready for all required targets:

| Target | Contract |
| --- | --- |
| Vercel | `vercel.json` |
| Netlify | `netlify.toml` |
| Railway | `railway.toml` + `Dockerfile` |
| Render | `render.yaml` + `Dockerfile` |

Each target must serve `/health`, preserve 404 status for missing assets, and expose release header `X-BNDR-Release: 3.2.0`.

## 3. Post-deploy acceptance

1. Create and confirm an account.
2. Test password sign-in, magic link, reset, logout, and session recovery.
3. Complete one analysis, one profile compile, one quality check, save/reload/export.
4. Complete a Stripe test checkout and verify the entitlement transition.
5. Replay the same webhook event and confirm it is marked duplicate.
6. Simulate payment failure, recovery, cancellation, refund, and dispute.
7. Submit a structured error report and verify its correlation ID.
8. Delete the test account and verify Auth, database rows, and private exports are gone.
9. Redeem a test gift code and a Gumroad test license; verify each grants one account-owned lifetime entitlement.
