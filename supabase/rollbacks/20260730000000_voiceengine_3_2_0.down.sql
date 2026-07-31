-- Manual structural rollback for 20260730000000_voiceengine_3_2_0.sql.
-- Export application data first. This restores the v5 schema contract; data
-- in 3.2.0-only tables and the intentionally removed sample previews cannot
-- be reconstructed after the forward privacy migration.

BEGIN;

DROP POLICY IF EXISTS "voice_exports_select_own" ON storage.objects;
DROP POLICY IF EXISTS "voice_exports_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "voice_exports_update_own" ON storage.objects;
DROP POLICY IF EXISTS "voice_exports_delete_own" ON storage.objects;
DELETE FROM storage.buckets
WHERE id = 'voice-profile-exports'
  AND NOT EXISTS (
    SELECT 1 FROM storage.objects WHERE bucket_id = 'voice-profile-exports'
  );

DROP TABLE IF EXISTS public.error_reports;
DROP TABLE IF EXISTS public.user_preferences;
DROP TABLE IF EXISTS public.entitlement_history;
DROP TABLE IF EXISTS public.billing_events;

ALTER TABLE public.voice_profiles
  ADD COLUMN IF NOT EXISTS sample_preview TEXT;
ALTER TABLE public.voice_profiles
  DROP CONSTRAINT IF EXISTS voice_profiles_name_check;
ALTER TABLE public.voice_profiles
  DROP CONSTRAINT IF EXISTS voice_profiles_provider_check;
ALTER TABLE public.voice_profiles
  DROP CONSTRAINT IF EXISTS chk_voice_profiles_name;
ALTER TABLE public.voice_profiles
  DROP CONSTRAINT IF EXISTS chk_voice_profiles_preview;
ALTER TABLE public.voice_profiles
  DROP CONSTRAINT IF EXISTS chk_voice_profiles_machine_object;
ALTER TABLE public.voice_profiles
  DROP CONSTRAINT IF EXISTS chk_voice_profiles_analysis_object;
ALTER TABLE public.voice_profiles
  ADD CONSTRAINT chk_voice_profiles_name
    CHECK (CHAR_LENGTH(BTRIM(name)) BETWEEN 1 AND 120) NOT VALID;
ALTER TABLE public.voice_profiles
  ADD CONSTRAINT chk_voice_profiles_preview
    CHECK (sample_preview IS NULL OR CHAR_LENGTH(sample_preview) <= 500) NOT VALID;
ALTER TABLE public.voice_profiles
  ADD CONSTRAINT chk_voice_profiles_machine_object
    CHECK (machine_file IS NULL OR JSONB_TYPEOF(machine_file) = 'object') NOT VALID;
ALTER TABLE public.voice_profiles
  ADD CONSTRAINT chk_voice_profiles_analysis_object
    CHECK (analysis IS NULL OR JSONB_TYPEOF(analysis) = 'object') NOT VALID;
ALTER TABLE public.voice_profiles
  ADD CONSTRAINT voice_profiles_provider_check
    CHECK (provider IN ('anthropic','deepseek','openai'));

UPDATE public.subscriptions
SET status = CASE
      WHEN status IN ('grace','paused') THEN 'past_due'
      WHEN status NOT IN ('trial','active','past_due','canceled','expired') THEN 'expired'
      ELSE status
    END,
    plan_interval = CASE
      WHEN plan_interval IN ('monthly','annual') THEN plan_interval
      WHEN plan_interval IS NULL THEN NULL
      ELSE 'monthly'
    END;

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_status_check
    CHECK (status IN ('trial','active','past_due','canceled','expired'));
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_plan_interval_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_plan_interval_check
    CHECK (plan_interval IN ('monthly','annual'));
ALTER TABLE public.subscriptions
  DROP COLUMN IF EXISTS price_id,
  DROP COLUMN IF EXISTS quantity,
  DROP COLUMN IF EXISTS grace_ends_at,
  DROP COLUMN IF EXISTS canceled_at,
  DROP COLUMN IF EXISTS latest_invoice_id,
  DROP COLUMN IF EXISTS last_reconciled_at;
ALTER TABLE public.usage_tracking DROP COLUMN IF EXISTS updated_at;
DROP INDEX IF EXISTS public.idx_subscriptions_customer;
DROP INDEX IF EXISTS public.idx_subscriptions_external;
DROP INDEX IF EXISTS public.idx_subscriptions_status_end;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS trg_new_user_subscription ON auth.users;
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.subscriptions(user_id, status, trial_ends_at)
  VALUES (NEW.id, 'trial', now() + INTERVAL '7 days')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_new_user_subscription
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DROP FUNCTION IF EXISTS public.check_and_increment_usage(UUID);
CREATE FUNCTION public.check_and_increment_usage(p_user_id UUID)
RETURNS TABLE (allowed BOOLEAN, current_count INTEGER, day_limit INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status TEXT;
  v_trial_ends_at TIMESTAMPTZ;
  v_limit INTEGER;
  v_count INTEGER;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR (SELECT auth.uid()) <> p_user_id THEN
    RAISE EXCEPTION 'Not authorized for this user' USING ERRCODE = '42501';
  END IF;

  SELECT status, trial_ends_at
  INTO v_status, v_trial_ends_at
  FROM public.subscriptions
  WHERE user_id = p_user_id;

  IF v_status = 'active' THEN
    v_limit := 50;
  ELSIF v_status = 'trial'
    AND v_trial_ends_at IS NOT NULL
    AND v_trial_ends_at > now() THEN
    v_limit := 5;
  ELSE
    v_limit := 0;
  END IF;

  INSERT INTO public.usage_tracking(user_id, request_date, request_count)
  VALUES (p_user_id, current_date, 0)
  ON CONFLICT (user_id, request_date) DO NOTHING;

  SELECT request_count
  INTO v_count
  FROM public.usage_tracking
  WHERE user_id = p_user_id AND request_date = current_date
  FOR UPDATE;

  IF v_count >= v_limit THEN
    RETURN QUERY SELECT false, v_count, v_limit;
    RETURN;
  END IF;

  UPDATE public.usage_tracking
  SET request_count = request_count + 1
  WHERE user_id = p_user_id AND request_date = current_date;

  RETURN QUERY SELECT true, v_count + 1, v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.check_and_increment_usage(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_and_increment_usage(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_and_increment_usage(UUID) TO authenticated;

COMMIT;
