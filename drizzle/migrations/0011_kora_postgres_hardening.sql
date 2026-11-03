-- A4.3.3: protect financial/HTTP state even when service_role has BYPASSRLS.
-- Additive; no existing records, balances or recovery archives are rewritten.
-- Apply as postgres, matching the DBA boundary of 0004/0010.
-- Execute the entire migration in ONE transaction (Drizzle, or psql -1 -f).
DO $$
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'migration requires postgres'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('service_role','anon','authenticated')
      AND (rolsuper OR rolcreaterole))
     OR pg_catalog.pg_has_role('service_role','postgres','MEMBER')
     OR pg_catalog.pg_has_role('anon','postgres','MEMBER')
     OR pg_catalog.pg_has_role('authenticated','postgres','MEMBER')
  THEN RAISE EXCEPTION 'unsafe application role hierarchy'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('kora_records','kora_settings',
      'kora_article_generations','kora_article_generation_recoveries')
      AND pg_catalog.pg_get_userbyid(c.relowner) <> 'postgres')
  THEN RAISE EXCEPTION 'unexpected KORA table owner'; END IF;
END $$;

REVOKE ALL ON public.kora_records, public.kora_settings,
  public.kora_article_generations, public.kora_article_generation_recoveries
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kora_records TO service_role;
GRANT SELECT ON public.kora_settings, public.kora_article_generations TO service_role;
-- RLS alone is insufficient for BYPASSRLS. No configurable GUC or JWT grants trust.
CREATE FUNCTION public.kora_records_write_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_reason text;
BEGIN
  IF current_user = 'postgres' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.collection IS DISTINCT FROM OLD.collection
      OR NEW.id IS DISTINCT FROM OLD.id) THEN
    v_reason := 'record identity is immutable';
  END IF;
  IF (TG_OP <> 'INSERT' AND OLD.collection IN ('paid_attempts','http_idempotency'))
     OR (TG_OP <> 'DELETE' AND NEW.collection IN ('paid_attempts','http_idempotency')) THEN
    v_reason := 'protected state requires a controlled RPC';
  END IF;
  IF TG_OP <> 'INSERT' AND OLD.collection IN ('usage','audit') THEN
    v_reason := 'usage and audit are append only';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.collection='usage' THEN
    IF jsonb_typeof(NEW.data) IS DISTINCT FROM 'object'
       OR jsonb_typeof(NEW.data->'costEur') IS DISTINCT FROM 'number'
       OR (NEW.data->>'costEur')::numeric <> 0
       OR NEW.id LIKE '%:line:%' OR NEW.id LIKE '%:reconcile%'
       OR NEW.data ? 'attemptId'
       OR NEW.data->>'id' IS DISTINCT FROM NEW.id
       OR jsonb_typeof(NEW.data->'units') IS DISTINCT FROM 'number'
       OR (NEW.data->>'units')::numeric < 0
    THEN v_reason := 'paid usage requires a controlled RPC'; END IF;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.collection='audit'
     AND (NEW.id LIKE 'aud_a43_%' OR NEW.data->>'action' IN
       ('article_generation.recovery_not_sent','article_generation.http_recovered')) THEN
    v_reason := 'recovery audit requires DBA';
  END IF;
  IF v_reason IS NOT NULL THEN
    RAISE LOG '%', jsonb_build_object('event','kora.postgres.protected_write_denied',
      'dbRole',current_user,'table',TG_TABLE_NAME,'operation',TG_OP,'sqlstate','42501');
    RAISE EXCEPTION '%',v_reason USING ERRCODE='42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.kora_records_write_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER kora_00_records_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.kora_records
  FOR EACH ROW EXECUTE FUNCTION public.kora_records_write_guard();

-- Safe first boot: a concurrent/late initialization never overwrites existing state.
CREATE FUNCTION public.kora_settings_initialize(p_data jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET lock_timeout = '3s' SET statement_timeout = '15s' AS $$
BEGIN
  IF jsonb_typeof(p_data) IS DISTINCT FROM 'object'
     OR p_data->>'workspaceId' IS DISTINCT FROM 'kora'
     OR jsonb_typeof(p_data->'quotaLimits') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_data->'quotaLimits'->'api_budget_eur') IS DISTINCT FROM 'number'
     OR (p_data->'quotaLimits'->>'api_budget_eur')::numeric < 0
     OR p_data->'reservedEur' IS DISTINCT FROM '0'::jsonb
     OR p_data->'notifiedAlerts' IS DISTINCT FROM '[]'::jsonb
     OR jsonb_typeof(p_data->'storageBaseGb') IS DISTINCT FROM 'number'
     OR (p_data->>'storageBaseGb')::numeric < 0
     OR (p_data ? 'paidCallsSuspended' AND p_data->'paidCallsSuspended' IS DISTINCT FROM 'false'::jsonb)
     OR (p_data ? 'suspendedMonth' AND p_data->'suspendedMonth' IS DISTINCT FROM 'null'::jsonb)
  THEN RAISE EXCEPTION 'invalid initial settings'; END IF;
  -- No bootstrap after an accidental loss of settings with a ledger still present.
  IF NOT EXISTS (SELECT 1 FROM public.kora_settings WHERE workspace_id='kora')
     AND EXISTS (SELECT 1 FROM public.kora_records WHERE collection IN ('paid_attempts','usage'))
  THEN RAISE EXCEPTION 'existing ledger requires DBA investigation'; END IF;
  INSERT INTO public.kora_settings(workspace_id,data) VALUES ('kora',jsonb_build_object(
    'workspaceId','kora','quotaLimits',p_data->'quotaLimits',
    'storageBaseGb',p_data->'storageBaseGb','notifiedAlerts','[]'::jsonb,
    'reservedEur',0,'paidCallsSuspended',false,'suspendedMonth',NULL
  )) ON CONFLICT (workspace_id) DO NOTHING;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.kora_settings_initialize(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kora_settings_initialize(jsonb) TO service_role;

-- SQL validation is required independently of the existing strict Zod caller schema.
CREATE FUNCTION public.kora_paid_check_usage(p_line jsonb,p_id text,p_index integer,p_month text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF jsonb_typeof(p_line) IS DISTINCT FROM 'object'
     OR p_line->>'id' IS DISTINCT FROM p_id || ':line:' || p_index::text
     OR jsonb_typeof(p_line->'id') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_line->'at') IS DISTINCT FROM 'string'
     OR COALESCE(p_line->>'at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
     OR left(p_line->>'at',7) IS DISTINCT FROM p_month
     OR COALESCE(p_line->>'kind','') NOT IN ('generation_article','generation_linkedin',
       'generation_summary','classification','search_query','observation')
     OR jsonb_typeof(p_line->'label') IS DISTINCT FROM 'string'
     OR length(p_line->>'label') NOT BETWEEN 1 AND 500
     OR jsonb_typeof(p_line->'units') IS DISTINCT FROM 'number'
     OR (p_line->>'units')::numeric < 0
     OR jsonb_typeof(p_line->'costEur') IS DISTINCT FROM 'number'
     OR (p_line->>'costEur')::numeric < 0
     OR round((p_line->>'costEur')::numeric,4) <> (p_line->>'costEur')::numeric
     OR (p_line - ARRAY['id','at','kind','units','costEur','label']) <> '{}'::jsonb
  THEN RAISE EXCEPTION 'invalid paid usage line'; END IF;
  PERFORM (p_line->>'at')::timestamptz;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.kora_paid_check_usage(jsonb,text,integer,text)
  FROM PUBLIC,anon,authenticated,service_role;


-- Revalidate raw RPC inputs before promoting the existing accounting routines.
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
  IF jsonb_typeof(p_attempt) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_attempt->'id') IS DISTINCT FROM 'string'
     OR length(v_id) < 5 OR length(v_id) > 200
     OR p_attempt->>'workspaceId' IS DISTINCT FROM 'kora'
     OR v_month IS NULL OR v_month !~ '^\d{4}-(0[1-9]|1[0-2])$'
     OR jsonb_typeof(p_attempt->'createdAt') IS DISTINCT FROM 'string'
     OR COALESCE(p_attempt->>'createdAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
     OR left(p_attempt->>'createdAt',7) IS DISTINCT FROM v_month
     OR COALESCE(p_attempt->>'kind','') NOT IN ('generation_article','generation_linkedin',
       'generation_summary','classification','search_query','observation')
     OR jsonb_typeof(p_attempt->'units') IS DISTINCT FROM 'number'
     OR (p_attempt->>'units')::numeric < 0
     OR jsonb_typeof(p_attempt->'label') IS DISTINCT FROM 'string'
     OR length(p_attempt->>'label') NOT BETWEEN 1 AND 500
     OR jsonb_typeof(p_attempt->'estimateEur') IS DISTINCT FROM 'number'
     OR v_estimate IS NULL OR v_estimate <= 0 OR v_estimate > 100000
     OR round(v_estimate,4) <> v_estimate
     OR (p_attempt - ARRAY['id','workspaceId','month','kind','estimateEur','units','label','createdAt']) <> '{}'::jsonb
  THEN RAISE EXCEPTION 'invalid paid attempt'; END IF;
  PERFORM (p_attempt->>'createdAt')::timestamptz;
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
  IF p_code IS NULL OR p_code NOT IN ('provider_or_callback_error', 'persist_error') THEN
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
     OR jsonb_array_length(p_lines) = 0 OR jsonb_array_length(p_lines) > 2000 THEN
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
    PERFORM public.kora_paid_check_usage(v_line,p_id,v_idx,v_attempt->>'month');
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
  IF v_attempt->>'status' IS DISTINCT FROM 'in_flight' THEN
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

CREATE OR REPLACE FUNCTION public.kora_signal_mutations_commit(p_changes jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_change jsonb;
  v_current jsonb;
  v_found boolean;
  v_collection text;
  v_id text;
  v_before jsonb;
  v_after jsonb;
  v_key text;
  v_keys text[] := ARRAY[]::text[];
  v_signal_id text;
BEGIN
  IF jsonb_typeof(p_changes) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_changes) < 1
     OR jsonb_array_length(p_changes) > 2000 THEN
    RAISE EXCEPTION 'invalid signal transaction size';
  END IF;

  -- Lock all affected rows in a deterministic order, including prospective inserts.
  -- This prevents two A4.2 transactions from racing on an absent record.
  FOR v_key IN
    SELECT DISTINCT (c->>'collection') || ':' || (c->>'id')
    FROM jsonb_array_elements(p_changes) AS c ORDER BY 1
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key, 0));
  END LOOP;
  FOR v_change IN
    SELECT c FROM jsonb_array_elements(p_changes) AS c
    ORDER BY c->>'collection', c->>'id'
  LOOP
    v_collection := v_change->>'collection';
    v_id := v_change->>'id';
    v_before := v_change->'before';
    v_after := v_change->'after';
    IF v_collection NOT IN ('signals','observations','articles','linkedin','newsletters','audit')
       OR COALESCE(v_id,'') = ''
       OR NOT (v_change ? 'before' AND v_change ? 'after')
       OR (v_before IS NOT NULL AND jsonb_typeof(v_before) NOT IN ('object','null'))
       OR (v_after IS NOT NULL AND jsonb_typeof(v_after) NOT IN ('object','null'))
       OR (v_before <> 'null'::jsonb AND v_before->>'id' IS DISTINCT FROM v_id)
       OR (v_after <> 'null'::jsonb AND v_after->>'id' IS DISTINCT FROM v_id)
       OR (v_collection = 'audit' AND (v_before <> 'null'::jsonb OR v_after = 'null'::jsonb
         OR v_id LIKE 'aud_a43_%' OR v_after->>'action' IN
           ('article_generation.recovery_not_sent','article_generation.http_recovered')))
    THEN RAISE EXCEPTION 'invalid signal mutation'; END IF;

    SELECT data INTO v_current FROM public.kora_records
      WHERE collection = v_collection AND id = v_id FOR UPDATE;
    v_found := FOUND;
    IF (v_before = 'null'::jsonb AND v_found)
       OR (v_before <> 'null'::jsonb AND (NOT v_found OR v_current IS DISTINCT FROM v_before))
    THEN RAISE EXCEPTION 'signal transaction state changed'; END IF;

    -- The durable A4 claim is never moved, erased or re-parented by a merge/split.
    -- In-flight generation is also fenced against all signal modifications.
    IF v_collection = 'signals' AND EXISTS (
      SELECT 1 FROM public.kora_article_generations
      WHERE signal_id = v_id
        AND (state <> 'completed' OR v_after = 'null'::jsonb
             OR v_before->>'articleId' IS DISTINCT FROM v_after->>'articleId')
    ) THEN RAISE EXCEPTION 'article generation ownership prevents signal mutation'; END IF;
  END LOOP;

  IF (SELECT count(*) FROM jsonb_array_elements(p_changes)) <>
     (SELECT count(DISTINCT (c->>'collection') || ':' || (c->>'id'))
      FROM jsonb_array_elements(p_changes) AS c)
  THEN RAISE EXCEPTION 'duplicate signal transaction row'; END IF;

  -- One PostgreSQL transaction for all mutations. Any trigger/CAS/constraint error
  -- undoes earlier writes, including the audit row.
  FOR v_change IN
    SELECT c FROM jsonb_array_elements(p_changes) AS c ORDER BY
      CASE
        WHEN c->>'collection' = 'signals' AND c->'before' = 'null'::jsonb THEN 0
        WHEN c->>'collection' = 'observations' THEN 1
        WHEN c->>'collection' = 'articles' THEN 2
        WHEN c->>'collection' = 'linkedin' THEN 3
        WHEN c->>'collection' = 'newsletters' THEN 4
        WHEN c->>'collection' = 'signals' AND c->'after' <> 'null'::jsonb THEN 5
        WHEN c->>'collection' = 'audit' THEN 6
        ELSE 9
      END, c->>'collection', c->>'id'
  LOOP
    v_collection := v_change->>'collection';
    v_id := v_change->>'id';
    v_before := v_change->'before';
    v_after := v_change->'after';
    IF v_before = 'null'::jsonb THEN
      INSERT INTO public.kora_records(collection,id,data)
      VALUES(v_collection,v_id,v_after);
    ELSIF v_after = 'null'::jsonb THEN
      DELETE FROM public.kora_records WHERE collection = v_collection AND id = v_id;
    ELSE
      UPDATE public.kora_records SET data = v_after, updated_at = clock_timestamp()
        WHERE collection = v_collection AND id = v_id;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

-- Only these reviewed, static SQL routines can write the protected collections.
ALTER FUNCTION public.kora_paid_reserve(jsonb) OWNER TO postgres;
ALTER FUNCTION public.kora_paid_reserve(jsonb) SECURITY DEFINER;
ALTER FUNCTION public.kora_paid_reserve(jsonb) SET search_path = '';
ALTER FUNCTION public.kora_paid_reserve(jsonb) SET lock_timeout = '3s';
ALTER FUNCTION public.kora_paid_reserve(jsonb) SET statement_timeout = '15s';
REVOKE ALL ON FUNCTION public.kora_paid_reserve(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kora_paid_reserve(jsonb) TO service_role;
ALTER FUNCTION public.kora_paid_start(text) OWNER TO postgres;
ALTER FUNCTION public.kora_paid_start(text) SECURITY DEFINER;
ALTER FUNCTION public.kora_paid_start(text) SET search_path = '';
ALTER FUNCTION public.kora_paid_start(text) SET lock_timeout = '3s';
ALTER FUNCTION public.kora_paid_start(text) SET statement_timeout = '15s';
REVOKE ALL ON FUNCTION public.kora_paid_start(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kora_paid_start(text) TO service_role;
ALTER FUNCTION public.kora_paid_unknown(text,text) OWNER TO postgres;
ALTER FUNCTION public.kora_paid_unknown(text,text) SECURITY DEFINER;
ALTER FUNCTION public.kora_paid_unknown(text,text) SET search_path = '';
ALTER FUNCTION public.kora_paid_unknown(text,text) SET lock_timeout = '3s';
ALTER FUNCTION public.kora_paid_unknown(text,text) SET statement_timeout = '15s';
REVOKE ALL ON FUNCTION public.kora_paid_unknown(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kora_paid_unknown(text,text) TO service_role;
ALTER FUNCTION public.kora_paid_finish(text,jsonb,text) OWNER TO postgres;
ALTER FUNCTION public.kora_paid_finish(text,jsonb,text) SECURITY DEFINER;
ALTER FUNCTION public.kora_paid_finish(text,jsonb,text) SET search_path = '';
ALTER FUNCTION public.kora_paid_finish(text,jsonb,text) SET lock_timeout = '3s';
ALTER FUNCTION public.kora_paid_finish(text,jsonb,text) SET statement_timeout = '15s';
REVOKE ALL ON FUNCTION public.kora_paid_finish(text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kora_paid_finish(text,jsonb,text) TO service_role;
ALTER FUNCTION public.kora_paid_overrun(text,jsonb) OWNER TO postgres;
ALTER FUNCTION public.kora_paid_overrun(text,jsonb) SECURITY DEFINER;
ALTER FUNCTION public.kora_paid_overrun(text,jsonb) SET search_path = '';
ALTER FUNCTION public.kora_paid_overrun(text,jsonb) SET lock_timeout = '3s';
ALTER FUNCTION public.kora_paid_overrun(text,jsonb) SET statement_timeout = '15s';
REVOKE ALL ON FUNCTION public.kora_paid_overrun(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kora_paid_overrun(text,jsonb) TO service_role;
ALTER FUNCTION public.kora_settings_save(jsonb) OWNER TO postgres;
ALTER FUNCTION public.kora_settings_save(jsonb) SECURITY DEFINER;
ALTER FUNCTION public.kora_settings_save(jsonb) SET search_path = '';
ALTER FUNCTION public.kora_settings_save(jsonb) SET lock_timeout = '3s';
ALTER FUNCTION public.kora_settings_save(jsonb) SET statement_timeout = '15s';
REVOKE ALL ON FUNCTION public.kora_settings_save(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kora_settings_save(jsonb) TO service_role;
ALTER FUNCTION public.kora_http_idempotency_begin(text,text,text,text,text) OWNER TO postgres;
ALTER FUNCTION public.kora_http_idempotency_begin(text,text,text,text,text) SECURITY DEFINER;
ALTER FUNCTION public.kora_http_idempotency_begin(text,text,text,text,text) SET search_path = '';
ALTER FUNCTION public.kora_http_idempotency_begin(text,text,text,text,text) SET lock_timeout = '3s';
ALTER FUNCTION public.kora_http_idempotency_begin(text,text,text,text,text) SET statement_timeout = '15s';
REVOKE ALL ON FUNCTION public.kora_http_idempotency_begin(text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kora_http_idempotency_begin(text,text,text,text,text) TO service_role;
ALTER FUNCTION public.kora_http_idempotency_complete(text,integer,text) OWNER TO postgres;
ALTER FUNCTION public.kora_http_idempotency_complete(text,integer,text) SECURITY DEFINER;
ALTER FUNCTION public.kora_http_idempotency_complete(text,integer,text) SET search_path = '';
ALTER FUNCTION public.kora_http_idempotency_complete(text,integer,text) SET lock_timeout = '3s';
ALTER FUNCTION public.kora_http_idempotency_complete(text,integer,text) SET statement_timeout = '15s';
REVOKE ALL ON FUNCTION public.kora_http_idempotency_complete(text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kora_http_idempotency_complete(text,integer,text) TO service_role;
ALTER FUNCTION public.kora_http_idempotency_uncertain(text) OWNER TO postgres;
ALTER FUNCTION public.kora_http_idempotency_uncertain(text) SECURITY DEFINER;
ALTER FUNCTION public.kora_http_idempotency_uncertain(text) SET search_path = '';
ALTER FUNCTION public.kora_http_idempotency_uncertain(text) SET lock_timeout = '3s';
ALTER FUNCTION public.kora_http_idempotency_uncertain(text) SET statement_timeout = '15s';
REVOKE ALL ON FUNCTION public.kora_http_idempotency_uncertain(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kora_http_idempotency_uncertain(text) TO service_role;
ALTER FUNCTION public.kora_article_generation_reserve(uuid,jsonb,jsonb) SET lock_timeout = '3s';
ALTER FUNCTION public.kora_article_generation_reserve(uuid,jsonb,jsonb) SET statement_timeout = '15s';
ALTER FUNCTION public.kora_article_generation_start(text,uuid,text) SET lock_timeout = '3s';
ALTER FUNCTION public.kora_article_generation_start(text,uuid,text) SET statement_timeout = '15s';
ALTER FUNCTION public.kora_article_generation_complete(text,uuid,jsonb) SET lock_timeout = '3s';
ALTER FUNCTION public.kora_article_generation_complete(text,uuid,jsonb) SET statement_timeout = '15s';
ALTER FUNCTION public.kora_article_generation_uncertain(text,uuid) SET lock_timeout = '3s';
ALTER FUNCTION public.kora_article_generation_uncertain(text,uuid) SET statement_timeout = '15s';
ALTER FUNCTION public.kora_signal_mutations_commit(jsonb) SET lock_timeout = '3s';
ALTER FUNCTION public.kora_signal_mutations_commit(jsonb) SET statement_timeout = '15s';

REVOKE CREATE ON SCHEMA public FROM PUBLIC,anon,authenticated,service_role;
-- Fail deployment if inherited/column privileges would invalidate the boundary.
DO $$
DECLARE r text; t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['service_role','anon','authenticated'] LOOP
    IF has_schema_privilege(r,'public','CREATE') THEN RAISE EXCEPTION 'inherited schema CREATE: %',r; END IF;
    FOREACH t IN ARRAY ARRAY['kora_records','kora_settings','kora_article_generations','kora_article_generation_recoveries'] LOOP
      IF has_table_privilege(r,'public.'||t,'TRUNCATE,TRIGGER,REFERENCES') THEN
        RAISE EXCEPTION 'inherited unsafe table privilege: % %',r,t;
      END IF;
      IF t <> 'kora_records' AND (has_any_column_privilege(r,'public.'||t,'INSERT,UPDATE')
          OR has_table_privilege(r,'public.'||t,'DELETE')) THEN
        RAISE EXCEPTION 'inherited protected write privilege: % %',r,t;
      END IF;
      IF (r <> 'service_role' OR t='kora_article_generation_recoveries')
         AND (has_any_column_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,REFERENCES')
           OR has_table_privilege(r,'public.'||t,'DELETE')) THEN
        RAISE EXCEPTION 'inherited confidential table access: % %',r,t;
      END IF;
    END LOOP;
  END LOOP;
END $$;
