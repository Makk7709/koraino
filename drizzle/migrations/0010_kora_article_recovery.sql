-- A4.3: DBA-only, durable recovery of provably unsent or already committed article generations.
-- Additive. Historical claims without a trusted HTTP link stay fail-closed.
CREATE TABLE public.kora_article_generation_recoveries (
  signal_id text NOT NULL,
  attempt_id text NOT NULL PRIMARY KEY,
  http_operation_id text NOT NULL UNIQUE,
  resolution text NOT NULL CHECK (resolution IN ('not_sent','http_recovered')),
  evidence jsonb NOT NULL,
  previous_generation jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.kora_article_generation_recoveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kora_article_generation_recoveries FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.kora_article_generations ADD COLUMN http_operation_id text UNIQUE;

-- Establish an immutable link within the same transaction as budget reservation.
CREATE FUNCTION public.kora_article_generation_reserve_linked(
  p_token uuid, p_signal jsonb, p_attempt jsonb, p_http_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET lock_timeout = '3s' SET statement_timeout = '20s' AS $$
DECLARE v_http jsonb; v_result jsonb;
BEGIN
  IF p_http_id IS NULL OR p_http_id !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid HTTP association';
  END IF;
  SELECT data INTO STRICT v_http FROM public.kora_records
    WHERE collection='http_idempotency' AND id=p_http_id FOR UPDATE;
  IF v_http->>'state' IS DISTINCT FROM 'pending'
     OR v_http->>'workspaceId' IS DISTINCT FROM 'kora'
     OR v_http->>'route' IS DISTINCT FROM 'POST /articles'
  THEN RAISE EXCEPTION 'invalid HTTP operation state'; END IF;
  IF EXISTS (SELECT 1 FROM public.kora_article_generations WHERE http_operation_id=p_http_id)
    OR EXISTS (SELECT 1 FROM public.kora_article_generation_recoveries
      WHERE http_operation_id=p_http_id) THEN
    RAISE EXCEPTION 'HTTP operation already linked';
  END IF;
  v_result := public.kora_article_generation_reserve(p_token,p_signal,p_attempt);
  IF v_result->>'ok' = 'true' THEN
    UPDATE public.kora_article_generations SET http_operation_id=p_http_id
      WHERE signal_id=p_signal->>'id' AND token=p_token;
    IF NOT FOUND THEN RAISE EXCEPTION 'linked reservation missing'; END IF;
  END IF;
  RETURN v_result;
END;
$$;

-- Evidence is an audit reference, not a claim that SHA-256 content was externally verified.
CREATE FUNCTION public.kora_article_recovery_check_evidence(p_evidence jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_checked timestamptz;
BEGIN
  IF jsonb_typeof(p_evidence) IS DISTINCT FROM 'object'
    OR COALESCE(p_evidence->>'source','') NOT IN ('runtime_process_audit','provider_support_confirmation')
    OR length(btrim(COALESCE(p_evidence->>'reference',''))) NOT BETWEEN 6 AND 256
    OR length(btrim(COALESCE(p_evidence->>'operator',''))) NOT BETWEEN 3 AND 128
    OR COALESCE(p_evidence->>'sha256','') !~ '^[a-f0-9]{64}$'
    OR COALESCE(p_evidence->>'checkedAt','') !~
      '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
  THEN RAISE EXCEPTION 'incomplete A4.3 recovery evidence'; END IF;
  v_checked := (p_evidence->>'checkedAt')::timestamptz;
  IF v_checked > clock_timestamp() + interval '5 minutes'
    THEN RAISE EXCEPTION 'future recovery evidence'; END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.kora_article_recovery_check_evidence(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.kora_article_generation_admin_close_not_sent(
  p_signal_id text, p_http_id text, p_evidence jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
SET lock_timeout = '3s' SET statement_timeout = '20s' AS $$
DECLARE v_op public.kora_article_generations; v_http jsonb; v_attempt jsonb;
  v_settings jsonb; v_old jsonb; v_archive public.kora_article_generation_recoveries;
  v_at text; v_budget numeric; v_estimate numeric;
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'DBA only'; END IF;
  PERFORM public.kora_article_recovery_check_evidence(p_evidence);
  -- The linked reservation locks HTTP first; preserve this order to avoid deadlocks.
  SELECT data INTO STRICT v_http FROM public.kora_records
    WHERE collection='http_idempotency' AND id=p_http_id FOR UPDATE;
  -- Serialize financial transitions with kora_paid_finish / reserve.
  SELECT data INTO STRICT v_settings FROM public.kora_settings
    WHERE workspace_id='kora' FOR UPDATE;
  SELECT * INTO v_archive FROM public.kora_article_generation_recoveries
    WHERE signal_id=p_signal_id AND http_operation_id=p_http_id AND resolution='not_sent';
  IF FOUND THEN
    IF v_archive.evidence = p_evidence THEN RETURN true; END IF;
    RAISE EXCEPTION 'conflicting recovery replay';
  END IF;
  SELECT * INTO STRICT v_op FROM public.kora_article_generations
    WHERE signal_id=p_signal_id FOR UPDATE;
  IF v_op.http_operation_id IS DISTINCT FROM p_http_id OR v_op.state <> 'reserved'
     OR v_op.article_payload IS NOT NULL THEN
    RAISE EXCEPTION 'generation was not proven unsent'; END IF;
  IF v_http->>'state' IS DISTINCT FROM 'pending'
     OR v_http->>'route' IS DISTINCT FROM 'POST /articles'
     OR v_http->>'workspaceId' IS DISTINCT FROM 'kora'
  THEN RAISE EXCEPTION 'HTTP operation mismatch'; END IF;
  -- A stale edited signal requires investigation rather than quiet closure.
  PERFORM 1 FROM public.kora_records
    WHERE collection='signals' AND id=p_signal_id AND data=v_op.expected_signal FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'signal changed before recovery'; END IF;
  SELECT data INTO STRICT v_attempt FROM public.kora_records
    WHERE collection='paid_attempts' AND id=v_op.attempt_id FOR UPDATE;
  IF v_attempt->>'status' IS DISTINCT FROM 'reserved'
    OR v_attempt->>'workspaceId' IS DISTINCT FROM 'kora'
    OR v_attempt->>'kind' IS DISTINCT FROM 'generation_article'
  THEN RAISE EXCEPTION 'paid work might have been started'; END IF;
  IF EXISTS (SELECT 1 FROM public.kora_records
    WHERE collection='articles' AND data->>'signalId'=p_signal_id)
  THEN RAISE EXCEPTION 'article already exists'; END IF;

  v_estimate := (v_attempt->>'estimateEur')::numeric;
  v_budget := (v_settings->>'reservedEur')::numeric;
  IF v_estimate IS NULL OR v_estimate <= 0 OR v_budget < v_estimate
    THEN RAISE EXCEPTION 'inconsistent reserved budget'; END IF;
  v_at := to_char(clock_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z');
  v_old := jsonb_build_object('state',v_op.state,'token',v_op.token,
    'attemptId',v_op.attempt_id,'httpOperationId',v_op.http_operation_id);
  -- Tombstone prevents original key replay, but a verified fresh intent may run.
  UPDATE public.kora_records SET data=v_attempt || jsonb_build_object(
    'status','not_sent','billingStatus','not_charged',
    'usageLines','[]'::jsonb,'completedAt',v_at),updated_at=clock_timestamp()
    WHERE collection='paid_attempts' AND id=v_op.attempt_id;
  UPDATE public.kora_settings SET data=jsonb_set(v_settings,'{reservedEur}',
    to_jsonb(round(v_budget-v_estimate,4))),updated_at=clock_timestamp()
    WHERE workspace_id='kora';
  UPDATE public.kora_records SET data=v_http || jsonb_build_object(
    'state','closed_not_sent','markedAt',v_at),updated_at=clock_timestamp()
    WHERE collection='http_idempotency' AND id=p_http_id;
  INSERT INTO public.kora_article_generation_recoveries(
    signal_id,attempt_id,http_operation_id,resolution,evidence,previous_generation)
    VALUES(p_signal_id,v_op.attempt_id,p_http_id,'not_sent',p_evidence,v_old);
  DELETE FROM public.kora_article_generations
    WHERE signal_id=p_signal_id AND token=v_op.token;
  INSERT INTO public.kora_records(collection,id,data) VALUES(
    'audit','aud_a43_close_'||v_op.attempt_id,
    jsonb_build_object('id','aud_a43_close_'||v_op.attempt_id,
      'at',v_at,'actor',p_evidence->>'operator','action','article_generation.recovery_not_sent',
      'entity','signal','entityId',p_signal_id,
      'details',jsonb_build_object('attemptId',v_op.attempt_id,'httpOperationId',p_http_id,
        'reference',p_evidence->>'reference','sha256',p_evidence->>'sha256')::text));
  RETURN true;
END;
$$;

CREATE FUNCTION public.kora_article_generation_admin_recover_http(
  p_signal_id text, p_http_id text, p_evidence jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
SET lock_timeout = '3s' SET statement_timeout = '20s' AS $$
DECLARE v_op public.kora_article_generations; v_http jsonb; v_article jsonb;
 v_signal jsonb; v_attempt jsonb; v_old jsonb; v_at text;
 v_archive public.kora_article_generation_recoveries;
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'DBA only'; END IF;
  PERFORM public.kora_article_recovery_check_evidence(p_evidence);
  SELECT data INTO STRICT v_http FROM public.kora_records
    WHERE collection='http_idempotency' AND id=p_http_id FOR UPDATE;
  SELECT * INTO STRICT v_op FROM public.kora_article_generations
    WHERE signal_id=p_signal_id FOR UPDATE;
  IF v_op.http_operation_id IS DISTINCT FROM p_http_id OR v_op.state <> 'completed'
    OR v_op.article_payload IS NULL THEN RAISE EXCEPTION 'generation not completed'; END IF;
  SELECT * INTO v_archive FROM public.kora_article_generation_recoveries
    WHERE http_operation_id=p_http_id;
  IF FOUND THEN
    IF v_archive.signal_id=p_signal_id AND v_archive.resolution='http_recovered'
      AND v_archive.evidence=p_evidence
      AND v_http->>'state'='recovered_completed' THEN RETURN true; END IF;
    RAISE EXCEPTION 'conflicting HTTP recovery replay';
  END IF;
  IF v_http->>'state' NOT IN ('pending','uncertain')
    OR v_http->>'workspaceId' IS DISTINCT FROM 'kora'
    OR v_http->>'route' IS DISTINCT FROM 'POST /articles'
  THEN RAISE EXCEPTION 'HTTP operation not recoverable'; END IF;
  SELECT data INTO STRICT v_signal FROM public.kora_records
    WHERE collection='signals' AND id=p_signal_id FOR UPDATE;
  SELECT data INTO STRICT v_article FROM public.kora_records
    WHERE collection='articles' AND id=v_op.article_payload->>'id' FOR UPDATE;
  SELECT data INTO STRICT v_attempt FROM public.kora_records
    WHERE collection='paid_attempts' AND id=v_op.attempt_id FOR UPDATE;
  IF v_article->>'signalId' IS DISTINCT FROM p_signal_id
    OR v_signal->>'articleId' IS DISTINCT FROM v_article->>'id'
    OR v_attempt->>'status' NOT IN ('settled','reconciled_billed','reconciled_not_billed','unknown')
    THEN RAISE EXCEPTION 'completed article/accounting mismatch'; END IF;
  v_at := to_char(clock_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z');
  v_old := jsonb_build_object('state',v_op.state,'token',v_op.token,
    'attemptId',v_op.attempt_id,'httpOperationId',v_op.http_operation_id,
    'articleId',v_article->>'id');
  UPDATE public.kora_records SET data=v_http || jsonb_build_object(
    'state','recovered_completed','articleId',v_article->>'id','markedAt',v_at),
    updated_at=clock_timestamp()
    WHERE collection='http_idempotency' AND id=p_http_id;
  INSERT INTO public.kora_article_generation_recoveries(
    signal_id,attempt_id,http_operation_id,resolution,evidence,previous_generation)
    VALUES(p_signal_id,v_op.attempt_id,p_http_id,'http_recovered',p_evidence,v_old);
  INSERT INTO public.kora_records(collection,id,data) VALUES(
    'audit','aud_a43_http_'||v_op.attempt_id,
    jsonb_build_object('id','aud_a43_http_'||v_op.attempt_id,
      'at',v_at,'actor',p_evidence->>'operator','action','article_generation.http_recovered',
      'entity','signal','entityId',p_signal_id,
      'details',jsonb_build_object('attemptId',v_op.attempt_id,'articleId',v_article->>'id',
        'httpOperationId',p_http_id,'reference',p_evidence->>'reference',
        'sha256',p_evidence->>'sha256')::text));
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.kora_article_generation_reserve_linked(uuid,jsonb,jsonb,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kora_article_generation_reserve_linked(uuid,jsonb,jsonb,text)
  TO service_role;
REVOKE ALL ON FUNCTION public.kora_article_generation_admin_close_not_sent(text,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.kora_article_generation_admin_recover_http(text,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

-- Recover existing HTTP intents without losing actor/route/fingerprint checks.
CREATE OR REPLACE FUNCTION public.kora_http_idempotency_begin(
  p_id text, p_workspace text, p_actor text, p_route text, p_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = '' SET lock_timeout = '3s' SET statement_timeout = '15s'
AS $$
DECLARE v_data jsonb; v_inserted integer;
BEGIN
  IF p_id IS NULL OR p_id !~ '^[a-f0-9]{64}$'
     OR p_workspace IS DISTINCT FROM 'kora'
     OR p_actor IS NULL OR length(p_actor) < 1 OR length(p_actor) > 200
     OR p_route IS NULL OR length(p_route) < 3 OR length(p_route) > 300
     OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$'
  THEN RAISE EXCEPTION 'invalid HTTP idempotency claim'; END IF;
  INSERT INTO public.kora_records(collection,id,data)
  VALUES ('http_idempotency',p_id,jsonb_build_object(
    'id',p_id,'workspaceId',p_workspace,'actorId',p_actor,'route',p_route,
    'fingerprint',p_fingerprint,'state','pending',
    'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )) ON CONFLICT (collection,id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 1 THEN RETURN jsonb_build_object('kind','claimed'); END IF;
  SELECT data INTO STRICT v_data FROM public.kora_records
   WHERE collection='http_idempotency' AND id=p_id FOR UPDATE;
  IF v_data->>'workspaceId' IS DISTINCT FROM p_workspace
     OR v_data->>'actorId' IS DISTINCT FROM p_actor
     OR v_data->>'route' IS DISTINCT FROM p_route
     OR v_data->>'fingerprint' IS DISTINCT FROM p_fingerprint
  THEN RETURN jsonb_build_object('kind','conflict'); END IF;
  IF v_data->>'state' = 'completed' THEN
    RETURN jsonb_build_object('kind','completed','status',v_data->'httpStatus',
      'bodyText',v_data->'bodyText');
  END IF;
  IF v_data->>'state' = 'closed_not_sent' THEN
    RETURN jsonb_build_object('kind','closed_not_sent');
  END IF;
  IF v_data->>'state' = 'recovered_completed' THEN
    RETURN jsonb_build_object('kind','recovered_completed',
      'articleId',v_data->>'articleId');
  END IF;
  IF v_data->>'state' = 'pending' THEN
    RETURN jsonb_build_object('kind','pending');
  END IF;
  RETURN jsonb_build_object('kind','uncertain');
END;
$$;


REVOKE ALL ON FUNCTION public.kora_http_idempotency_begin(text,text,text,text,text)
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kora_http_idempotency_begin(text,text,text,text,text)
 TO service_role;
 THEN
    RAISE EXCEPTION 'invalid HTTP association';
  END IF;
  SELECT data INTO STRICT v_http FROM public.kora_records
    WHERE collection='http_idempotency' AND id=p_http_id FOR UPDATE;
  IF v_http->>'state' IS DISTINCT FROM 'pending'
     OR v_http->>'workspaceId' IS DISTINCT FROM 'kora'
     OR v_http->>'route' IS DISTINCT FROM 'POST /articles'
  THEN RAISE EXCEPTION 'invalid HTTP operation state'; END IF;
  IF EXISTS (SELECT 1 FROM public.kora_article_generations WHERE http_operation_id=p_http_id)
    OR EXISTS (SELECT 1 FROM public.kora_article_generation_recoveries
      WHERE http_operation_id=p_http_id) THEN
    RAISE EXCEPTION 'HTTP operation already linked';
  END IF;
  v_result := public.kora_article_generation_reserve(p_token,p_signal,p_attempt);
  IF v_result->>'ok' = 'true' THEN
    UPDATE public.kora_article_generations SET http_operation_id=p_http_id
      WHERE signal_id=p_signal->>'id' AND token=p_token;
    IF NOT FOUND THEN RAISE EXCEPTION 'linked reservation missing'; END IF;
  END IF;
  RETURN v_result;
END;
$$;

-- Evidence is an audit reference, not a claim that SHA-256 content was externally verified.
CREATE FUNCTION public.kora_article_recovery_check_evidence(p_evidence jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_checked timestamptz;
BEGIN
  IF jsonb_typeof(p_evidence) IS DISTINCT FROM 'object'
    OR p_evidence->>'source' NOT IN ('runtime_process_audit','provider_support_confirmation')
    OR length(btrim(COALESCE(p_evidence->>'reference',''))) NOT BETWEEN 6 AND 256
    OR length(btrim(COALESCE(p_evidence->>'operator',''))) NOT BETWEEN 3 AND 128
    OR COALESCE(p_evidence->>'sha256','') !~ '^[a-f0-9]{64}$'
    OR COALESCE(p_evidence->>'checkedAt','') !~
      '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
  THEN RAISE EXCEPTION 'incomplete A4.3 recovery evidence'; END IF;
  v_checked := (p_evidence->>'checkedAt')::timestamptz;
  IF v_checked > clock_timestamp() + interval '5 minutes'
    THEN RAISE EXCEPTION 'future recovery evidence'; END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.kora_article_recovery_check_evidence(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.kora_article_generation_admin_close_not_sent(
  p_signal_id text, p_http_id text, p_evidence jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
SET lock_timeout = '3s' SET statement_timeout = '20s' AS $$
DECLARE v_op public.kora_article_generations; v_http jsonb; v_attempt jsonb;
  v_settings jsonb; v_old jsonb; v_archive public.kora_article_generation_recoveries;
  v_at text; v_budget numeric; v_estimate numeric;
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'DBA only'; END IF;
  PERFORM public.kora_article_recovery_check_evidence(p_evidence);
  -- The linked reservation locks HTTP first; preserve this order to avoid deadlocks.
  SELECT data INTO STRICT v_http FROM public.kora_records
    WHERE collection='http_idempotency' AND id=p_http_id FOR UPDATE;
  -- Serialize financial transitions with kora_paid_finish / reserve.
  SELECT data INTO STRICT v_settings FROM public.kora_settings
    WHERE workspace_id='kora' FOR UPDATE;
  SELECT * INTO v_archive FROM public.kora_article_generation_recoveries
    WHERE signal_id=p_signal_id AND http_operation_id=p_http_id AND resolution='not_sent';
  IF FOUND THEN
    IF v_archive.evidence = p_evidence THEN RETURN true; END IF;
    RAISE EXCEPTION 'conflicting recovery replay';
  END IF;
  SELECT * INTO STRICT v_op FROM public.kora_article_generations
    WHERE signal_id=p_signal_id FOR UPDATE;
  IF v_op.http_operation_id IS DISTINCT FROM p_http_id OR v_op.state <> 'reserved'
     OR v_op.article_payload IS NOT NULL THEN
    RAISE EXCEPTION 'generation was not proven unsent'; END IF;
  SELECT data INTO STRICT v_http FROM public.kora_records
    WHERE collection='http_idempotency' AND id=p_http_id FOR UPDATE;
  IF v_http->>'state' IS DISTINCT FROM 'pending'
     OR v_http->>'route' IS DISTINCT FROM 'POST /articles'
     OR v_http->>'workspaceId' IS DISTINCT FROM 'kora'
  THEN RAISE EXCEPTION 'HTTP operation mismatch'; END IF;
  SELECT data INTO STRICT v_attempt FROM public.kora_records
    WHERE collection='paid_attempts' AND id=v_op.attempt_id FOR UPDATE;
  IF v_attempt->>'status' IS DISTINCT FROM 'reserved'
    OR v_attempt->>'workspaceId' IS DISTINCT FROM 'kora'
    OR v_attempt->>'kind' IS DISTINCT FROM 'generation_article'
  THEN RAISE EXCEPTION 'paid work might have been started'; END IF;
  IF EXISTS (SELECT 1 FROM public.kora_records
    WHERE collection='articles' AND data->>'signalId'=p_signal_id)
  THEN RAISE EXCEPTION 'article already exists'; END IF;

  v_estimate := (v_attempt->>'estimateEur')::numeric;
  v_budget := (v_settings->>'reservedEur')::numeric;
  IF v_estimate IS NULL OR v_estimate <= 0 OR v_budget < v_estimate
    THEN RAISE EXCEPTION 'inconsistent reserved budget'; END IF;
  v_at := to_char(clock_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z');
  v_old := jsonb_build_object('state',v_op.state,'token',v_op.token,
    'attemptId',v_op.attempt_id,'httpOperationId',v_op.http_operation_id);
  -- Tombstone prevents original key replay, but a verified fresh intent may run.
  UPDATE public.kora_records SET data=v_attempt || jsonb_build_object(
    'status','not_sent','billingStatus','not_charged',
    'usageLines','[]'::jsonb,'completedAt',v_at),updated_at=clock_timestamp()
    WHERE collection='paid_attempts' AND id=v_op.attempt_id;
  UPDATE public.kora_settings SET data=jsonb_set(v_settings,'{reservedEur}',
    to_jsonb(round(v_budget-v_estimate,4))),updated_at=clock_timestamp()
    WHERE workspace_id='kora';
  UPDATE public.kora_records SET data=v_http || jsonb_build_object(
    'state','closed_not_sent','markedAt',v_at),updated_at=clock_timestamp()
    WHERE collection='http_idempotency' AND id=p_http_id;
  INSERT INTO public.kora_article_generation_recoveries(
    signal_id,attempt_id,http_operation_id,resolution,evidence,previous_generation)
    VALUES(p_signal_id,v_op.attempt_id,p_http_id,'not_sent',p_evidence,v_old);
  DELETE FROM public.kora_article_generations
    WHERE signal_id=p_signal_id AND token=v_op.token;
  INSERT INTO public.kora_records(collection,id,data) VALUES(
    'audit','aud_a43_close_'||v_op.attempt_id,
    jsonb_build_object('id','aud_a43_close_'||v_op.attempt_id,
      'at',v_at,'actor',p_evidence->>'operator','action','article_generation.recovery_not_sent',
      'entity','signal','entityId',p_signal_id,
      'details',jsonb_build_object('attemptId',v_op.attempt_id,'httpOperationId',p_http_id,
        'reference',p_evidence->>'reference','sha256',p_evidence->>'sha256')::text));
  RETURN true;
END;
$$;

CREATE FUNCTION public.kora_article_generation_admin_recover_http(
  p_signal_id text, p_http_id text, p_evidence jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
SET lock_timeout = '3s' SET statement_timeout = '20s' AS $$
DECLARE v_op public.kora_article_generations; v_http jsonb; v_article jsonb;
 v_signal jsonb; v_attempt jsonb; v_old jsonb; v_at text;
 v_archive public.kora_article_generation_recoveries;
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'DBA only'; END IF;
  PERFORM public.kora_article_recovery_check_evidence(p_evidence);
  SELECT data INTO STRICT v_http FROM public.kora_records
    WHERE collection='http_idempotency' AND id=p_http_id FOR UPDATE;
  SELECT * INTO STRICT v_op FROM public.kora_article_generations
    WHERE signal_id=p_signal_id FOR UPDATE;
  IF v_op.http_operation_id IS DISTINCT FROM p_http_id OR v_op.state <> 'completed'
    OR v_op.article_payload IS NULL THEN RAISE EXCEPTION 'generation not completed'; END IF;
  SELECT * INTO v_archive FROM public.kora_article_generation_recoveries
    WHERE http_operation_id=p_http_id;
  IF FOUND THEN
    IF v_archive.signal_id=p_signal_id AND v_archive.resolution='http_recovered'
      AND v_archive.evidence=p_evidence
      AND v_http->>'state'='recovered_completed' THEN RETURN true; END IF;
    RAISE EXCEPTION 'conflicting HTTP recovery replay';
  END IF;
  IF v_http->>'state' NOT IN ('pending','uncertain')
    OR v_http->>'workspaceId' IS DISTINCT FROM 'kora'
    OR v_http->>'route' IS DISTINCT FROM 'POST /articles'
  THEN RAISE EXCEPTION 'HTTP operation not recoverable'; END IF;
  SELECT data INTO STRICT v_signal FROM public.kora_records
    WHERE collection='signals' AND id=p_signal_id FOR UPDATE;
  SELECT data INTO STRICT v_article FROM public.kora_records
    WHERE collection='articles' AND id=v_op.article_payload->>'id' FOR UPDATE;
  SELECT data INTO STRICT v_attempt FROM public.kora_records
    WHERE collection='paid_attempts' AND id=v_op.attempt_id FOR UPDATE;
  IF v_article->>'signalId' IS DISTINCT FROM p_signal_id
    OR v_signal->>'articleId' IS DISTINCT FROM v_article->>'id'
    OR v_attempt->>'status' NOT IN ('settled','reconciled_billed','reconciled_not_billed','unknown')
    THEN RAISE EXCEPTION 'completed article/accounting mismatch'; END IF;
  v_at := to_char(clock_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z');
  v_old := jsonb_build_object('state',v_op.state,'token',v_op.token,
    'attemptId',v_op.attempt_id,'httpOperationId',v_op.http_operation_id,
    'articleId',v_article->>'id');
  UPDATE public.kora_records SET data=v_http || jsonb_build_object(
    'state','recovered_completed','articleId',v_article->>'id','markedAt',v_at),
    updated_at=clock_timestamp()
    WHERE collection='http_idempotency' AND id=p_http_id;
  INSERT INTO public.kora_article_generation_recoveries(
    signal_id,attempt_id,http_operation_id,resolution,evidence,previous_generation)
    VALUES(p_signal_id,v_op.attempt_id,p_http_id,'http_recovered',p_evidence,v_old);
  INSERT INTO public.kora_records(collection,id,data) VALUES(
    'audit','aud_a43_http_'||v_op.attempt_id,
    jsonb_build_object('id','aud_a43_http_'||v_op.attempt_id,
      'at',v_at,'actor',p_evidence->>'operator','action','article_generation.http_recovered',
      'entity','signal','entityId',p_signal_id,
      'details',jsonb_build_object('attemptId',v_op.attempt_id,'articleId',v_article->>'id',
        'httpOperationId',p_http_id,'reference',p_evidence->>'reference',
        'sha256',p_evidence->>'sha256')::text));
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.kora_article_generation_reserve_linked(uuid,jsonb,jsonb,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kora_article_generation_reserve_linked(uuid,jsonb,jsonb,text)
  TO service_role;
REVOKE ALL ON FUNCTION public.kora_article_generation_admin_close_not_sent(text,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.kora_article_generation_admin_recover_http(text,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

-- Recover existing HTTP intents without losing actor/route/fingerprint checks.
CREATE OR REPLACE FUNCTION public.kora_http_idempotency_begin(
  p_id text, p_workspace text, p_actor text, p_route text, p_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = '' SET lock_timeout = '3s' SET statement_timeout = '15s'
AS $$
DECLARE v_data jsonb; v_inserted integer;
BEGIN
  IF p_id IS NULL OR p_id !~ '^[a-f0-9]{64}$'
     OR p_workspace IS DISTINCT FROM 'kora'
     OR p_actor IS NULL OR length(p_actor) < 1 OR length(p_actor) > 200
     OR p_route IS NULL OR length(p_route) < 3 OR length(p_route) > 300
     OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$'
  THEN RAISE EXCEPTION 'invalid HTTP idempotency claim'; END IF;
  INSERT INTO public.kora_records(collection,id,data)
  VALUES ('http_idempotency',p_id,jsonb_build_object(
    'id',p_id,'workspaceId',p_workspace,'actorId',p_actor,'route',p_route,
    'fingerprint',p_fingerprint,'state','pending',
    'createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )) ON CONFLICT (collection,id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 1 THEN RETURN jsonb_build_object('kind','claimed'); END IF;
  SELECT data INTO STRICT v_data FROM public.kora_records
   WHERE collection='http_idempotency' AND id=p_id FOR UPDATE;
  IF v_data->>'workspaceId' IS DISTINCT FROM p_workspace
     OR v_data->>'actorId' IS DISTINCT FROM p_actor
     OR v_data->>'route' IS DISTINCT FROM p_route
     OR v_data->>'fingerprint' IS DISTINCT FROM p_fingerprint
  THEN RETURN jsonb_build_object('kind','conflict'); END IF;
  IF v_data->>'state' = 'completed' THEN
    RETURN jsonb_build_object('kind','completed','status',v_data->'httpStatus',
      'bodyText',v_data->'bodyText');
  END IF;
  IF v_data->>'state' = 'closed_not_sent' THEN
    RETURN jsonb_build_object('kind','closed_not_sent');
  END IF;
  IF v_data->>'state' = 'recovered_completed' THEN
    RETURN jsonb_build_object('kind','recovered_completed',
      'articleId',v_data->>'articleId');
  END IF;
  IF v_data->>'state' = 'pending' THEN
    RETURN jsonb_build_object('kind','pending');
  END IF;
  RETURN jsonb_build_object('kind','uncertain');
END;
$$;


REVOKE ALL ON FUNCTION public.kora_http_idempotency_begin(text,text,text,text,text)
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kora_http_idempotency_begin(text,text,text,text,text)
 TO service_role;
