-- Manual rollback for 20260731000000_production_architecture.sql.
-- Export entitlement and deletion-audit data before running.
BEGIN;

DROP FUNCTION IF EXISTS public.purge_expired_audit_records();
DROP FUNCTION IF EXISTS public.scrub_account_for_deletion(UUID,TEXT,TEXT,INTEGER);
DROP FUNCTION IF EXISTS public.claim_billing_event(TEXT,TEXT,BOOLEAN,TEXT);
DROP FUNCTION IF EXISTS public.set_entitlement(
  UUID,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,INTEGER,TEXT,JSONB
);
DROP POLICY IF EXISTS "entitlements_select_own" ON public.entitlements;
DROP TABLE IF EXISTS public.account_deletion_audit;
DROP TABLE IF EXISTS public.entitlements;

ALTER TABLE public.billing_events
  DROP COLUMN IF EXISTS user_id,
  DROP COLUMN IF EXISTS payload_hash,
  DROP COLUMN IF EXISTS claimed_at,
  DROP COLUMN IF EXISTS next_attempt_at,
  DROP COLUMN IF EXISTS retain_until;
ALTER TABLE public.billing_events DROP CONSTRAINT IF EXISTS billing_events_processing_state_check;
ALTER TABLE public.billing_events
  ADD CONSTRAINT billing_events_processing_state_check
  CHECK (processing_state IN ('processing','processed','failed','ignored'));
ALTER TABLE public.billing_events ALTER COLUMN processing_state SET DEFAULT 'processing';

ALTER TABLE public.error_reports DROP CONSTRAINT IF EXISTS error_reports_user_id_fkey;
ALTER TABLE public.error_reports
  ADD CONSTRAINT error_reports_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Re-apply the baseline migration to restore its bootstrap, usage RPC, and
-- storage policies before running the corresponding baseline application.
COMMIT;
