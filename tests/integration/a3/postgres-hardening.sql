-- A4.3.3 adversarial checks. Disposable DB only; all fixtures/helpers roll back.
BEGIN;
SET LOCAL statement_timeout = '30s';
CREATE FUNCTION public.a433_denied(p_sql text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION 'TEST forbidden statement succeeded: %',p_sql USING ERRCODE='XX000';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
CREATE FUNCTION public.a433_invalid(p_sql text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION 'TEST invalid RPC succeeded: %',p_sql USING ERRCODE='XX000';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
END $$;

-- First boot must work through the service role, with no direct settings grant.
SET LOCAL ROLE service_role;
SELECT public.kora_settings_initialize('{"workspaceId":"kora","quotaLimits":{"api_budget_eur":1},"reservedEur":0,"notifiedAlerts":[],"storageBaseGb":0}');
SELECT public.kora_paid_reserve('{"id":"a433-pending","workspaceId":"kora","month":"2026-11","kind":"generation_summary","estimateEur":0.01,"units":1,"label":"hardening fixture","createdAt":"2026-11-03T00:00:00Z"}');
SELECT public.kora_paid_start('a433-pending');
SELECT public.kora_paid_unknown('a433-pending','persist_error');
SELECT public.kora_http_idempotency_begin(repeat('d',64),'kora','a433','POST /articles',repeat('e',64));
INSERT INTO public.kora_records(collection,id,data) VALUES
  ('companies','a433-business','{"id":"a433-business","name":"initial"}'),
  ('audit','a433-audit','{"id":"a433-audit","action":"test.fixture"}'),
  ('usage','a433-free','{"id":"a433-free","costEur":0,"units":1}');
UPDATE public.kora_records SET data=data || '{"name":"edited"}' WHERE collection='companies' AND id='a433-business';
DELETE FROM public.kora_records WHERE collection='companies' AND id='a433-business';
RESET ROLE;
INSERT INTO public.kora_article_generations(signal_id,token,attempt_id,expected_signal,state)
VALUES ('a433-signal','a4330000-0000-4000-8000-000000000001','a433-archive-attempt','{}','uncertain');
INSERT INTO public.kora_article_generation_recoveries
  (signal_id,attempt_id,http_operation_id,resolution,evidence,previous_generation)
VALUES ('a433-archived','a433-archived-attempt',repeat('f',64),'not_sent','{"test":true}','{"test":true}');
CREATE TEMP TABLE a433_before AS SELECT
  (SELECT jsonb_agg(to_jsonb(r) ORDER BY collection,id) FROM public.kora_records r) records,
  (SELECT jsonb_agg(to_jsonb(s) ORDER BY workspace_id) FROM public.kora_settings s) settings,
  (SELECT jsonb_agg(to_jsonb(g) ORDER BY signal_id) FROM public.kora_article_generations g) generations,
  (SELECT jsonb_agg(to_jsonb(a) ORDER BY attempt_id) FROM public.kora_article_generation_recoveries a) archives;

SET LOCAL ROLE service_role;
DO $$
DECLARE c text; t text; a jsonb; invalid jsonb;
BEGIN
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) THEN
    RAISE EXCEPTION 'test must use service_role WITH BYPASSRLS'; END IF;
  FOREACH c IN ARRAY ARRAY['paid_attempts','http_idempotency'] LOOP
    PERFORM public.a433_denied(format('INSERT INTO public.kora_records(collection,id,data) VALUES (%L,%L,%L)',c,'a433-forged','{}'));
    PERFORM public.a433_denied(format('UPDATE public.kora_records SET data=%L WHERE collection=%L','{}',c));
    PERFORM public.a433_denied(format('DELETE FROM public.kora_records WHERE collection=%L',c));
    PERFORM public.a433_denied(format('UPDATE public.kora_records SET collection=%L WHERE collection=%L','companies',c));
  END LOOP;
  PERFORM public.a433_denied($q$INSERT INTO public.kora_records(collection,id,data) VALUES
    ('paid_attempts','a433-pending','{}') ON CONFLICT(collection,id) DO UPDATE SET data=EXCLUDED.data$q$);
  PERFORM public.a433_denied($q$INSERT INTO public.kora_records(collection,id,data) VALUES
    ('usage','a433-paid','{"id":"a433-paid","costEur":0.01,"units":1}')$q$);
  PERFORM public.a433_denied($q$INSERT INTO public.kora_records(collection,id,data) VALUES
    ('usage','a433-pending:line:0','{"id":"a433-pending:line:0","costEur":0,"units":1}')$q$);
  FOREACH c IN ARRAY ARRAY['usage','audit'] LOOP
    PERFORM public.a433_denied(format('UPDATE public.kora_records SET data=%L WHERE collection=%L','{}',c));
    PERFORM public.a433_denied(format('DELETE FROM public.kora_records WHERE collection=%L',c));
  END LOOP;
  PERFORM public.a433_denied($q$UPDATE public.kora_records SET collection='paid_attempts' WHERE collection='usage'$q$);
  PERFORM public.a433_denied($q$UPDATE public.kora_settings SET data='{}'$q$);
  PERFORM public.a433_denied($q$DELETE FROM public.kora_settings$q$);
  PERFORM public.a433_denied($q$INSERT INTO public.kora_settings(workspace_id,data) VALUES('kora','{}')
    ON CONFLICT(workspace_id) DO UPDATE SET data=EXCLUDED.data$q$);
  FOREACH t IN ARRAY ARRAY['kora_records','kora_settings','kora_article_generations','kora_article_generation_recoveries'] LOOP
    PERFORM public.a433_denied(format('TRUNCATE public.%I',t));
    IF has_table_privilege(current_user,'public.'||t,'TRIGGER,REFERENCES') THEN
      RAISE EXCEPTION 'dangerous remaining grant on %',t; END IF;
  END LOOP;
  PERFORM public.a433_denied($q$UPDATE public.kora_article_generations SET state='reserved'$q$);
  PERFORM public.a433_denied($q$DELETE FROM public.kora_article_generations$q$);
  PERFORM public.a433_denied($q$SELECT * FROM public.kora_article_generation_recoveries$q$);
  PERFORM public.a433_denied($q$UPDATE public.kora_article_generation_recoveries SET evidence='{}'$q$);
  PERFORM public.a433_denied($q$DELETE FROM public.kora_article_generation_recoveries$q$);
  PERFORM public.a433_denied($q$INSERT INTO public.kora_article_generation_recoveries
    (signal_id,attempt_id,http_operation_id,resolution,evidence,previous_generation)
    VALUES ('x','x','x','not_sent','{}','{}')$q$);
  PERFORM public.a433_denied($q$SELECT public.kora_paid_reconcile('a433-pending','not_billed',0,'{}')$q$);
  PERFORM public.a433_denied($q$SELECT public.kora_article_generation_admin_close_not_sent('x','x','{}')$q$);
  PERFORM public.a433_denied($q$SELECT public.kora_article_generation_admin_recover_http('x','x','{}')$q$);
  PERFORM public.a433_denied($q$ALTER TABLE public.kora_records DISABLE TRIGGER kora_00_records_write_guard$q$);
  PERFORM public.a433_denied($q$SET LOCAL session_replication_role = replica$q$);
  -- Neither forged claims nor a custom session variable may authorize raw writes.
  PERFORM set_config('request.jwt.claims','{"role":"postgres"}',true);
  PERFORM set_config('kora.trusted','true',true);
  PERFORM public.a433_denied($q$DELETE FROM public.kora_records WHERE collection='http_idempotency'$q$);
  PERFORM public.a433_denied($q$INSERT INTO public.kora_records(collection,id,data)
    VALUES('audit','aud_a43_forged','{"action":"article_generation.http_recovered"}')$q$);
  PERFORM public.a433_invalid($q$SELECT public.kora_signal_mutations_commit(
    '[{"collection":"audit","id":"aud_a43_forged","before":null,"after":{"id":"aud_a43_forged","action":"article_generation.http_recovered"}}]')$q$);
  -- A NULL transition must never release an uncertain reservation.
  PERFORM public.a433_invalid($q$SELECT public.kora_paid_finish('a433-pending','[]',NULL)$q$);
  PERFORM public.a433_invalid($q$SELECT public.kora_paid_finish('a433-pending','[]','not_sent')$q$);
  PERFORM public.a433_invalid($q$SELECT public.kora_paid_unknown('a433-pending',NULL)$q$);
  a := '{"id":"a433-invalid","workspaceId":"kora","month":"2026-11","kind":"generation_summary","estimateEur":0.01,"units":1,"label":"fixture","createdAt":"2026-11-03T00:00:00Z"}';
  FOREACH invalid IN ARRAY ARRAY[a-'month',a||'{"workspaceId":"other"}',a||'{"month":"2026-99"}',
    a||'{"units":null}',a||'{"status":"settled"}',a||'{"createdAt":"2026-10-03T00:00:00Z"}'] LOOP
    PERFORM public.a433_invalid(format('SELECT public.kora_paid_reserve(%L::jsonb)',invalid));
  END LOOP;
  -- Reinitialization preserves every existing field, including reserve and quota.
  PERFORM public.kora_settings_initialize('{"workspaceId":"kora","quotaLimits":{"api_budget_eur":999},"reservedEur":0,"notifiedAlerts":[],"storageBaseGb":0}');
END $$;
RESET ROLE;
DO $$
DECLARE b record;
BEGIN
  SELECT * INTO STRICT b FROM a433_before;
  IF b.records IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(r) ORDER BY collection,id) FROM public.kora_records r)
    OR b.settings IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(s) ORDER BY workspace_id) FROM public.kora_settings s)
    OR b.generations IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(g) ORDER BY signal_id) FROM public.kora_article_generations g)
    OR b.archives IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(a) ORDER BY attempt_id) FROM public.kora_article_generation_recoveries a)
  THEN RAISE EXCEPTION 'forbidden action changed protected state'; END IF;
END $$;

-- Valid settings edits preserve accounting; valid paid/HTTP transitions still work.
SET LOCAL ROLE service_role;
DO $$
DECLARE a jsonb; line jsonb; invalid jsonb;
BEGIN
  PERFORM public.kora_settings_save('{"workspaceId":"kora","quotaLimits":{"api_budget_eur":2},"notifiedAlerts":[],"storageBaseGb":0,"reservedEur":0,"paidCallsSuspended":false}');
  IF (SELECT (data->>'reservedEur')::numeric FROM public.kora_settings WHERE workspace_id='kora') <> 0.01
    THEN RAISE EXCEPTION 'settings erased reserve'; END IF;
  a := '{"id":"a433-valid","workspaceId":"kora","month":"2026-11","kind":"generation_summary","estimateEur":0.01,"units":1,"label":"fixture","createdAt":"2026-11-03T00:00:00Z"}';
  PERFORM public.kora_paid_reserve(a);
  PERFORM public.kora_paid_start(a->>'id');
  line := '{"id":"a433-valid:line:0","at":"2026-11-03T00:00:00Z","kind":"generation_summary","costEur":0.01,"units":1,"label":"fixture"}';
  FOREACH invalid IN ARRAY ARRAY[line-'at',line||'{"units":null}',line||'{"at":"2026-10-03T00:00:00Z"}',
    line||'{"costEur":0.00101}',line||'{"id":"other"}'] LOOP
    PERFORM public.a433_invalid(format('SELECT public.kora_paid_finish(%L,%L::jsonb,%L)',a->>'id',jsonb_build_array(invalid),'settled'));
  END LOOP;
  IF (SELECT (data->>'reservedEur')::numeric FROM public.kora_settings WHERE workspace_id='kora') <> 0.02
    OR EXISTS (SELECT 1 FROM public.kora_records WHERE collection='usage' AND id=line->>'id')
    THEN RAISE EXCEPTION 'invalid settlement changed budget or ledger'; END IF;
  PERFORM public.kora_paid_finish(a->>'id',jsonb_build_array(line),'settled');
  PERFORM public.kora_paid_finish(a->>'id',jsonb_build_array(line),'settled');
  PERFORM public.kora_http_idempotency_complete(repeat('d',64),201,'{}');
  IF (public.kora_http_idempotency_begin(repeat('d',64),'kora','a433','POST /articles',repeat('e',64)))->>'kind' <> 'completed'
    THEN RAISE EXCEPTION 'HTTP replay regression'; END IF;
  RAISE NOTICE 'PASS: A4.3.3 BYPASSRLS direct writes denied, SQL NULL guards, state preserved, legitimate RPCs retained';
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
SELECT public.a433_denied($q$SELECT public.kora_paid_reserve('{}')$q$);
SELECT public.a433_denied($q$SELECT public.kora_settings_initialize('{}')$q$);
SELECT public.a433_denied($q$SELECT * FROM public.kora_records$q$);
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT public.a433_denied($q$SELECT public.kora_http_idempotency_begin('x','kora','x','POST /articles','x')$q$);
SELECT public.a433_denied($q$SELECT public.kora_settings_save('{}')$q$);
SELECT public.a433_denied($q$DELETE FROM public.kora_article_generation_recoveries$q$);
RESET ROLE;
-- Missing settings with a surviving ledger cannot silently reset the reserve.
DELETE FROM public.kora_settings;
SET LOCAL ROLE service_role;
SELECT public.a433_invalid($q$SELECT public.kora_settings_initialize('{"workspaceId":"kora","quotaLimits":{"api_budget_eur":1},"reservedEur":0,"notifiedAlerts":[],"storageBaseGb":0}')$q$);
RESET ROLE;
ROLLBACK;
