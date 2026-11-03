-- A4.3.1 CHARACTERIZATION TESTS ONLY. Do not run against production.
-- Execute after migrations 0000..0009 and disposable settings seed.
-- These checks deliberately demonstrate CURRENT recovery gaps, not a fix.
-- Each fixture is rolled back, including finance, articles, HTTP records and audit.
BEGIN;

-- Case 1: A3 money was reconciled, but A4 still owns the signal.
INSERT INTO public.kora_records(collection, id, data)
VALUES ('signals', 'a43-fin-signal',
 '{"id":"a43-fin-signal","status":"nouveau","articleId":null}'::jsonb);

SET LOCAL ROLE service_role;
DO $$
DECLARE
  signal_data jsonb := '{"id":"a43-fin-signal","status":"nouveau","articleId":null}'::jsonb;
  attempt jsonb := '{"id":"a43-fin-attempt","workspaceId":"kora","month":"2026-11","kind":"generation_article","estimateEur":0.01,"units":1,"label":"A4.3 fixture: financial reconciliation","createdAt":"2026-11-03T00:00:00Z"}'::jsonb;
  token uuid := 'a4300000-0000-4000-8000-000000000001';
  response jsonb;
BEGIN
  response := public.kora_article_generation_reserve(token, signal_data, attempt);
  IF response->>'ok' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'A4.3 case 1 reservation failed: %', response;
  END IF;
  PERFORM public.kora_article_generation_start('a43-fin-signal', token, 'a43-fin-attempt');
  PERFORM public.kora_paid_unknown('a43-fin-attempt','provider_or_callback_error');
  PERFORM public.kora_article_generation_uncertain('a43-fin-signal', token);
END $$;
RESET ROLE;

-- Only postgres may reconcile; this synthetic evidence exists in a disposable fixture.
DO $$
DECLARE
  evidence jsonb := jsonb_build_object(
    'source','provider_support_confirmation',
    'reference','ISOLATED-A43-FIN-01',
    'operator','a43-test-dba',
    'sha256',repeat('a',64),
    'currency','EUR',
    'checkedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z')
  );
BEGIN
  PERFORM public.kora_paid_reconcile(
    'a43-fin-attempt', 'not_billed', 0, evidence
  );
END $$;

SET LOCAL ROLE service_role;
DO $$
DECLARE
  signal_data jsonb := '{"id":"a43-fin-signal","status":"nouveau","articleId":null}'::jsonb;
  attempt jsonb := '{"id":"a43-fin-retry","workspaceId":"kora","month":"2026-11","kind":"generation_article","estimateEur":0.01,"units":1,"label":"A4.3 fixture: blocked reattempt","createdAt":"2026-11-03T00:00:00Z"}'::jsonb;
  response jsonb;
BEGIN
  IF (SELECT data->>'status' FROM public.kora_records
      WHERE collection='paid_attempts' AND id='a43-fin-attempt') <> 'reconciled_not_billed'
     OR (SELECT state FROM public.kora_article_generations
      WHERE signal_id='a43-fin-signal') <> 'uncertain'
     OR EXISTS (SELECT 1 FROM public.kora_records
      WHERE collection='articles' AND data->>'signalId'='a43-fin-signal')
     OR (SELECT (data->>'reservedEur')::numeric FROM public.kora_settings
      WHERE workspace_id='kora') <> 0
  THEN RAISE EXCEPTION 'A4.3 case 1 setup/reconciliation mismatch'; END IF;

  response := public.kora_article_generation_reserve(
    'a4300000-0000-4000-8000-000000000002', signal_data, attempt
  );
  IF response->>'blocked' IS DISTINCT FROM 'busy' OR
     EXISTS (SELECT 1 FROM public.kora_records
       WHERE collection='paid_attempts' AND id='a43-fin-retry')
  THEN RAISE EXCEPTION 'A4.3 case 1: A4 ownership not retained after A3 reconciliation'; END IF;

  RAISE NOTICE 'CHARACTERIZED A4.3 case 1: A3 reconciled_not_billed, A4 uncertain, retry blocked';
END $$;
RESET ROLE;

-- Case 2: article committed, but the HTTP operation remains pending.
INSERT INTO public.kora_records(collection, id, data)
VALUES ('signals','a43-http-signal',
 '{"id":"a43-http-signal","status":"nouveau","articleId":null}'::jsonb);

SET LOCAL ROLE service_role;
DO $$
DECLARE
  signal_data jsonb := '{"id":"a43-http-signal","status":"nouveau","articleId":null}'::jsonb;
  article_data jsonb := '{"id":"a43-http-article","signalId":"a43-http-signal","origin":"kora","status":"brouillon","currentVersion":1,"versions":[{}],"updatedAt":"2026-11-03T00:00:00Z"}'::jsonb;
  attempt jsonb := '{"id":"a43-http-attempt","workspaceId":"kora","month":"2026-11","kind":"generation_article","estimateEur":0.01,"units":1,"label":"A4.3 fixture: response lost","createdAt":"2026-11-03T00:00:00Z"}'::jsonb;
  http_id text := repeat('b',64);
  token uuid := 'a4300000-0000-4000-8000-000000000003';
  response jsonb;
BEGIN
  response := public.kora_http_idempotency_begin(
    http_id, 'kora', 'a43-actor', 'POST /articles', repeat('c',64)
  );
  IF response->>'kind' <> 'claimed' THEN
    RAISE EXCEPTION 'A4.3 case 2 HTTP claim failed: %', response;
  END IF;
  response := public.kora_article_generation_reserve(token, signal_data, attempt);
  IF response->>'ok' <> 'true' THEN
    RAISE EXCEPTION 'A4.3 case 2 reservation failed: %', response;
  END IF;
  PERFORM public.kora_article_generation_start('a43-http-signal',token,'a43-http-attempt');
  PERFORM public.kora_paid_finish(
    'a43-http-attempt',
    jsonb_build_array(jsonb_build_object(
      'id','a43-http-attempt:line:0',
      'at','2026-11-03T00:00:00Z',
      'kind','generation_article',
      'units',1,
      'costEur',0.01,
      'label','A4.3 fixture: response lost'
    )),
    'settled'
  );
  PERFORM public.kora_article_generation_complete('a43-http-signal',token,article_data);
  IF (SELECT state FROM public.kora_article_generations
       WHERE signal_id='a43-http-signal') <> 'completed'
     OR (SELECT data->>'articleId' FROM public.kora_records
       WHERE collection='signals' AND id='a43-http-signal') <> 'a43-http-article'
     OR (SELECT data->>'status' FROM public.kora_records
       WHERE collection='paid_attempts' AND id='a43-http-attempt') <> 'settled'
     OR (SELECT data->>'state' FROM public.kora_records
       WHERE collection='http_idempotency' AND id=http_id) <> 'pending'
  THEN RAISE EXCEPTION 'A4.3 case 2 state setup mismatch'; END IF;

  response := public.kora_http_idempotency_begin(
    http_id,'kora','a43-actor','POST /articles',repeat('c',64)
  );
  IF response->>'kind' <> 'pending' THEN
    RAISE EXCEPTION 'A4.3 case 2 HTTP retry was not blocked: %',response;
  END IF;
  response := public.kora_article_generation_reserve(
    'a4300000-0000-4000-8000-000000000004',signal_data,
    attempt || '{"id":"a43-http-retry"}'::jsonb
  );
  -- The original signal snapshot no longer matches because an article was linked.
  -- Either signal_changed or article_exists is a safe rejection.
  IF response->>'blocked' NOT IN ('signal_changed','article_exists')
     OR EXISTS (SELECT 1 FROM public.kora_records
       WHERE collection='paid_attempts' AND id='a43-http-retry')
  THEN RAISE EXCEPTION 'A4.3 case 2 unsafe duplicate article reservation: %',response; END IF;
  RAISE NOTICE 'CHARACTERIZED A4.3 case 2: A4 completed, A3 settled, HTTP pending blocks replay';
END $$;
RESET ROLE;

-- Case 3: authenticated and HTTP service roles must not have admin recovery powers.
DO $$
BEGIN
  IF has_table_privilege('service_role','public.kora_article_generations','UPDATE')
    OR has_table_privilege('service_role','public.kora_article_generations','DELETE')
    OR has_function_privilege('service_role',
      'public.kora_paid_reconcile(text,text,numeric,jsonb)','EXECUTE')
    OR has_function_privilege('authenticated',
      'public.kora_paid_reconcile(text,text,numeric,jsonb)','EXECUTE')
    OR has_function_privilege('anon',
      'public.kora_article_generation_uncertain(text,uuid)','EXECUTE')
  THEN RAISE EXCEPTION 'A4.3 case 3 excessive recovery privilege'; END IF;
END $$;

SET LOCAL ROLE service_role;
DO $$
DECLARE rejected boolean := false;
BEGIN
  BEGIN
    UPDATE public.kora_article_generations SET state='uncertain'
    WHERE signal_id='a43-http-signal';
  EXCEPTION WHEN insufficient_privilege THEN rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'A4.3 case 3 HTTP service role updated protected A4 claim';
  END IF;
  rejected := false;
  BEGIN
    PERFORM public.kora_paid_reconcile(
      'a43-fin-attempt','not_billed',0,'{}'::jsonb
    );
  EXCEPTION WHEN insufficient_privilege THEN rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'A4.3 case 3 HTTP service role invoked DBA reconciliation';
  END IF;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $$
DECLARE rejected boolean := false;
BEGIN
  BEGIN
    PERFORM public.kora_article_generation_uncertain(
      'a43-fin-signal','a4300000-0000-4000-8000-000000000001'
    );
  EXCEPTION WHEN insufficient_privilege THEN rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'A4.3 case 3 authenticated role invoked A4 transition';
  END IF;
END $$;
RESET ROLE;

DO $$
BEGIN
  IF (SELECT state FROM public.kora_article_generations
       WHERE signal_id='a43-http-signal') <> 'completed'
     OR (SELECT state FROM public.kora_article_generations
       WHERE signal_id='a43-fin-signal') <> 'uncertain'
  THEN RAISE EXCEPTION 'A4.3 case 3 unauthorized operation modified A4 state'; END IF;
  RAISE NOTICE 'CHARACTERIZED A4.3 case 3: app roles cannot update A4 or invoke DBA-only reconciliation';
  RAISE NOTICE 'PASS: A4.3.1 three pre-fix characterizations (NOT a recovery implementation)';
END $$;
ROLLBACK;
