-- A3 / P1-11 (partial): atomic, durable accounting attempts.
-- Only the server-side service role may execute these RPC functions.
-- IMPORTANT: deploy on a disposable PostgreSQL environment and test before promoting.
-- Historical reservedEur is preserved; never reset it here.

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
  IF v_id IS NULL OR length(v_id) < 5 OR v_month !~ '^\\d{4}-\\d{2}$'
     OR v_estimate IS NULL OR v_estimate <= 0 OR v_estimate > 100000 THEN
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

CREATE OR REPLACE FUNCTION public.kora_paid_start(p_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.kora_records
     SET data = data || jsonb_build_object(
       'status', 'in_flight', 'billingStatus', 'unknown',
       'startedAt', clock_timestamp()
     ), updated_at = clock_timestamp()
   WHERE collection = 'paid_attempts' AND id = p_id
     AND data->>'status' = 'reserved';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'paid attempt not reserved';
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.kora_paid_unknown(p_id text, p_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE v_count integer;
BEGIN
  IF p_code NOT IN ('provider_or_callback_error', 'persist_error') THEN
    RAISE EXCEPTION 'invalid error code';
  END IF;
  UPDATE public.kora_records
     SET data = data || jsonb_build_object(
       'status', 'unknown', 'billingStatus', 'unknown', 'failureCode', p_code
     ), updated_at = clock_timestamp()
   WHERE collection = 'paid_attempts' AND id = p_id
     AND data->>'status' IN ('in_flight', 'unknown');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'paid attempt not in flight';
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.kora_paid_finish(p_id text, p_lines jsonb, p_status text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_settings jsonb;
  v_attempt jsonb;
  v_line jsonb;
  v_line_cost numeric;
  v_total numeric := 0;
  v_estimate numeric;
  v_reserved numeric;
  v_idx integer := 0;
BEGIN
  IF p_status NOT IN ('settled', 'not_sent') OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'invalid paid finish';
  END IF;
  SELECT data INTO STRICT v_settings FROM public.kora_settings
   WHERE workspace_id = 'kora' FOR UPDATE;
  SELECT data INTO STRICT v_attempt FROM public.kora_records
   WHERE collection = 'paid_attempts' AND id = p_id FOR UPDATE;
  IF v_attempt->>'status' = p_status THEN
    IF COALESCE(v_attempt->'usageLines','[]'::jsonb) <> p_lines THEN
      RAISE EXCEPTION 'paid attempt replay payload differs';
    END IF;
    RETURN true; -- Idempotent replay, no second usage insertion or release.
  END IF;
  IF (p_status = 'settled' AND v_attempt->>'status' <> 'in_flight')
     OR (p_status = 'not_sent' AND v_attempt->>'status' NOT IN ('reserved','in_flight')) THEN
    RAISE EXCEPTION 'invalid paid attempt transition';
  END IF;
  IF p_status = 'not_sent' AND jsonb_array_length(p_lines) <> 0 THEN
    RAISE EXCEPTION 'unsent attempt cannot have usage';
  END IF;
  v_estimate := (v_attempt->>'estimateEur')::numeric;
  v_reserved := COALESCE((v_settings->>'reservedEur')::numeric, 0);
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF jsonb_typeof(v_line) <> 'object'
       OR v_line->>'id' <> p_id || ':line:' || v_idx::text
       OR (v_line->>'units')::numeric < 0 THEN
      RAISE EXCEPTION 'invalid usage line';
    END IF;
    v_line_cost := (v_line->>'costEur')::numeric;
    IF v_line_cost IS NULL OR v_line_cost < 0 THEN
      RAISE EXCEPTION 'invalid usage cost';
    END IF;
    v_total := v_total + v_line_cost;
    INSERT INTO public.kora_records(collection,id,data)
      VALUES ('usage', v_line->>'id', v_line);
    v_idx := v_idx + 1;
  END LOOP;
  IF v_total > v_estimate + 0.000000001 THEN
    RAISE EXCEPTION 'usage exceeds reserved estimate';
  END IF;
  IF v_reserved + 0.000000001 < v_estimate THEN
    RAISE EXCEPTION 'reserved budget below attempt amount';
  END IF;
  UPDATE public.kora_records
     SET data = v_attempt || jsonb_build_object(
       'status', p_status, 'usageLines', p_lines,
       'billingStatus', CASE WHEN p_status = 'not_sent' THEN 'not_charged'
                         ELSE 'estimate_unverified' END,
       'completedAt', clock_timestamp()
     ), updated_at = clock_timestamp()
   WHERE collection = 'paid_attempts' AND id = p_id;
  UPDATE public.kora_settings
     SET data = jsonb_set(v_settings, '{reservedEur}', to_jsonb(round(v_reserved - v_estimate, 4))),
         updated_at = clock_timestamp()
   WHERE workspace_id = 'kora';
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.kora_paid_reserve(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kora_paid_start(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kora_paid_unknown(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kora_paid_finish(text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kora_paid_reserve(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.kora_paid_start(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.kora_paid_unknown(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.kora_paid_finish(text,jsonb,text) TO service_role;
