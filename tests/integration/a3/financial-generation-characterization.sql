-- A4.3.4 characterization BEFORE fix 0012, disposable PostgreSQL ONLY.
-- This is a deliberately green proof of an existing unsafe cross-ledger transition.
-- Roll back all fixtures: no persistent data and no paid provider calls.
BEGIN;
INSERT INTO public.kora_settings(workspace_id,data)
VALUES ('kora','{"workspaceId":"kora","quotaLimits":{"api_budget_eur":1},"reservedEur":0,"paidCallsSuspended":false,"notifiedAlerts":[],"storageBaseGb":0}'::jsonb);
INSERT INTO public.kora_records(collection,id,data)
VALUES ('signals','a434-before-signal',
  '{"id":"a434-before-signal","status":"nouveau","articleId":null}'::jsonb);

SET LOCAL ROLE service_role;
DO $$
DECLARE
  v_signal jsonb := '{"id":"a434-before-signal","status":"nouveau","articleId":null}'::jsonb;
  v_attempt jsonb := '{"id":"a434-before-attempt","workspaceId":"kora","month":"2026-11","kind":"generation_article","estimateEur":0.01,"units":1,"label":"A4.3.4 unsafe cross-ledger characterization","createdAt":"2026-11-03T00:00:00Z"}'::jsonb;
  v_http_id text := repeat('4',64);
  v_token uuid := 'a4340000-0000-4000-8000-000000000001';
  v_response jsonb;
BEGIN
  v_response := public.kora_http_idempotency_begin(v_http_id,'kora','a434-actor',
    'POST /articles',repeat('5',64));
  IF v_response->>'kind' IS DISTINCT FROM 'claimed' THEN
    RAISE EXCEPTION 'A4.3.4 HTTP precondition failed: %',v_response;
  END IF;
  v_response := public.kora_article_generation_reserve_linked(
    v_token,v_signal,v_attempt,v_http_id);
  IF v_response->>'ok' IS DISTINCT FROM 'true'
    OR (SELECT state FROM public.kora_article_generations
      WHERE signal_id='a434-before-signal') IS DISTINCT FROM 'reserved'
    OR (SELECT data->>'status' FROM public.kora_records
      WHERE collection='paid_attempts' AND id='a434-before-attempt') IS DISTINCT FROM 'reserved'
    OR (SELECT (data->>'reservedEur')::numeric FROM public.kora_settings
      WHERE workspace_id='kora') <> 0.01
  THEN RAISE EXCEPTION 'A4.3.4 linked reservation precondition failed: %',v_response; END IF;

  -- PRE-FIX BEHAVIOR: directly finishes the paid attempt even though A4 still owns it.
  PERFORM public.kora_paid_finish('a434-before-attempt','[]'::jsonb,'not_sent');
  IF (SELECT (data->>'reservedEur')::numeric FROM public.kora_settings
      WHERE workspace_id='kora') IS DISTINCT FROM 0::numeric
    OR (SELECT data->>'status' FROM public.kora_records
      WHERE collection='paid_attempts' AND id='a434-before-attempt') IS DISTINCT FROM 'not_sent'
    OR (SELECT state FROM public.kora_article_generations
      WHERE signal_id='a434-before-signal') IS DISTINCT FROM 'reserved'
    OR (SELECT data->>'state' FROM public.kora_records
      WHERE collection='http_idempotency' AND id=v_http_id) IS DISTINCT FROM 'pending'
  THEN RAISE EXCEPTION 'A4.3.4 expected pre-fix split-brain not reproduced'; END IF;
  RAISE NOTICE 'CHARACTERIZED A4.3.4: service_role released A3 reserve while durable A4 claim and HTTP intent stayed active';
END $$;
RESET ROLE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.kora_article_generation_recoveries
    WHERE signal_id='a434-before-signal')
  THEN RAISE EXCEPTION 'A4.3.4 unexpected DBA recovery archive'; END IF;
  RAISE NOTICE 'PASS: A4.3.4 pre-fix finance/A4 inconsistency characterized without DBA recovery';
END $$;
ROLLBACK;
