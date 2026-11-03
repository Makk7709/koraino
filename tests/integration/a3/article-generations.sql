-- Run ONLY in the disposable test DB, after migrations and settings seed.
-- Roll back fixtures so the existing A3 accounting assertions stay unchanged.
BEGIN;
INSERT INTO public.kora_records(collection,id,data)
VALUES ('signals','a4-sql-signal','{"id":"a4-sql-signal","status":"nouveau","articleId":null}');
SET LOCAL ROLE service_role;
DO $$
DECLARE
  s jsonb := '{"id":"a4-sql-signal","status":"nouveau","articleId":null}';
  a jsonb := '{"id":"a4-sql-article","signalId":"a4-sql-signal","origin":"kora","status":"brouillon","currentVersion":1,"versions":[{}],"updatedAt":"2026-11-03T00:00:00Z"}';
  attempt jsonb := '{"id":"a4-sql-attempt","workspaceId":"kora","month":"2026-11","kind":"generation_article","estimateEur":0.01,"units":1,"label":"SQL test","createdAt":"2026-11-03T00:00:00Z"}';
  token uuid := '10000000-0000-4000-8000-000000000001';
  other_token uuid := '10000000-0000-4000-8000-000000000002';
  r jsonb;
BEGIN
  IF has_table_privilege('service_role','public.kora_article_generations','INSERT')
     OR has_table_privilege('service_role','public.kora_article_generations','UPDATE')
     OR has_table_privilege('service_role','public.kora_article_generations','DELETE')
     OR has_function_privilege('anon','public.kora_article_generation_reserve(uuid,jsonb,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','public.kora_article_generation_complete(text,uuid,jsonb)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.kora_article_generation_complete(text,uuid,jsonb)','EXECUTE')
  THEN RAISE EXCEPTION 'invalid A4 privileges'; END IF;
  -- Budget denial must not leave a generation or a paid attempt.
  r := public.kora_article_generation_reserve(token,s,attempt || '{"estimateEur":100000}');
  IF r->>'ok' <> 'false' OR EXISTS (SELECT 1 FROM public.kora_article_generations)
     OR EXISTS (SELECT 1 FROM public.kora_records WHERE id = 'a4-sql-attempt')
  THEN RAISE EXCEPTION 'budget denial created a claim'; END IF;
  UPDATE public.kora_settings SET data = data || '{"paidCallsSuspended":false,"suspendedMonth":null}';
  r := public.kora_article_generation_reserve(token,s,attempt);
  IF r->>'ok' <> 'true' THEN RAISE EXCEPTION 'claim failed: %',r; END IF;
  r := public.kora_article_generation_reserve(other_token,s,attempt || '{"id":"a4-other-attempt"}');
  IF r->>'blocked' <> 'busy' THEN RAISE EXCEPTION 'duplicate claim accepted'; END IF;
  BEGIN
    PERFORM public.kora_article_generation_start(s->>'id',other_token,attempt->>'id');
    RAISE EXCEPTION 'TEST wrong start token accepted' USING ERRCODE = 'XX000';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  PERFORM public.kora_article_generation_start(s->>'id',token,attempt->>'id');
  -- Known usable fallback with uncertain billing: keep the reserve through completion.
  PERFORM public.kora_paid_unknown(attempt->>'id','provider_or_callback_error');
  BEGIN
    PERFORM public.kora_article_generation_complete(s->>'id',other_token,a);
    RAISE EXCEPTION 'TEST wrong completion token accepted' USING ERRCODE = 'XX000';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  UPDATE public.kora_records SET data = data || '{"title":"concurrent edit"}' WHERE collection='signals' AND id=s->>'id';
  BEGIN
    PERFORM public.kora_article_generation_complete(s->>'id',token,a);
    RAISE EXCEPTION 'TEST concurrent signal edit overwritten' USING ERRCODE = 'XX000';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  IF EXISTS (SELECT 1 FROM public.kora_records WHERE collection='articles' AND id=a->>'id')
  THEN RAISE EXCEPTION 'partial article after conflict'; END IF;
  UPDATE public.kora_records SET data=s WHERE collection='signals' AND id=s->>'id';
END $$;

RESET ROLE;
-- Inject failure after the article INSERT, at the signal UPDATE, to test actual rollback.
CREATE FUNCTION public.a4_test_fail_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.collection='signals' AND NEW.id='a4-sql-signal' AND NEW.data->>'articleId' IS NOT NULL
  THEN RAISE EXCEPTION 'injected link failure'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER a4_test_fail_link BEFORE UPDATE ON public.kora_records
FOR EACH ROW EXECUTE FUNCTION public.a4_test_fail_link();
DO $$
DECLARE a jsonb := '{"id":"a4-sql-article","signalId":"a4-sql-signal","origin":"kora","status":"brouillon","currentVersion":1,"versions":[{}],"updatedAt":"2026-11-03T00:00:00Z"}';
BEGIN
  BEGIN
    PERFORM public.kora_article_generation_complete('a4-sql-signal','10000000-0000-4000-8000-000000000001',a);
    RAISE EXCEPTION 'TEST injected failure did not fire' USING ERRCODE = 'XX000';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'injected link failure' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.kora_records WHERE collection='articles' AND id='a4-sql-article')
     OR (SELECT state FROM public.kora_article_generations WHERE signal_id='a4-sql-signal') <> 'in_flight'
  THEN RAISE EXCEPTION 'atomic rollback failed'; END IF;
END $$;
DROP TRIGGER a4_test_fail_link ON public.kora_records;
DROP FUNCTION public.a4_test_fail_link();
SET LOCAL ROLE service_role;
DO $$
DECLARE
  token uuid := '10000000-0000-4000-8000-000000000001';
  a jsonb := '{"id":"a4-sql-article","signalId":"a4-sql-signal","origin":"kora","status":"brouillon","currentVersion":1,"versions":[{}],"updatedAt":"2026-11-03T00:00:00Z"}';
BEGIN
  PERFORM public.kora_article_generation_complete('a4-sql-signal',token,a);
  IF (SELECT data->>'articleId' FROM public.kora_records WHERE collection='signals' AND id='a4-sql-signal') <> a->>'id'
  THEN RAISE EXCEPTION 'missing signal association'; END IF;
  UPDATE public.kora_records SET data = data || '{"title":"editor title"}' WHERE collection='articles' AND id=a->>'id';
  PERFORM public.kora_article_generation_complete('a4-sql-signal',token,a);
  PERFORM public.kora_article_generation_uncertain('a4-sql-signal',token);
  IF (SELECT data->>'title' FROM public.kora_records WHERE collection='articles' AND id=a->>'id') <> 'editor title'
     OR (SELECT state FROM public.kora_article_generations WHERE signal_id='a4-sql-signal') <> 'completed'
     OR (SELECT (data->>'reservedEur')::numeric FROM public.kora_settings WHERE workspace_id='kora') <> 0.01
  THEN RAISE EXCEPTION 'replay altered state or released unknown reserve'; END IF;
  BEGIN
    UPDATE public.kora_records SET data = data || '{"articleId":null}' WHERE collection='signals' AND id='a4-sql-signal';
    RAISE EXCEPTION 'TEST stale signal update accepted' USING ERRCODE = 'XX000';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  BEGIN
    INSERT INTO public.kora_records(collection,id,data) VALUES ('articles','a4-duplicate',a || '{"id":"a4-duplicate"}');
    RAISE EXCEPTION 'TEST duplicate article accepted' USING ERRCODE = 'XX000';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  RAISE NOTICE 'PASS: A4 ownership, budget rejection, atomic rollback, signal conflict, replay and privileges';
END $$;
RESET ROLE;
ROLLBACK;
