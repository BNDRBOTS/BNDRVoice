# BNDR VoiceEngine deployment

## 1. Supabase backend

Link the intended Supabase project, then apply both forward migrations in order:

```bash
supabase link --project-ref YOUR_PROJECT_REF
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

Required server secrets are listed in `.env.example`. Schedule one authenticated `POST` to `reconcile-subscriptions` daily using `RECONCILE_TOKEN`. The job reconciles every Stripe subscription, retries failed or abandoned webhook events, and purges expired audit receipts.

In Supabase Auth:

1. Set the production site URL and explicit production redirect URLs.
2. Keep email confirmation enabled and configure production SMTP.
3. Enable leaked-password protection and review Auth rate limits.
4. Confirm the browser uses only the project publishable key.

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

## 2. Railway UI

Railway is the production UI target. It builds `Dockerfile` using `railway.toml`, serves `/health`, preserves 404 responses, and emits `X-BNDR-Release: 3.2.0`. Configure `config.js` with only the Supabase URL and publishable key before deployment.

## 3. Required acceptance

1. Create and confirm an account; test password, magic link, reset, recovery, and logout.
2. Complete analysis, compilation, quality check, profile save/reload, and both exports.
3. Verify the browser sends no provider secret or model override.
4. Complete Stripe checkout and validate subscription and entitlement rows independently.
5. Replay a webhook; simulate failed/stale processing; run reconciliation.
6. Simulate payment failure, recovery, cancellation, refund, and dispute.
7. Redeem one gift and one Gumroad test code; ensure each source reference is single-account.
8. Submit an error report and verify optional Resend delivery.
9. Delete the test account and verify Auth, database rows, and every nested Storage object are gone.
10. Verify only the salted deletion audit and retention-limited billing receipt remain.

Rollback files are under `supabase/rollbacks`. Export production data first; privacy-driven scrubbing is intentionally irreversible.
