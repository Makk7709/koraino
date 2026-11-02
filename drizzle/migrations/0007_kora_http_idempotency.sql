-- A3.1: durable fail-closed idempotency for HTTP operations potentially invoking paid AI.
-- Uses the existing kora_records PK; no existing rows or migrations are rewritten.
-- An uncertain operation is NEVER automatically retried or purged by a TTL.
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
  IF v_data->>'state' = 'pending' THEN
    RETURN jsonb_build_object('kind','pending');
  END IF;
  RETURN jsonb_build_object('kind','uncertain');
END;
$$;

CREATE OR REPLACE FUNCTION public.kora_http_idempotency_complete(
  p_id text, p_status integer, p_body text
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER
SET search_path = '' SET lock_timeout = '3s' SET statement_timeout = '15s'
AS $$
DECLARE v_data jsonb;
BEGIN
  IF p_id IS NULL OR p_id !~ '^[a-f0-9]{64}$'
     OR p_status IS NULL OR p_status < 200 OR p_status > 299
     OR p_body IS NULL OR octet_length(p_body) > 131072
  THEN RAISE EXCEPTION 'invalid HTTP idempotency completion'; END IF;
  SELECT data INTO STRICT v_data FROM public.kora_records
   WHERE collection='http_idempotency' AND id=p_id FOR UPDATE;
  IF v_data->>'state' = 'completed' THEN
    IF (v_data->>'httpStatus')::integer = p_status
       AND v_data->>'bodyText' = p_body THEN RETURN true; END IF;
    RAISE EXCEPTION 'conflicting HTTP completion replay';
  END IF;
  IF v_data->>'state' IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'HTTP operation not pending';
  END IF;
  UPDATE public.kora_records SET data = v_data || jsonb_build_object(
    'state','completed','httpStatus',p_status,'bodyText',p_body,
    'completedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ), updated_at=clock_timestamp()
  WHERE collection='http_idempotency' AND id=p_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.kora_http_idempotency_uncertain(p_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER
SET search_path = '' SET lock_timeout = '3s' SET statement_timeout = '15s'
AS $$
DECLARE v_data jsonb;
BEGIN
  SELECT data INTO STRICT v_data FROM public.kora_records
   WHERE collection='http_idempotency' AND id=p_id FOR UPDATE;
  IF v_data->>'state' = 'uncertain' THEN RETURN true; END IF;
  IF v_data->>'state' IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'cannot change completed HTTP operation';
  END IF;
  UPDATE public.kora_records SET data = v_data || jsonb_build_object(
    'state','uncertain',
    'markedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ), updated_at=clock_timestamp()
  WHERE collection='http_idempotency' AND id=p_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.kora_http_idempotency_begin(text,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kora_http_idempotency_complete(text,integer,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kora_http_idempotency_uncertain(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kora_http_idempotency_begin(text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.kora_http_idempotency_complete(text,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.kora_http_idempotency_uncertain(text) TO service_role;
