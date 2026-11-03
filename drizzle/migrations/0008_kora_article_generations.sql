-- A4: durable ownership independent of expiring locks and HTTP idempotency keys.
-- Additive migration: keep earlier characterization results and existing data intact.
CREATE TABLE public.kora_article_generations (
  signal_id text PRIMARY KEY,
  token uuid NOT NULL,
  attempt_id text NOT NULL UNIQUE,
  expected_signal jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('reserved', 'in_flight', 'uncertain', 'completed')),
  article_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((state = 'completed') = (article_payload IS NOT NULL))
);
ALTER TABLE public.kora_article_generations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kora_article_generations FROM PUBLIC, anon, authenticated, service_role;
-- No write access, even for the HTTP service role: transitions go through guarded RPCs.
GRANT SELECT ON public.kora_article_generations TO service_role;

CREATE FUNCTION public.kora_article_generation_reserve(p_token uuid, p_signal jsonb, p_attempt jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_signal jsonb;
  v_result jsonb;
BEGIN
  IF p_token IS NULL OR COALESCE(p_signal->>'id', '') = ''
     OR p_attempt->>'workspaceId' IS DISTINCT FROM 'kora'
     OR p_attempt->>'kind' IS DISTINCT FROM 'generation_article' THEN
    RAISE EXCEPTION 'invalid article generation claim';
  END IF;
  -- All contenders serialize on the signal. No lease or client clock is involved.
  SELECT data INTO v_signal FROM public.kora_records
    WHERE collection = 'signals' AND id = p_signal->>'id' FOR UPDATE;
  IF NOT FOUND OR v_signal IS DISTINCT FROM p_signal OR v_signal->>'status' = 'rejete' THEN
    RETURN jsonb_build_object('blocked', 'signal_changed');
  END IF;
  IF EXISTS (SELECT 1 FROM public.kora_records WHERE collection = 'articles'
      AND data->>'signalId' = p_signal->>'id') THEN
    RETURN jsonb_build_object('blocked', 'article_exists');
  END IF;
  IF EXISTS (SELECT 1 FROM public.kora_article_generations WHERE signal_id = p_signal->>'id') THEN
    RETURN jsonb_build_object('blocked', 'busy');
  END IF;
  v_result := public.kora_paid_reserve(p_attempt);
  IF (v_result->>'ok')::boolean IS NOT TRUE THEN RETURN v_result; END IF;
  INSERT INTO public.kora_article_generations(signal_id, token, attempt_id, expected_signal, state)
    VALUES (p_signal->>'id', p_token, p_attempt->>'id', p_signal, 'reserved');
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.kora_article_generation_start(p_signal_id text, p_token uuid, p_attempt_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_op public.kora_article_generations;
BEGIN
  SELECT * INTO STRICT v_op FROM public.kora_article_generations WHERE signal_id = p_signal_id FOR UPDATE;
  IF v_op.token IS DISTINCT FROM p_token OR v_op.attempt_id IS DISTINCT FROM p_attempt_id
     OR v_op.state <> 'reserved' THEN RAISE EXCEPTION 'article generation ownership conflict'; END IF;
  PERFORM public.kora_paid_start(p_attempt_id);
  UPDATE public.kora_article_generations SET state = 'in_flight', updated_at = clock_timestamp()
    WHERE signal_id = p_signal_id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.kora_article_generation_complete(p_signal_id text, p_token uuid, p_article jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_op public.kora_article_generations;
  v_signal jsonb;
  v_attempt jsonb;
BEGIN
  SELECT * INTO STRICT v_op FROM public.kora_article_generations WHERE signal_id = p_signal_id FOR UPDATE;
  IF v_op.token IS DISTINCT FROM p_token THEN RAISE EXCEPTION 'article generation ownership conflict'; END IF;
  -- Exact replay after a lost commit acknowledgement; never overwrite later article edits.
  IF v_op.state = 'completed' THEN
    IF v_op.article_payload = p_article THEN RETURN true; END IF;
    RAISE EXCEPTION 'article generation replay conflict';
  END IF;
  IF v_op.state <> 'in_flight' THEN RAISE EXCEPTION 'article generation not in flight'; END IF;
  IF jsonb_typeof(p_article) IS DISTINCT FROM 'object' OR COALESCE(p_article->>'id', '') = ''
     OR p_article->>'signalId' IS DISTINCT FROM p_signal_id
     OR p_article->>'origin' IS DISTINCT FROM 'kora'
     OR p_article->>'status' IS DISTINCT FROM 'brouillon'
     OR p_article->>'currentVersion' IS DISTINCT FROM '1'
     OR jsonb_typeof(p_article->'versions') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_article->'versions') <> 1
     OR COALESCE(p_article->>'updatedAt', '') = '' THEN
    RAISE EXCEPTION 'invalid generated article';
  END IF;
  SELECT data INTO STRICT v_attempt FROM public.kora_records
    WHERE collection = 'paid_attempts' AND id = v_op.attempt_id FOR UPDATE;
  IF v_attempt->>'status' NOT IN ('settled', 'unknown', 'reconciled_billed', 'reconciled_not_billed') THEN
    RAISE EXCEPTION 'article generation accounting incomplete';
  END IF;
  SELECT data INTO STRICT v_signal FROM public.kora_records
    WHERE collection = 'signals' AND id = p_signal_id FOR UPDATE;
  IF v_signal IS DISTINCT FROM v_op.expected_signal THEN
    RAISE EXCEPTION 'article generation signal changed';
  END IF;
  INSERT INTO public.kora_records(collection, id, data) VALUES ('articles', p_article->>'id', p_article);
  UPDATE public.kora_records SET data = v_signal || jsonb_build_object(
    'articleId', p_article->>'id',
    'status', CASE WHEN v_signal->>'status' = 'traite' THEN 'traite' ELSE 'en_revue' END,
    'updatedAt', p_article->>'updatedAt'), updated_at = clock_timestamp()
    WHERE collection = 'signals' AND id = p_signal_id;
  UPDATE public.kora_article_generations SET state = 'completed', article_payload = p_article,
    updated_at = clock_timestamp() WHERE signal_id = p_signal_id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.kora_article_generation_uncertain(p_signal_id text, p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Failed claims have no owned row; completed rows are immutable. Never unlock on error.
  UPDATE public.kora_article_generations SET state = 'uncertain', updated_at = clock_timestamp()
    WHERE signal_id = p_signal_id AND token = p_token AND state IN ('reserved', 'in_flight');
  RETURN true;
END;
$$;

-- Protect the association against stale generic record updates, including other handlers.
-- Existing duplicates are preserved; any new duplicate is refused under the signal row lock.
CREATE FUNCTION public.kora_article_association_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.collection = 'signals' AND EXISTS (
    SELECT 1 FROM public.kora_article_generations WHERE signal_id = OLD.id AND state = 'completed'
  ) AND (NEW.collection IS DISTINCT FROM OLD.collection OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.data->>'articleId' IS DISTINCT FROM OLD.data->>'articleId') THEN
    RAISE EXCEPTION 'completed article association is immutable';
  END IF;
  IF NEW.collection = 'articles' AND NEW.data->>'signalId' IS NOT NULL THEN
    IF TG_OP = 'INSERT' OR NEW.data->>'signalId' IS DISTINCT FROM OLD.data->>'signalId' THEN
      PERFORM 1 FROM public.kora_records WHERE collection = 'signals' AND id = NEW.data->>'signalId' FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'article signal missing'; END IF;
      IF EXISTS (SELECT 1 FROM public.kora_records WHERE collection = 'articles'
          AND id <> NEW.id AND data->>'signalId' = NEW.data->>'signalId') THEN
        RAISE EXCEPTION 'article already exists for signal';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER kora_article_association_guard BEFORE INSERT OR UPDATE ON public.kora_records
  FOR EACH ROW EXECUTE FUNCTION public.kora_article_association_guard();

REVOKE ALL ON FUNCTION public.kora_article_generation_reserve(uuid,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kora_article_generation_start(text,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kora_article_generation_complete(text,uuid,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kora_article_generation_uncertain(text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kora_article_association_guard() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kora_article_generation_reserve(uuid,jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.kora_article_generation_start(text,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.kora_article_generation_complete(text,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.kora_article_generation_uncertain(text,uuid) TO service_role;
