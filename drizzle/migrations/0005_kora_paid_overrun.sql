-- A3: persist complete overrun estimates without writing usage or releasing reservations.
-- Apply only after 0004; test on isolated PostgreSQL before any main database migration.
CREATE OR REPLACE FUNCTION public.kora_paid_overrun(p_id text, p_lines jsonb)
RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
SET lock_timeout = '3s'
SET statement_timeout = '30s'
AS $$
DECLARE
  v_attempt jsonb;
  v_settings jsonb;
  v_line jsonb;
  v_total numeric := 0;
  v_estimate numeric;
  v_idx integer := 0;
BEGIN
  IF p_id IS NULL OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'invalid overrun payload';
  END IF;
  SELECT data INTO STRICT v_settings FROM public.kora_settings
   WHERE workspace_id = 'kora' FOR UPDATE;
  SELECT data INTO STRICT v_attempt FROM public.kora_records
   WHERE collection = 'paid_attempts' AND id = p_id FOR UPDATE;
  IF v_attempt->>'workspaceId' IS DISTINCT FROM 'kora' THEN
    RAISE EXCEPTION 'workspace mismatch';
  END IF;
  v_estimate := (v_attempt->>'estimateEur')::numeric;
  IF v_estimate IS NULL OR v_estimate <= 0 THEN
    RAISE EXCEPTION 'invalid reserve';
  END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF jsonb_typeof(v_line) IS DISTINCT FROM 'object'
      OR v_line->>'id' IS DISTINCT FROM p_id || ':line:' || v_idx::text
      OR v_line->>'kind' IS NULL OR v_line->>'label' IS NULL
      OR v_line->>'at' IS NULL
      OR jsonb_typeof(v_line->'units') IS DISTINCT FROM 'number'
      OR jsonb_typeof(v_line->'costEur') IS DISTINCT FROM 'number'
      OR (v_line->>'units')::numeric < 0
      OR (v_line->>'costEur')::numeric < 0
      OR round((v_line->>'costEur')::numeric, 4) <> (v_line->>'costEur')::numeric THEN
      RAISE EXCEPTION 'invalid overrun usage line';
    END IF;
    v_total := v_total + (v_line->>'costEur')::numeric;
    v_idx := v_idx + 1;
  END LOOP;
  IF v_total <= v_estimate THEN
    RAISE EXCEPTION 'not an overrun';
  END IF;
  IF v_attempt->>'status' = 'unknown'
     AND v_attempt->>'failureCode' = 'estimated_overrun'
     AND v_attempt->'estimatedUsageLines' = p_lines
     AND (v_attempt->>'estimatedCostEur')::numeric = v_total THEN
    RETURN true;
  END IF;
  IF v_attempt->>'status' <> 'in_flight' THEN
    RAISE EXCEPTION 'invalid overrun transition or conflicting replay';
  END IF;
  IF (v_settings->>'reservedEur')::numeric < v_estimate THEN
    RAISE EXCEPTION 'reserve missing';
  END IF;
  UPDATE public.kora_records
     SET data = data || jsonb_build_object(
       'status','unknown', 'billingStatus','unknown',
       'failureCode','estimated_overrun',
       'estimatedUsageLines',p_lines,
       'estimatedCostEur',v_total,
       'estimatedOverrunEur',v_total-v_estimate
     ), updated_at = clock_timestamp()
   WHERE collection='paid_attempts' AND id=p_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.kora_paid_overrun(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kora_paid_overrun(text,jsonb) TO service_role;
