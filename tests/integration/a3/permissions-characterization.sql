-- A4.3.3 before-fix proof. Run after 0010 and BEFORE 0011, disposable DB only.
BEGIN;
INSERT INTO public.kora_settings(workspace_id,data) VALUES ('kora',
  '{"workspaceId":"kora","quotaLimits":{"api_budget_eur":1},"reservedEur":0,"paidCallsSuspended":false,"notifiedAlerts":[],"storageBaseGb":0}');
SET LOCAL ROLE service_role;
DO $$
DECLARE a jsonb := '{"id":"a433-before","workspaceId":"kora","month":"2026-11","kind":"generation_article","estimateEur":0.01,"units":1,"label":"before fix","createdAt":"2026-11-03T00:00:00Z"}';
BEGIN
  IF NOT has_table_privilege(current_user,'public.kora_records','TRUNCATE')
     OR NOT has_table_privilege(current_user,'public.kora_records','TRIGGER')
  THEN RAISE EXCEPTION 'pre-fix privilege characterization changed'; END IF;
  PERFORM public.kora_paid_reserve(a);
  PERFORM public.kora_paid_start(a->>'id');
  PERFORM public.kora_paid_unknown(a->>'id','persist_error');
  -- NULL bypasses NOT IN checks in the old invoker RPC and releases unknown reserve.
  PERFORM public.kora_paid_finish(a->>'id','[]'::jsonb,NULL);
  IF (SELECT (data->>'reservedEur')::numeric FROM public.kora_settings WHERE workspace_id='kora') <> 0
  THEN RAISE EXCEPTION 'pre-fix NULL settlement behavior changed'; END IF;
  UPDATE public.kora_records SET data=data || '{"status":"reserved"}' WHERE collection='paid_attempts' AND id=a->>'id';
  UPDATE public.kora_settings SET data=data || '{"reservedEur":100}';
  PERFORM public.kora_http_idempotency_begin(repeat('d',64),'kora','before','POST /articles',repeat('e',64));
  DELETE FROM public.kora_records WHERE collection='http_idempotency';
  TRUNCATE public.kora_records;
  RAISE NOTICE 'CHARACTERIZED A4.3.3: direct financial/HTTP writes, TRUNCATE and NULL settlement bypass';
END $$;
RESET ROLE;
ROLLBACK;
