-- A4.3.4: close a cross-ledger escape in kora_paid_finish.
-- Replaces only the existing 0011 function body, preserving signature and ACLs.
-- Apply in a single transaction after 0011; production data are not rewritten.
-- A4.3.2 DBA recovery intentionally remains the sole path that both archives
-- and closes a linked reserved generation, atomically.
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
  IF p_status IS NULL OR p_status NOT IN ('settled', 'not_sent')
     OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_lines) > 2000 THEN
    RAISE EXCEPTION 'invalid paid finish';
  END IF;
  SELECT data INTO STRICT v_settings FROM public.kora_settings
   WHERE workspace_id = 'kora' FOR UPDATE;
  SELECT data INTO STRICT v_attempt FROM public.kora_records
   WHERE collection = 'paid_attempts' AND id = p_id FOR UPDATE;
  -- A4.3.4: settings row is locked first (same as kora_paid_reserve).
  -- A concurrent A4 reservation cannot pass this check between budget release
  -- and commit: it must acquire this settings lock before inserting its claim.
  IF p_status = 'not_sent' AND EXISTS (
    SELECT 1 FROM public.kora_article_generations
    WHERE attempt_id = p_id
  ) THEN
    RAISE EXCEPTION 'durable article generation owns paid attempt: DBA recovery required';
  END IF;
  IF v_attempt->>'status' = p_status THEN
    IF COALESCE(v_attempt->'usageLines','[]'::jsonb) <> p_lines THEN
      RAISE EXCEPTION 'paid attempt replay payload differs';
    END IF;
    RETURN true; -- Idempotent replay, no second usage insertion or release.
  END IF;
  IF (p_status = 'settled' AND v_attempt->>'status' IS DISTINCT FROM 'in_flight')
     OR (p_status = 'not_sent' AND v_attempt->>'status' IS DISTINCT FROM 'reserved') THEN
    RAISE EXCEPTION 'invalid paid attempt transition';
  END IF;
  IF p_status = 'not_sent' AND jsonb_array_length(p_lines) <> 0 THEN
    RAISE EXCEPTION 'unsent attempt cannot have usage';
  END IF;
  IF p_status='settled' AND jsonb_array_length(p_lines)=0 THEN
    RAISE EXCEPTION 'settled attempt requires measured usage';
  END IF;
  v_estimate := (v_attempt->>'estimateEur')::numeric;
  v_reserved := COALESCE((v_settings->>'reservedEur')::numeric, 0);
  IF v_attempt->>'workspaceId' IS DISTINCT FROM 'kora' OR v_estimate IS NULL
     OR v_estimate <= 0 OR v_reserved < v_estimate THEN
    RAISE EXCEPTION 'invalid paid accounting state';
  END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    PERFORM public.kora_paid_check_usage(v_line,p_id,v_idx,v_attempt->>'month');
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
-- Preserve least privilege even if the migration tool differs from the CI setup.
ALTER FUNCTION public.kora_paid_finish(text,jsonb,text) OWNER TO postgres;
ALTER FUNCTION public.kora_paid_finish(text,jsonb,text) SECURITY DEFINER;
ALTER FUNCTION public.kora_paid_finish(text,jsonb,text) SET search_path = '';
ALTER FUNCTION public.kora_paid_finish(text,jsonb,text) SET lock_timeout = '3s';
ALTER FUNCTION public.kora_paid_finish(text,jsonb,text) SET statement_timeout = '15s';
REVOKE ALL ON FUNCTION public.kora_paid_finish(text,jsonb,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kora_paid_finish(text,jsonb,text) TO service_role;
