-- Manual rollback for 20260902000000_rate_limits_trial_once.sql.
BEGIN;

DROP FUNCTION IF EXISTS public.check_rate_limit(TEXT, INTEGER, INTEGER);
DROP TABLE IF EXISTS public.rate_limits;
DROP TABLE IF EXISTS public.trial_identities;

ALTER TABLE public.error_reports DROP CONSTRAINT IF EXISTS error_reports_error_code_check;
ALTER TABLE public.error_reports
  ADD CONSTRAINT error_reports_error_code_check
  CHECK (error_code ~ '^VE-[A-Z0-9_]{2,40}$');

-- Restore trial-always bootstrap from 20260731000000.
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

COMMIT;
