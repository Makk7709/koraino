-- A4.2: atomic signal merge/split mutations, including audit, for a disposable DB first.
-- The generic repository cannot provide a multi-statement transaction via PostgREST.
CREATE FUNCTION public.kora_signal_mutations_commit(p_changes jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_change jsonb;
  v_current jsonb;
  v_found boolean;
  v_collection text;
  v_id text;
  v_before jsonb;
  v_after jsonb;
  v_key text;
  v_keys text[] := ARRAY[]::text[];
  v_signal_id text;
BEGIN
  IF jsonb_typeof(p_changes) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_changes) < 1
     OR jsonb_array_length(p_changes) > 2000 THEN
    RAISE EXCEPTION 'invalid signal transaction size';
  END IF;

  -- Lock all affected rows in a deterministic order, including prospective inserts.
  -- This prevents two A4.2 transactions from racing on an absent record.
  FOR v_key IN
    SELECT DISTINCT (c->>'collection') || ':' || (c->>'id')
    FROM jsonb_array_elements(p_changes) AS c ORDER BY 1
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key, 0));
  END LOOP;
  FOR v_change IN
    SELECT c FROM jsonb_array_elements(p_changes) AS c
    ORDER BY c->>'collection', c->>'id'
  LOOP
    v_collection := v_change->>'collection';
    v_id := v_change->>'id';
    v_before := v_change->'before';
    v_after := v_change->'after';
    IF v_collection NOT IN ('signals','observations','articles','linkedin','newsletters','audit')
       OR COALESCE(v_id,'') = ''
       OR NOT (v_change ? 'before' AND v_change ? 'after')
       OR (v_before IS NOT NULL AND jsonb_typeof(v_before) NOT IN ('object','null'))
       OR (v_after IS NOT NULL AND jsonb_typeof(v_after) NOT IN ('object','null'))
       OR (v_before <> 'null'::jsonb AND v_before->>'id' IS DISTINCT FROM v_id)
       OR (v_after <> 'null'::jsonb AND v_after->>'id' IS DISTINCT FROM v_id)
       OR (v_collection = 'audit' AND (v_before <> 'null'::jsonb OR v_after = 'null'::jsonb))
    THEN RAISE EXCEPTION 'invalid signal mutation'; END IF;

    SELECT data INTO v_current FROM public.kora_records
      WHERE collection = v_collection AND id = v_id FOR UPDATE;
    v_found := FOUND;
    IF (v_before = 'null'::jsonb AND v_found)
       OR (v_before <> 'null'::jsonb AND (NOT v_found OR v_current IS DISTINCT FROM v_before))
    THEN RAISE EXCEPTION 'signal transaction state changed'; END IF;

    -- The durable A4 claim is never moved, erased or re-parented by a merge/split.
    -- In-flight generation is also fenced against all signal modifications.
    IF v_collection = 'signals' AND EXISTS (
      SELECT 1 FROM public.kora_article_generations WHERE signal_id = v_id
    ) THEN RAISE EXCEPTION 'article generation ownership prevents signal mutation'; END IF;
  END LOOP;

  IF (SELECT count(*) FROM jsonb_array_elements(p_changes)) <>
     (SELECT count(DISTINCT c->>'collection' || ':' || c->>'id')
      FROM jsonb_array_elements(p_changes) AS c)
  THEN RAISE EXCEPTION 'duplicate signal transaction row'; END IF;

  -- One PostgreSQL transaction for all mutations. Any trigger/CAS/constraint error
  -- undoes earlier writes, including the audit row.
  FOR v_change IN
    SELECT c FROM jsonb_array_elements(p_changes) AS c ORDER BY
      CASE
        WHEN c->>'collection' = 'signals' AND c->'before' = 'null'::jsonb THEN 0
        WHEN c->>'collection' = 'observations' THEN 1
        WHEN c->>'collection' = 'articles' THEN 2
        WHEN c->>'collection' = 'linkedin' THEN 3
        WHEN c->>'collection' = 'newsletters' THEN 4
        WHEN c->>'collection' = 'signals' AND c->'after' <> 'null'::jsonb THEN 5
        WHEN c->>'collection' = 'audit' THEN 6
        ELSE 9
      END, c->>'collection', c->>'id'
  LOOP
    v_collection := v_change->>'collection';
    v_id := v_change->>'id';
    v_before := v_change->'before';
    v_after := v_change->'after';
    IF v_before = 'null'::jsonb THEN
      INSERT INTO public.kora_records(collection,id,data)
      VALUES(v_collection,v_id,v_after);
    ELSIF v_after = 'null'::jsonb THEN
      DELETE FROM public.kora_records WHERE collection = v_collection AND id = v_id;
    ELSE
      UPDATE public.kora_records SET data = v_after, updated_at = clock_timestamp()
        WHERE collection = v_collection AND id = v_id;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.kora_signal_mutations_commit(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kora_signal_mutations_commit(jsonb) TO service_role;
