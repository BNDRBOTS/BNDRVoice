-- ══════════════════════════════════════════════════════════════
-- BNDR VoiceEngine — Supabase Schema
-- Run in: Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════════════════

-- ── Extensions ────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Raw-SQL tables are not automatically exposed to authenticated callers.
GRANT USAGE ON SCHEMA public TO authenticated;

-- ── Shared updated_at trigger ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- TABLE: subscriptions
-- Written exclusively by the stripe-webhook edge function
-- (service role key, bypasses RLS). Users may only SELECT.
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                      UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                 UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT,
  -- status: trial | active | past_due | canceled | expired
  status                  TEXT        NOT NULL DEFAULT 'trial'
                            CHECK (status IN ('trial','active','past_due','canceled','expired')),
  plan_interval           TEXT        CHECK (plan_interval IN ('monthly','annual')),
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  cancel_at_period_end    BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Trial window: 7 days from account creation
  trial_ends_at           TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_subscriptions_user_id UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer
  ON public.subscriptions (stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub
  ON public.subscriptions (stripe_subscription_id);

DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can read their own subscription; no client writes
DROP POLICY IF EXISTS "sub_select_own" ON public.subscriptions;
CREATE POLICY "sub_select_own"
  ON public.subscriptions FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON TABLE public.subscriptions FROM anon;
REVOKE ALL ON TABLE public.subscriptions FROM authenticated;
GRANT SELECT ON TABLE public.subscriptions TO authenticated;

-- ── Auto-create trial row on new user signup ──────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, status, trial_ends_at)
  VALUES (NEW.id, 'trial', NOW() + INTERVAL '7 days')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_new_user_subscription ON auth.users;
CREATE TRIGGER trg_new_user_subscription
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ══════════════════════════════════════════════════════════════
-- TABLE: usage_tracking
-- Written by the check_and_increment_usage RPC (SECURITY DEFINER).
-- Users may only SELECT their own rows.
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.usage_tracking (
  id             UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_date   DATE    NOT NULL DEFAULT CURRENT_DATE,
  request_count  INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT uq_usage_user_date UNIQUE (user_id, request_date),
  CONSTRAINT chk_request_count_non_negative CHECK (request_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_usage_user_date
  ON public.usage_tracking (user_id, request_date);

ALTER TABLE public.usage_tracking ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "usage_select_own" ON public.usage_tracking;
CREATE POLICY "usage_select_own"
  ON public.usage_tracking FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON TABLE public.usage_tracking FROM anon;
REVOKE ALL ON TABLE public.usage_tracking FROM authenticated;
GRANT SELECT ON TABLE public.usage_tracking TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- TABLE: voice_profiles
-- Full CRUD for authenticated users, scoped to their own rows.
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.voice_profiles (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  machine_file    JSONB,
  analysis        JSONB,
  -- First 500 chars of the writing sample, stored for reference
  sample_preview  TEXT,
  -- Which AI provider was used: anthropic | deepseek | openai
  provider        TEXT        NOT NULL DEFAULT 'anthropic'
                    CHECK (provider IN ('anthropic','deepseek','openai')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent duplicate profile names per user (supports upsert)
  CONSTRAINT uq_voice_profiles_user_name UNIQUE (user_id, name)
);

-- Apply validation to all new/changed rows without making a repeatable setup
-- fail if a legacy row needs cleanup first.
ALTER TABLE public.voice_profiles
  DROP CONSTRAINT IF EXISTS chk_voice_profiles_name;
ALTER TABLE public.voice_profiles
  ADD CONSTRAINT chk_voice_profiles_name
  CHECK (CHAR_LENGTH(BTRIM(name)) BETWEEN 1 AND 120) NOT VALID;

ALTER TABLE public.voice_profiles
  DROP CONSTRAINT IF EXISTS chk_voice_profiles_preview;
ALTER TABLE public.voice_profiles
  ADD CONSTRAINT chk_voice_profiles_preview
  CHECK (sample_preview IS NULL OR CHAR_LENGTH(sample_preview) <= 500) NOT VALID;

ALTER TABLE public.voice_profiles
  DROP CONSTRAINT IF EXISTS chk_voice_profiles_machine_object;
ALTER TABLE public.voice_profiles
  ADD CONSTRAINT chk_voice_profiles_machine_object
  CHECK (machine_file IS NULL OR JSONB_TYPEOF(machine_file) = 'object') NOT VALID;

ALTER TABLE public.voice_profiles
  DROP CONSTRAINT IF EXISTS chk_voice_profiles_analysis_object;
ALTER TABLE public.voice_profiles
  ADD CONSTRAINT chk_voice_profiles_analysis_object
  CHECK (analysis IS NULL OR JSONB_TYPEOF(analysis) = 'object') NOT VALID;

CREATE INDEX IF NOT EXISTS idx_voice_profiles_user_updated
  ON public.voice_profiles (user_id, updated_at DESC);

DROP TRIGGER IF EXISTS trg_voice_profiles_updated_at ON public.voice_profiles;
CREATE TRIGGER trg_voice_profiles_updated_at
  BEFORE UPDATE ON public.voice_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.voice_profiles ENABLE ROW LEVEL SECURITY;

-- Users manage only their own profiles
DROP POLICY IF EXISTS "profiles_all_own" ON public.voice_profiles;
CREATE POLICY "profiles_all_own"
  ON public.voice_profiles FOR ALL
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

REVOKE ALL ON TABLE public.voice_profiles FROM anon;
REVOKE ALL ON TABLE public.voice_profiles FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.voice_profiles TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- RPC: check_and_increment_usage
-- Returns: allowed BOOLEAN, current_count INT, day_limit INT
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.check_and_increment_usage(p_user_id UUID)
RETURNS TABLE (allowed BOOLEAN, current_count INTEGER, day_limit INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status        TEXT;
  v_trial_ends_at TIMESTAMPTZ;
  v_limit         INTEGER;
  v_count         INTEGER;
BEGIN
  -- SECURITY DEFINER bypasses RLS. Bind the requested row owner to
  -- the authenticated caller before reading or mutating anything.
  IF (SELECT auth.uid()) IS NULL OR (SELECT auth.uid()) <> p_user_id THEN
    RAISE EXCEPTION 'Not authorized for this user'
      USING ERRCODE = '42501';
  END IF;

  -- Resolve subscription tier
  SELECT s.status, s.trial_ends_at
  INTO   v_status, v_trial_ends_at
  FROM   public.subscriptions s
  WHERE  s.user_id = p_user_id;

  -- Determine daily limit based on plan
  IF v_status = 'active' THEN
    v_limit := 50;
  ELSIF v_status = 'trial' AND v_trial_ends_at IS NOT NULL AND v_trial_ends_at > NOW() THEN
    v_limit := 5;
  ELSE
    -- No subscription row, expired trial, canceled, past_due, or unknown status
    v_limit := 0;
  END IF;

  -- Ensure today's row exists (INSERT OR IGNORE pattern)
  INSERT INTO public.usage_tracking (user_id, request_date, request_count)
  VALUES (p_user_id, CURRENT_DATE, 0)
  ON CONFLICT (user_id, request_date) DO NOTHING;

  -- Lock the row with FOR UPDATE to prevent TOCTOU race between concurrent calls.
  -- Two simultaneous requests at count=4/limit=5 cannot both see count=4 and both
  -- increment — the second SELECT blocks until the first transaction commits.
  SELECT ut.request_count
  INTO   v_count
  FROM   public.usage_tracking ut
  WHERE  ut.user_id = p_user_id
    AND  ut.request_date = CURRENT_DATE
  FOR UPDATE;

  -- Block if limit reached
  IF v_count >= v_limit THEN
    RETURN QUERY SELECT FALSE, v_count, v_limit;
    RETURN;
  END IF;

  -- Increment atomically within the row lock
  UPDATE public.usage_tracking
  SET    request_count = request_count + 1
  WHERE  user_id = p_user_id
    AND  request_date = CURRENT_DATE;

  RETURN QUERY SELECT TRUE, v_count + 1, v_limit;
END;
$$;

-- Grant execute to authenticated users only
REVOKE ALL ON FUNCTION public.check_and_increment_usage(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_and_increment_usage(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.check_and_increment_usage(UUID) TO authenticated;
