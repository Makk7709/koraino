-- A4.3.2 RED/GREEN: DBA-only recovery, executable ONLY against the disposable DB.
-- No supplier or production endpoints. Every fixture and archive is rolled back.
BEGIN;
INSERT INTO public.kora_records(collection,id,data) VALUES
('signals','a43-safe-signal','{"id":"a43-safe-signal","status":"nouveau","articleId":null}'::jsonb),
('signals','a43-done-signal','{"id":"a43-done-signal","status":"nouveau","articleId":null}'::jsonb),
('signals','a43-unsafe-signal','{"id":"a43-unsafe-signal","status":"nouveau","articleId":null}'::jsonb);

-- All evidence is synthetic and scoped to this transaction.
CREATE FUNCTION public.a43_test_evidence(p_reference text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'source','runtime_process_audit','reference',p_reference,
    'operator','a43-test-dba','sha256',repeat('a',64),
    'checkedAt','2026-11-03T00:00:00Z'
  )
$$;

SET LOCAL ROLE service_role;
DO $$
DECLARE
  v_result jsonb;
  v_http text := repeat('a',64);
  v_done_http text := repeat('b',64);
  v_bad_http text := repeat('c',64);
BEGIN
  -- Stable HTTP-to-generation linkage is required before an administrative recovery.
  v_result := public.kora_http_idempotency_begin(v_http,'kora','a43-actor','POST /articles',repeat('1',64));
  IF v_result->>'kind' <> 'claimed' THEN RAISE EXCEPTION 'A43 safe HTTP claim'; END IF;
  v_result := public.kora_article_generation_reserve_linked(
    'a4300000-0000-4000-8000-000000000021',
    '{"id":"a43-safe-signal","status":"nouveau","articleId":null}'::jsonb,
    '{"id":"a43-safe-attempt","workspaceId":"kora","month":"2026-11","kind":"generation_article","estimateEur":0.01,"units":1,"label":"A43 safe","createdAt":"2026-11-03T00:00:00Z"}'::jsonb,
    v_http
  );
  IF v_result->>'ok' <> 'true' THEN RAISE EXCEPTION 'A43 safe reservation'; END IF;
  -- HTTP may be marked uncertain even though durable A3/A4 both prove "not sent".
  PERFORM public.kora_http_idempotency_uncertain(v_http);

  v_result := public.kora_http_idempotency_begin(v_done_http,'kora','a43-actor','POST /articles',repeat('2',64));
  IF v_result->>'kind' <> 'claimed' THEN RAISE EXCEPTION 'A43 done HTTP claim'; END IF;
  v_result := public.kora_article_generation_reserve_linked(
    'a4300000-0000-4000-8000-000000000022',
    '{"id":"a43-done-signal","status":"nouveau","articleId":null}'::jsonb,
    '{"id":"a43-done-attempt","workspaceId":"kora","month":"2026-11","kind":"generation_article","estimateEur":0.01,"units":1,"label":"A43 done","createdAt":"2026-11-03T00:00:00Z"}'::jsonb,
    v_done_http
  );
  IF v_result->>'ok' <> 'true' THEN RAISE EXCEPTION 'A43 completed reservation'; END IF;
  PERFORM public.kora_article_generation_start('a43-done-signal',
    'a4300000-0000-4000-8000-000000000022','a43-done-attempt');
  PERFORM public.kora_paid_finish('a43-done-attempt',jsonb_build_array(jsonb_build_object(
    'id','a43-done-attempt:line:0','at','2026-11-03T00:00:00Z',
    'kind','generation_article','units',1,'costEur',0.01,'label','A43 done'
  )),'settled');
  PERFORM public.kora_article_generation_complete('a43-done-signal',
    'a4300000-0000-4000-8000-000000000022',
    '{"id":"a43-done-article","signalId":"a43-done-signal","origin":"kora","status":"brouillon","currentVersion":1,"versions":[{}],"updatedAt":"2026-11-03T00:00:00Z"}'::jsonb
  );

  v_result := public.kora_http_idempotency_begin(v_bad_http,'kora','a43-actor','POST /articles',repeat('3',64));
  IF v_result->>'kind' <> 'claimed' THEN RAISE EXCEPTION 'A43 unsafe HTTP claim'; END IF;
  v_result := public.kora_article_generation_reserve_linked(
    'a4300000-0000-4000-8000-000000000023',
    '{"id":"a43-unsafe-signal","status":"nouveau","articleId":null}'::jsonb,
    '{"id":"a43-unsafe-attempt","workspaceId":"kora","month":"2026-11","kind":"generation_article","estimateEur":0.01,"units":1,"label":"A43 unsafe","createdAt":"2026-11-03T00:00:00Z"}'::jsonb,
    v_bad_http
  );
  IF v_result->>'ok' <> 'true' THEN RAISE EXCEPTION 'A43 unsafe reservation'; END IF;
  PERFORM public.kora_article_generation_start('a43-unsafe-signal',
    'a4300000-0000-4000-8000-000000000023','a43-unsafe-attempt');
  PERFORM public.kora_paid_unknown('a43-unsafe-attempt','provider_or_callback_error');
  PERFORM public.kora_article_generation_uncertain('a43-unsafe-signal',
    'a4300000-0000-4000-8000-000000000023');
END $$;
RESET ROLE;

-- A DBA reconciliation of "not_billed" alone must not unblock a call actually started.
DO $$
BEGIN
  PERFORM public.kora_paid_reconcile('a43-unsafe-attempt','not_billed',0,
    jsonb_build_object('source','provider_support_confirmation',
      'reference','A43-TEST-NO-CHARGE','operator','a43-test-dba',
      'sha256',repeat('c',64),'currency','EUR',
      'checkedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z')));
END $$;

-- Even with DBA privileges, invalid proofs and unsafe transitions must fail closed.
DO $$
DECLARE
  v_failed boolean;
  v_amount numeric;
BEGIN
  IF has_function_privilege('service_role',
      'public.kora_article_generation_admin_close_not_sent(text,text,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated',
      'public.kora_article_generation_admin_close_not_sent(text,text,jsonb)','EXECUTE')
     OR has_function_privilege('service_role',
      'public.kora_article_generation_admin_recover_http(text,text,jsonb)','EXECUTE')
  THEN RAISE EXCEPTION 'A43 unauthorized recovery RPC privilege'; END IF;

  v_failed := false;
  BEGIN
    PERFORM public.kora_article_generation_admin_close_not_sent(
      'a43-unsafe-signal', repeat('c',64),public.a43_test_evidence('A43-UNSAFE-PROOF'));
  EXCEPTION WHEN OTHERS THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A43 charge-reconciled call was unsafely released'; END IF;

  v_failed := false;
  BEGIN
    PERFORM public.kora_article_generation_admin_close_not_sent(
      'a43-safe-signal',repeat('a',64),'{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A43 missing evidence accepted'; END IF;

  SELECT (data->>'reservedEur')::numeric INTO STRICT v_amount FROM public.kora_settings
    WHERE workspace_id='kora';
  IF v_amount <> 0.01 THEN RAISE EXCEPTION 'A43 pre-close reserve changed: %',v_amount; END IF;

  PERFORM public.kora_article_generation_admin_close_not_sent(
    'a43-safe-signal',repeat('a',64),public.a43_test_evidence('A43-SAFE-CLOSE-001'));

  IF EXISTS (SELECT 1 FROM public.kora_article_generations WHERE signal_id='a43-safe-signal')
     OR NOT EXISTS (SELECT 1 FROM public.kora_article_generation_recoveries
       WHERE signal_id='a43-safe-signal' AND attempt_id='a43-safe-attempt'
       AND resolution='not_sent')
     OR (SELECT data->>'status' FROM public.kora_records
       WHERE collection='paid_attempts' AND id='a43-safe-attempt') <> 'not_sent'
     OR (SELECT data->>'state' FROM public.kora_records
       WHERE collection='http_idempotency' AND id=repeat('a',64)) <> 'closed_not_sent'
  THEN RAISE EXCEPTION 'A43 safe closure inconsistent'; END IF;

  PERFORM public.kora_article_generation_admin_close_not_sent(
    'a43-safe-signal',repeat('a',64),public.a43_test_evidence('A43-SAFE-CLOSE-001'));
  v_failed := false;
  BEGIN
    PERFORM public.kora_article_generation_admin_close_not_sent(
      'a43-safe-signal',repeat('a',64),public.a43_test_evidence('A43-DIFFERENT-PROOF'));
  EXCEPTION WHEN OTHERS THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A43 conflicting closure replay accepted'; END IF;

  PERFORM public.kora_article_generation_admin_recover_http(
    'a43-done-signal',repeat('b',64),public.a43_test_evidence('A43-DONE-HTTP-001'));
  IF (SELECT data->>'state' FROM public.kora_records
        WHERE collection='http_idempotency' AND id=repeat('b',64)) <> 'recovered_completed'
     OR (SELECT data->>'articleId' FROM public.kora_records
        WHERE collection='http_idempotency' AND id=repeat('b',64)) <> 'a43-done-article'
  THEN RAISE EXCEPTION 'A43 completed HTTP recovery missing'; END IF;

  PERFORM public.kora_article_generation_admin_recover_http(
    'a43-done-signal',repeat('b',64),public.a43_test_evidence('A43-DONE-HTTP-001'));
  v_failed := false;
  BEGIN
    PERFORM public.kora_article_generation_admin_recover_http(
      'a43-unsafe-signal',repeat('c',64),public.a43_test_evidence('A43-UNSAFE-HTTP'));
  EXCEPTION WHEN OTHERS THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A43 unfinished article HTTP was recovered'; END IF;
  RAISE NOTICE 'PASS: A4.3 DBA safe closure and completed HTTP recovery, idempotent evidence, fail-closed';
END $$;

SET LOCAL ROLE service_role;
DO $$
DECLARE
  v_http jsonb;
  v_reservation jsonb;
  v_rejected boolean := false;
BEGIN
  v_http := public.kora_http_idempotency_begin(
    repeat('a',64),'kora','a43-actor','POST /articles',repeat('1',64));
  IF v_http->>'kind' <> 'closed_not_sent' THEN
    RAISE EXCEPTION 'A43 original HTTP key was reopened'; END IF;

  v_http := public.kora_http_idempotency_begin(
    repeat('b',64),'kora','a43-actor','POST /articles',repeat('2',64));
  IF v_http->>'kind' <> 'recovered_completed'
    OR v_http->>'articleId' <> 'a43-done-article'
  THEN RAISE EXCEPTION 'A43 existing article not recoverable via HTTP'; END IF;

  BEGIN
    PERFORM public.kora_article_generation_reserve_linked(
      'a4300000-0000-4000-8000-000000000025',
      '{"id":"a43-safe-signal","status":"nouveau","articleId":null}'::jsonb,
      '{"id":"a43-safe-retry","workspaceId":"kora","month":"2026-11","kind":"generation_article","estimateEur":0.01,"units":1,"label":"A43 retry","createdAt":"2026-11-03T00:00:00Z"}'::jsonb,
      repeat('a',64));
  EXCEPTION WHEN raise_exception THEN v_rejected := true; END;
  IF NOT v_rejected OR EXISTS (SELECT 1 FROM public.kora_records
      WHERE collection='paid_attempts' AND id='a43-safe-retry') THEN
    RAISE EXCEPTION 'A43 closed HTTP key reused for new paid generation'; END IF;

  v_http := public.kora_http_idempotency_begin(
    repeat('d',64),'kora','a43-actor','POST /articles',repeat('4',64));
  IF v_http->>'kind' <> 'claimed' THEN RAISE EXCEPTION 'A43 fresh HTTP intent denied'; END IF;
  v_reservation := public.kora_article_generation_reserve_linked(
    'a4300000-0000-4000-8000-000000000026',
    '{"id":"a43-safe-signal","status":"nouveau","articleId":null}'::jsonb,
    '{"id":"a43-safe-retry","workspaceId":"kora","month":"2026-11","kind":"generation_article","estimateEur":0.01,"units":1,"label":"A43 retry","createdAt":"2026-11-03T00:00:00Z"}'::jsonb,
    repeat('d',64));
  IF v_reservation->>'ok' <> 'true' THEN
    RAISE EXCEPTION 'A43 safe retry not allowed with fresh key: %',v_reservation; END IF;

  RAISE NOTICE 'PASS: A4.3 original key closed, recovered article replayed, new intent permitted';
END $$;
RESET ROLE;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.kora_article_generation_recoveries
       WHERE signal_id='a43-safe-signal') <> 1
     OR (SELECT count(*) FROM public.kora_article_generation_recoveries
       WHERE signal_id='a43-done-signal') <> 1
  THEN RAISE EXCEPTION 'A43 immutable DBA archive missing'; END IF;
  RAISE NOTICE 'PASS: A4.3 two DBA-only recovery archives retained';
END $$;
ROLLBACK;
