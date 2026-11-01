-- A3 review follow-up: strict 4-decimal reservations and immutable unknown reasons.
-- Deliberate additive migration: do not edit previously applied 0002/0005.
-- Apply after 0005; test against an isolated database before any production migration.
-- Existing amounts and attempts are not modified by this definition-only change.

CREATE OR REPLACE FUNCTION public.kora_paid_reserve(p_attempt jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_settings jsonb;
  v_month text := p_attempt->>'month';
  v_id text := p_attempt->>'id';
  v_estimate numeric := (p_attempt->>'estimateEur')::numeric;
  v_reserved numeric;
  v_spent numeric;
  v_limit numeric;
  v_suspending boolean;
BEGIN
  IF v_id IS NULL OR length(v_id) < 5 OR v_month !~ '^[0-9]{4}-[0-9]{2}$'
     OR jsonb_typeof(p_attempt->'estimateEur') IS DISTINCT FROM 'number'
     OR v_estimate IS NULL OR v_estimate <= 0 OR v_estimate > 100000
     OR round(v_estimate, 4) <> v_estimate THEN
    RAISE EXCEPTION 'invalid paid attempt';
  END IF;
  SELECT data INTO STRICT v_settings FROM public.kora_settings
   WHERE workspace_id = 'kora' FOR UPDATE;
  v_reserved := COALESCE((v_settings->>'reservedEur')::numeric, 0);
  v_limit := (v_settings->'quotaLimits'->>'api_budget_eur')::numeric;
  IF v_reserved < 0 OR v_limit IS NULL OR v_limit < 0 THEN
    RAISE EXCEPTION 'invalid budget configuration';
  END IF;
  SELECT COALESCE(SUM((r.data->>'costEur')::numeric), 0) INTO v_spent
    FROM public.kora_records r
   WHERE r.collection = 'usage' AND left(r.data->>'at', 7) = v_month;

  IF ((v_settings->>'paidCallsSuspended')::boolean IS TRUE
      AND v_settings->>'suspendedMonth' = v_month)
      OR v_spent + v_reserved + v_estimate > v_limit + 0.000000001 THEN
    v_suspending := NOT (
      COALESCE((v_settings->>'paidCallsSuspended')::boolean, FALSE)
      AND v_settings->>'suspendedMonth' = v_month
    );
    IF v_suspending THEN
      UPDATE public.kora_settings
         SET data = jsonb_set(
           jsonb_set(v_settings, '{paidCallsSuspended}', 'true'::jsonb),
           '{suspendedMonth}', to_jsonb(v_month)
         ), updated_at = clock_timestamp()
       WHERE workspace_id = 'kora';
    END IF;
    RETURN jsonb_build_object('ok', false, 'suspending', v_suspending,
      'reason', 'Plafond budgétaire API atteint : appels payants suspendus.');
  END IF;

  -- This insert and the budget update are a single PostgreSQL transaction.
  INSERT INTO public.kora_records(collection, id, data)
    VALUES ('paid_attempts', v_id, p_attempt || jsonb_build_object(
      'status', 'reserved', 'billingStatus', 'not_sent', 'usageLines', '[]'::jsonb
    ));
  UPDATE public.kora_settings
     SET data = jsonb_set(v_settings, '{reservedEur}', to_jsonb(round(v_reserved + v_estimate, 4))),
         updated_at = clock_timestamp()
   WHERE workspace_id = 'kora';
  RETURN jsonb_build_object('ok', true);
END;
$$;


CREATE OR REPLACE FUNCTION public.kora_paid_unknown(p_id text, p_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
  v_attempt jsonb;
BEGIN
  IF p_code NOT IN ('provider_or_callback_error', 'persist_error') THEN
    RAISE EXCEPTION 'invalid error code';
  END IF;
  SELECT data INTO STRICT v_attempt FROM public.kora_records
    WHERE collection = 'paid_attempts' AND id = p_id FOR UPDATE;
  IF v_attempt->>'status' = 'unknown' THEN
    IF v_attempt->>'failureCode' = p_code THEN RETURN true; END IF;
    RAISE EXCEPTION 'conflicting unknown-state replay';
  END IF;
  IF v_attempt->>'status' IS DISTINCT FROM 'in_flight' THEN
    RAISE EXCEPTION 'paid attempt not in flight';
  END IF;
  UPDATE public.kora_records
     SET data = data || jsonb_build_object(
       'status', 'unknown', 'billingStatus', 'unknown', 'failureCode', p_code
     ), updated_at = clock_timestamp()
   WHERE collection = 'paid_attempts' AND id = p_id
     AND data->>'status' = 'in_flight';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'paid attempt not in flight';
  END IF;
  RETURN true;
END;
$$;


REVOKE ALL ON FUNCTION public.kora_paid_reserve(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kora_paid_unknown(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kora_paid_reserve(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.kora_paid_unknown(text,text) TO service_role;
