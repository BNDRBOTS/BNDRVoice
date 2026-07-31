-- Production architecture hardening. This is forward-only and safe after the
-- 20260730000000 baseline migration.

-- Entitlements are the only product-access source of truth. Stripe rows retain
-- billing state only; gift/Gumroad/lifetime grants never create subscriptions.
CREATE TABLE IF NOT EXISTS public.entitlements (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('trial','active','grace','suspended','expired')),
  product_tier TEXT NOT NULL CHECK (product_tier IN ('trial','pro','lifetime')),
  source TEXT NOT NULL CHECK (source IN ('signup','stripe','gift','gumroad','admin')),
  source_ref TEXT,
  daily_limit INTEGER NOT NULL CHECK (daily_limit >= 0),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  valid_until TIMESTAMPTZ,
  grace_until TIMESTAMPTZ,
  version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_entitlements_redeemed_source
  ON public.entitlements(source, source_ref)
  WHERE source IN ('gift','gumroad') AND source_ref IS NOT NULL;
DROP TRIGGER IF EXISTS trg_entitlements_updated_at ON public.entitlements;
CREATE TRIGGER trg_entitlements_updated_at
BEFORE UPDATE ON public.entitlements
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.entitlements(
  user_id, status, product_tier, source, daily_limit, valid_from, valid_until, grace_until
)
SELECT
  s.user_id,
  CASE
    WHEN s.plan_interval = 'lifetime' AND s.status = 'active' THEN 'active'
    WHEN s.status = 'trial' AND s.trial_ends_at > timezone('utc', now()) THEN 'trial'
    WHEN s.status = 'active' THEN 'active'
    WHEN s.status IN ('grace','past_due') THEN 'grace'
    WHEN s.status = 'paused' THEN 'suspended'
    ELSE 'expired'
  END,
  CASE WHEN s.plan_interval = 'lifetime' THEN 'lifetime'
       WHEN s.status = 'trial' THEN 'trial' ELSE 'pro' END,
  CASE WHEN s.plan_interval = 'lifetime' THEN 'admin'
       WHEN s.status = 'trial' THEN 'signup' ELSE 'stripe' END,
  CASE WHEN s.plan_interval = 'lifetime' THEN 1000000
       WHEN s.status = 'trial' THEN 5 ELSE 50 END,
  COALESCE(s.current_period_start, s.created_at),
  CASE WHEN s.plan_interval = 'lifetime' THEN NULL
       WHEN s.status = 'trial' THEN s.trial_ends_at ELSE s.current_period_end END,
  s.grace_ends_at
FROM public.subscriptions s
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.entitlements(
  user_id, status, product_tier, source, daily_limit, valid_from, valid_until
)
SELECT u.id, 'trial', 'trial', 'signup', 5, u.created_at, u.created_at + INTERVAL '7 days'
FROM auth.users u
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.entitlements(
    user_id, status, product_tier, source, daily_limit, valid_from, valid_until
  )
  VALUES (
    NEW.id, 'trial', 'trial', 'signup', 5,
    timezone('utc', now()), timezone('utc', now()) + INTERVAL '7 days'
  )
  ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.user_preferences(user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.check_and_increment_usage(UUID);
CREATE FUNCTION public.check_and_increment_usage(p_user_id UUID)
RETURNS TABLE(allowed BOOLEAN, current_count INTEGER, daily_limit INTEGER, entitlement_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entitlement public.entitlements%ROWTYPE;
  v_count INTEGER := 0;
  v_limit INTEGER := 0;
  v_status TEXT := 'expired';
  v_today DATE := (timezone('utc', now()))::date;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR (SELECT auth.uid()) <> p_user_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_entitlement
  FROM public.entitlements WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'entitlement missing' USING ERRCODE = 'P0002';
  END IF;

  IF v_entitlement.status = 'trial'
     AND v_entitlement.valid_until > timezone('utc', now()) THEN
    v_status := 'trial';
    v_limit := v_entitlement.daily_limit;
  ELSIF v_entitlement.status = 'active'
     AND (v_entitlement.valid_until IS NULL
          OR v_entitlement.valid_until > timezone('utc', now())) THEN
    v_status := 'active';
    v_limit := v_entitlement.daily_limit;
  ELSIF v_entitlement.status = 'grace'
     AND v_entitlement.grace_until > timezone('utc', now()) THEN
    v_status := 'grace';
    v_limit := v_entitlement.daily_limit;
  END IF;

  INSERT INTO public.usage_tracking(user_id, request_date, request_count)
  VALUES (p_user_id, v_today, 0)
  ON CONFLICT (user_id, request_date) DO NOTHING;
  SELECT request_count INTO v_count FROM public.usage_tracking
  WHERE user_id = p_user_id AND request_date = v_today FOR UPDATE;
  IF v_count >= v_limit THEN
    RETURN QUERY SELECT false, v_count, v_limit, v_status;
    RETURN;
  END IF;
  UPDATE public.usage_tracking
  SET request_count = request_count + 1, updated_at = timezone('utc', now())
  WHERE user_id = p_user_id AND request_date = v_today
  RETURNING request_count INTO v_count;
  RETURN QUERY SELECT true, v_count, v_limit, v_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_entitlement(
  p_user_id UUID,
  p_status TEXT,
  p_product_tier TEXT,
  p_source TEXT,
  p_source_ref TEXT,
  p_valid_until TIMESTAMPTZ,
  p_grace_until TIMESTAMPTZ,
  p_daily_limit INTEGER,
  p_reason TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_previous public.entitlements%ROWTYPE;
BEGIN
  IF p_status NOT IN ('trial','active','grace','suspended','expired')
     OR p_product_tier NOT IN ('trial','pro','lifetime')
     OR p_source NOT IN ('signup','stripe','gift','gumroad','admin')
     OR p_daily_limit < 0 THEN
    RAISE EXCEPTION 'invalid entitlement transition';
  END IF;
  SELECT * INTO v_previous FROM public.entitlements
  WHERE user_id = p_user_id FOR UPDATE;

  -- A billing event cannot revoke a separately purchased lifetime grant.
  IF FOUND AND v_previous.product_tier = 'lifetime'
     AND v_previous.source IN ('gift','gumroad','admin') AND p_source = 'stripe' THEN
    RETURN;
  END IF;

  INSERT INTO public.entitlements(
    user_id, status, product_tier, source, source_ref, daily_limit,
    valid_from, valid_until, grace_until
  )
  VALUES (
    p_user_id, p_status, p_product_tier, p_source, p_source_ref, p_daily_limit,
    timezone('utc', now()), p_valid_until, p_grace_until
  )
  ON CONFLICT (user_id) DO UPDATE SET
    status = EXCLUDED.status,
    product_tier = EXCLUDED.product_tier,
    source = EXCLUDED.source,
    source_ref = EXCLUDED.source_ref,
    daily_limit = EXCLUDED.daily_limit,
    valid_from = EXCLUDED.valid_from,
    valid_until = EXCLUDED.valid_until,
    grace_until = EXCLUDED.grace_until,
    version = public.entitlements.version + 1;

  INSERT INTO public.entitlement_history(
    user_id, source_event_id, from_status, to_status, reason, metadata
  )
  VALUES (
    p_user_id, p_source_ref, v_previous.status, p_status, p_reason,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'source', p_source, 'product_tier', p_product_tier
    )
  );
END;
$$;

-- Durable Stripe inbox. No raw webhook body is retained.
ALTER TABLE public.billing_events
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payload_hash TEXT,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retain_until TIMESTAMPTZ
    NOT NULL DEFAULT (timezone('utc', now()) + INTERVAL '400 days');
UPDATE public.billing_events SET payload = '{}'::jsonb;
ALTER TABLE public.billing_events ALTER COLUMN payload SET DEFAULT '{}'::jsonb;
ALTER TABLE public.billing_events DROP CONSTRAINT IF EXISTS billing_events_processing_state_check;
ALTER TABLE public.billing_events
  ADD CONSTRAINT billing_events_processing_state_check
  CHECK (processing_state IN ('received','processing','processed','failed','ignored'));
ALTER TABLE public.billing_events ALTER COLUMN processing_state SET DEFAULT 'received';
CREATE INDEX IF NOT EXISTS idx_billing_events_retry
  ON public.billing_events(processing_state, next_attempt_at, claimed_at);

CREATE OR REPLACE FUNCTION public.claim_billing_event(
  p_event_id TEXT,
  p_event_type TEXT,
  p_livemode BOOLEAN,
  p_payload_hash TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event public.billing_events%ROWTYPE;
BEGIN
  INSERT INTO public.billing_events(
    stripe_event_id, event_type, livemode, payload_hash, processing_state, attempt_count
  )
  VALUES (p_event_id, p_event_type, p_livemode, p_payload_hash, 'received', 0)
  ON CONFLICT (stripe_event_id) DO NOTHING;

  SELECT * INTO v_event FROM public.billing_events
  WHERE stripe_event_id = p_event_id FOR UPDATE;
  IF v_event.payload_hash IS NOT NULL AND v_event.payload_hash <> p_payload_hash THEN
    RAISE EXCEPTION 'event payload hash mismatch';
  END IF;
  IF v_event.processing_state IN ('processed','ignored')
     OR (v_event.processing_state = 'processing'
         AND v_event.claimed_at > timezone('utc', now()) - INTERVAL '30 minutes')
     OR (v_event.processing_state = 'failed'
         AND v_event.next_attempt_at > timezone('utc', now())) THEN
    RETURN FALSE;
  END IF;
  UPDATE public.billing_events SET
    processing_state = 'processing',
    payload_hash = p_payload_hash,
    claimed_at = timezone('utc', now()),
    next_attempt_at = NULL,
    attempt_count = attempt_count + 1,
    processing_error = NULL
  WHERE stripe_event_id = p_event_id;
  RETURN TRUE;
END;
$$;

-- Deletion audit retains only a one-way salted subject hash and operational
-- outcomes. Application content, email, auth IDs, and billing identifiers are
-- never copied into this table.
CREATE TABLE IF NOT EXISTS public.account_deletion_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_hash TEXT NOT NULL CHECK (char_length(subject_hash) = 64),
  billing_result TEXT NOT NULL,
  storage_object_count INTEGER NOT NULL CHECK (storage_object_count >= 0),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  retain_until TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now()) + INTERVAL '7 years')
);
ALTER TABLE public.account_deletion_audit ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.error_reports DROP CONSTRAINT IF EXISTS error_reports_user_id_fkey;
ALTER TABLE public.error_reports
  ADD CONSTRAINT error_reports_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.scrub_account_for_deletion(
  p_user_id UUID,
  p_subject_hash TEXT,
  p_billing_result TEXT,
  p_storage_object_count INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF char_length(p_subject_hash) <> 64 OR p_storage_object_count < 0 THEN
    RAISE EXCEPTION 'invalid deletion audit';
  END IF;
  UPDATE public.billing_events SET user_id = NULL, payload = '{}'::jsonb
  WHERE user_id = p_user_id;
  INSERT INTO public.account_deletion_audit(
    subject_hash, billing_result, storage_object_count
  ) VALUES (p_subject_hash, p_billing_result, p_storage_object_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_expired_audit_records()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.billing_events WHERE retain_until < timezone('utc', now());
  DELETE FROM public.account_deletion_audit WHERE retain_until < timezone('utc', now());
END;
$$;

ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "entitlements_select_own" ON public.entitlements;
CREATE POLICY "entitlements_select_own" ON public.entitlements
FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

-- Audit and billing inbox tables intentionally have no client policies.
REVOKE ALL ON TABLE public.entitlements, public.billing_events,
  public.account_deletion_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.entitlements TO authenticated;
GRANT ALL ON TABLE public.entitlements, public.subscriptions,
  public.billing_events, public.entitlement_history, public.usage_tracking,
  public.voice_profiles, public.user_preferences, public.error_reports,
  public.account_deletion_audit TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

REVOKE ALL ON FUNCTION public.set_entitlement(
  UUID,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,INTEGER,TEXT,JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_entitlement(
  UUID,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,INTEGER,TEXT,JSONB
) TO service_role;
REVOKE ALL ON FUNCTION public.claim_billing_event(TEXT,TEXT,BOOLEAN,TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_billing_event(TEXT,TEXT,BOOLEAN,TEXT)
  TO service_role;
REVOKE ALL ON FUNCTION public.scrub_account_for_deletion(UUID,TEXT,TEXT,INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scrub_account_for_deletion(UUID,TEXT,TEXT,INTEGER)
  TO service_role;
REVOKE ALL ON FUNCTION public.purge_expired_audit_records()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_audit_records() TO service_role;
REVOKE ALL ON FUNCTION public.check_and_increment_usage(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_and_increment_usage(UUID) TO authenticated;

-- Every storage action requires both the user's folder and ownership.
DROP POLICY IF EXISTS "voice_exports_select_own" ON storage.objects;
CREATE POLICY "voice_exports_select_own" ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id = 'voice-profile-exports'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND owner_id = (SELECT auth.uid())::text
);
DROP POLICY IF EXISTS "voice_exports_insert_own" ON storage.objects;
CREATE POLICY "voice_exports_insert_own" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'voice-profile-exports'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND owner_id = (SELECT auth.uid())::text
);
DROP POLICY IF EXISTS "voice_exports_update_own" ON storage.objects;
CREATE POLICY "voice_exports_update_own" ON storage.objects
FOR UPDATE TO authenticated USING (
  bucket_id = 'voice-profile-exports'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND owner_id = (SELECT auth.uid())::text
) WITH CHECK (
  bucket_id = 'voice-profile-exports'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND owner_id = (SELECT auth.uid())::text
);
DROP POLICY IF EXISTS "voice_exports_delete_own" ON storage.objects;
CREATE POLICY "voice_exports_delete_own" ON storage.objects
FOR DELETE TO authenticated USING (
  bucket_id = 'voice-profile-exports'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND owner_id = (SELECT auth.uid())::text
);
