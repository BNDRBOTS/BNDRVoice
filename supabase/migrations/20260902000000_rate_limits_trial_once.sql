-- Rate limits (shared store), trial-once identities, and public error-code shape.
-- Safe after 20260731000000_production_architecture.sql.

CREATE TABLE IF NOT EXISTS public.rate_limits (
  bucket TEXT PRIMARY KEY CHECK (char_length(bucket) BETWEEN 3 AND 300),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  hit_count INTEGER NOT NULL DEFAULT 0 CHECK (hit_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_scope TEXT,
  p_limit INTEGER,
  p_window_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_bucket TEXT;
  v_row public.rate_limits%ROWTYPE;
  v_now TIMESTAMPTZ := timezone('utc', now());
BEGIN
  IF p_scope IS NULL OR char_length(p_scope) < 2 OR p_limit < 1 OR p_window_seconds < 1 THEN
    RETURN FALSE;
  END IF;

  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;
  v_bucket := v_uid::text || ':' || left(p_scope, 80);

  INSERT INTO public.rate_limits(bucket, window_started_at, hit_count)
  VALUES (v_bucket, v_now, 0)
  ON CONFLICT (bucket) DO NOTHING;

  SELECT * INTO v_row FROM public.rate_limits WHERE bucket = v_bucket FOR UPDATE;

  IF v_row.window_started_at <= v_now - make_interval(secs => p_window_seconds) THEN
    UPDATE public.rate_limits
      SET window_started_at = v_now, hit_count = 1, updated_at = v_now
      WHERE bucket = v_bucket;
    RETURN TRUE;
  END IF;

  IF v_row.hit_count >= p_limit THEN
    RETURN FALSE;
  END IF;

  UPDATE public.rate_limits
    SET hit_count = hit_count + 1, updated_at = v_now
    WHERE bucket = v_bucket;
  RETURN TRUE;
END;
$$;

CREATE TABLE IF NOT EXISTS public.trial_identities (
  identity_hash TEXT PRIMARY KEY CHECK (char_length(identity_hash) = 64),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
ALTER TABLE public.trial_identities ENABLE ROW LEVEL SECURITY;

INSERT INTO public.trial_identities(identity_hash)
SELECT encode(digest(lower(u.email), 'sha256'), 'hex')
FROM auth.users u
WHERE u.email IS NOT NULL AND char_length(u.email) > 0
ON CONFLICT (identity_hash) DO NOTHING;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hash TEXT;
  v_inserted TEXT;
BEGIN
  v_hash := encode(
    digest(lower(coalesce(NEW.email, NEW.id::text)), 'sha256'),
    'hex'
  );

  INSERT INTO public.trial_identities(identity_hash)
  VALUES (v_hash)
  ON CONFLICT (identity_hash) DO NOTHING
  RETURNING identity_hash INTO v_inserted;

  IF v_inserted IS NULL THEN
    INSERT INTO public.entitlements(
      user_id, status, product_tier, source, daily_limit, valid_from, valid_until
    )
    VALUES (
      NEW.id, 'expired', 'trial', 'signup', 0,
      timezone('utc', now()), timezone('utc', now())
    )
    ON CONFLICT (user_id) DO NOTHING;
  ELSE
    INSERT INTO public.entitlements(
      user_id, status, product_tier, source, daily_limit, valid_from, valid_until
    )
    VALUES (
      NEW.id, 'trial', 'trial', 'signup', 5,
      timezone('utc', now()), timezone('utc', now()) + INTERVAL '7 days'
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  INSERT INTO public.user_preferences(user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

ALTER TABLE public.error_reports DROP CONSTRAINT IF EXISTS error_reports_error_code_check;
ALTER TABLE public.error_reports
  ADD CONSTRAINT error_reports_error_code_check
  CHECK (
    error_code ~ '^VE-[A-Z0-9_]{2,40}$'
    OR error_code ~ '^[A-Z]{2,12}-[A-Z0-9]{2,16}-[A-F0-9]{4,8}$'
  );

REVOKE ALL ON TABLE public.rate_limits, public.trial_identities
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.rate_limits, public.trial_identities TO service_role;

REVOKE ALL ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER)
  TO authenticated, service_role;
