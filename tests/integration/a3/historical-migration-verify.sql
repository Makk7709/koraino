-- A4.3 historical migration verification on a SECOND disposable database.
-- Run after 0010, 0011 and 0012 have been applied atomically.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
DO $$
DECLARE v_count integer; v_reserved numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='kora_article_generations'
        AND column_name='http_operation_id')
  THEN RAISE EXCEPTION '0010 association column missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc
      WHERE oid='public.kora_paid_finish(text,jsonb,text)'::regprocedure AND prosecdef)
  THEN RAISE EXCEPTION '0012 function not security definer'; END IF;
  IF (SELECT count(*) FROM public.kora_article_generations
      WHERE signal_id IN ('hist43_signal_active','hist43_signal_done')
        AND http_operation_id IS NULL) <> 2
  THEN RAISE EXCEPTION 'historical claims were assigned an unverified HTTP identity'; END IF;
  IF (SELECT count(*) FROM public.kora_article_generation_recoveries) <> 0
  THEN RAISE EXCEPTION 'unexpected recovery archive for historical claims'; END IF;
  IF (SELECT count(*) FROM public.kora_records
      WHERE collection='http_idempotency' AND id=repeat('a',64)
        AND data->>'state'='pending') <> 1
  THEN RAISE EXCEPTION 'historical HTTP pending state changed'; END IF;
  IF (SELECT count(*) FROM public.kora_records
      WHERE collection='paid_attempts' AND id='hist43_attempt_active'
        AND data->>'status'='reserved') <> 1
  THEN RAISE EXCEPTION 'historical paid attempt changed'; END IF;
  IF (SELECT count(*) FROM public.kora_records
      WHERE collection='paid_attempts' AND id='hist43_attempt_done'
        AND data->>'status'='settled') <> 1
  THEN RAISE EXCEPTION 'historical settled state changed'; END IF;
  SELECT (data->>'reservedEur')::numeric INTO STRICT v_reserved FROM public.kora_settings
   WHERE workspace_id='kora';
  IF v_reserved IS DISTINCT FROM 0.03::numeric
    THEN RAISE EXCEPTION 'historical reserved budget changed'; END IF;
  IF (SELECT count(*) FROM public.kora_records
      WHERE collection='usage' AND id='hist43_usage'
        AND (data->>'costEur')::numeric=0.008) <> 1
    OR (SELECT count(*) FROM public.kora_records
      WHERE collection='audit' AND id='hist43_audit') <> 1
    OR (SELECT count(*) FROM public.kora_records
      WHERE collection='articles' AND id='hist43_article_done') <> 1
  THEN RAISE EXCEPTION 'historical usage, audit or article changed'; END IF;
  IF has_table_privilege('service_role','public.kora_records','TRUNCATE')
    OR has_table_privilege('service_role','public.kora_settings','UPDATE')
    OR has_table_privilege('service_role','public.kora_article_generation_recoveries','SELECT')
    OR NOT has_function_privilege('service_role','public.kora_paid_finish(text,jsonb,text)','EXECUTE')
    OR has_function_privilege('service_role',
         'public.kora_article_generation_admin_close_not_sent(text,text,jsonb)','EXECUTE')
  THEN RAISE EXCEPTION 'historical db post-migration ACL boundary invalid'; END IF;
  RAISE NOTICE 'PASS: A4.3 historical claims stay unlinked, disputed HTTP pending, financial/audit state preserved';
END $$;
COMMIT;

-- Any attempt to close the old A4-owned reservation via service_role must fail.
BEGIN;
SET LOCAL ROLE service_role;
DO $$
DECLARE v_rejected boolean := false;
BEGIN
  BEGIN
    PERFORM public.kora_paid_finish('hist43_attempt_active','[]'::jsonb,'not_sent');
  EXCEPTION WHEN raise_exception THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'historical A4-linked budget was released'; END IF;
  RAISE NOTICE 'PASS: A4.3 historical reserved A4 ownership prevents unarchived financial release';
END $$;
RESET ROLE;
ROLLBACK;
