-- A4.3.4 positive/negative regression, isolated PostgreSQL; all rows rolled back.
BEGIN;
INSERT INTO public.kora_settings(workspace_id,data)
VALUES ('kora','{"workspaceId":"kora","quotaLimits":{"api_budget_eur":1},"reservedEur":0,"paidCallsSuspended":false,"notifiedAlerts":[],"storageBaseGb":0}'::jsonb);
INSERT INTO public.kora_records(collection,id,data)
VALUES ('signals','a434-fixed-signal',
  '{"id":"a434-fixed-signal","status":"nouveau","articleId":null}'::jsonb);
SET LOCAL ROLE service_role;
DO $$
DECLARE
  v_signal jsonb := '{"id":"a434-fixed-signal","status":"nouveau","articleId":null}'::jsonb;
  v_attempt jsonb := '{"id":"a434-fixed-attempt","workspaceId":"kora","month":"2026-11","kind":"generation_article","estimateEur":0.01,"units":1,"label":"A4.3.4 linked attempt fixture","createdAt":"2026-11-03T00:00:00Z"}'::jsonb;
  v_free_attempt jsonb := '{"id":"a434-free-attempt","workspaceId":"kora","month":"2026-11","kind":"generation_summary","estimateEur":0.02,"units":1,"label":"A4.3.4 standalone attempt fixture","createdAt":"2026-11-03T00:00:00Z"}'::jsonb;
  v_http_id text := repeat('6',64);
  v_token uuid := 'a4340000-0000-4000-8000-000000000002';
  v_response jsonb;
  v_denied boolean := false;
BEGIN
  v_response := public.kora_http_idempotency_begin(v_http_id,'kora','a434-actor',
    'POST /articles',repeat('7',64));
  IF v_response->>'kind' IS DISTINCT FROM 'claimed' THEN
    RAISE EXCEPTION 'A4.3.4 HTTP setup failed'; END IF;
  v_response := public.kora_article_generation_reserve_linked(
    v_token,v_signal,v_attempt,v_http_id);
  IF v_response->>'ok' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'A4.3.4 linked reserve failed: %',v_response; END IF;

  -- Direct paid closure cannot silently reduce the budget while A4 still owns it.
  BEGIN
    PERFORM public.kora_paid_finish('a434-fixed-attempt','[]'::jsonb,'not_sent');
  EXCEPTION WHEN raise_exception THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'A4.3.4 UNPROTECTED: linked paid closure succeeded'; END IF;
  IF (SELECT data->>'status' FROM public.kora_records
      WHERE collection='paid_attempts' AND id='a434-fixed-attempt') IS DISTINCT FROM 'reserved'
    OR (SELECT state FROM public.kora_article_generations
      WHERE signal_id='a434-fixed-signal') IS DISTINCT FROM 'reserved'
    OR (SELECT data->>'state' FROM public.kora_records
      WHERE collection='http_idempotency' AND id=v_http_id) IS DISTINCT FROM 'pending'
    OR (SELECT (data->>'reservedEur')::numeric FROM public.kora_settings
      WHERE workspace_id='kora') IS DISTINCT FROM 0.01
    OR EXISTS (SELECT 1 FROM public.kora_records
      WHERE collection='usage' AND id LIKE 'a434-fixed-attempt%')
  THEN RAISE EXCEPTION 'A4.3.4 denied transition changed financial or A4/HTTP state'; END IF;
  RAISE NOTICE 'PASS: A4.3.4 linked A4 ownership blocks direct A3 release; financial, A4, HTTP state unchanged';

  -- Standalone paid work must remain closable through the same legitimate RPC.
  v_response := public.kora_paid_reserve(v_free_attempt);
  IF v_response->>'ok' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'A4.3.4 ordinary reservation failed'; END IF;
  PERFORM public.kora_paid_finish('a434-free-attempt','[]'::jsonb,'not_sent');
  PERFORM public.kora_paid_finish('a434-free-attempt','[]'::jsonb,'not_sent');
  IF (SELECT data->>'status' FROM public.kora_records
      WHERE collection='paid_attempts' AND id='a434-free-attempt') IS DISTINCT FROM 'not_sent'
    OR (SELECT (data->>'reservedEur')::numeric FROM public.kora_settings
      WHERE workspace_id='kora') IS DISTINCT FROM 0.01
  THEN RAISE EXCEPTION 'A4.3.4 ordinary paid flow broken'; END IF;
  RAISE NOTICE 'PASS: A4.3.4 unlinked reserved attempts retain legitimate not_sent finalization';
END $$;
RESET ROLE;

-- DBA path must atomically archive, release and remove linked A4 ownership.
DO $$
DECLARE
  v_evidence jsonb := jsonb_build_object(
    'source','runtime_process_audit',
    'reference','A434-ISOLATED-CLOSURE',
    'operator','a434-test-dba',
    'sha256',repeat('8',64),
    'checkedAt','2026-11-03T00:00:00Z'
  );
BEGIN
  PERFORM public.kora_article_generation_admin_close_not_sent(
    'a434-fixed-signal',repeat('6',64),v_evidence);
  IF EXISTS (SELECT 1 FROM public.kora_article_generations
      WHERE signal_id='a434-fixed-signal')
    OR NOT EXISTS (SELECT 1 FROM public.kora_article_generation_recoveries
      WHERE signal_id='a434-fixed-signal' AND resolution='not_sent')
    OR (SELECT data->>'status' FROM public.kora_records
      WHERE collection='paid_attempts' AND id='a434-fixed-attempt') IS DISTINCT FROM 'not_sent'
    OR (SELECT data->>'state' FROM public.kora_records
      WHERE collection='http_idempotency' AND id=repeat('6',64)) IS DISTINCT FROM 'closed_not_sent'
    OR (SELECT (data->>'reservedEur')::numeric FROM public.kora_settings
      WHERE workspace_id='kora') IS DISTINCT FROM 0::numeric
  THEN RAISE EXCEPTION 'A4.3.4 privileged administrative closure inconsistent'; END IF;
  RAISE NOTICE 'PASS: A4.3.4 DBA recovery remains the only audited release of linked A4 reserve';
END $$;
ROLLBACK;
