-- P0-01: deploy with the matching API/UI, after A4.3, on an isolated copy first.
-- Historical duplicates deliberately STOP migration; never delete evidence automatically.
-- PT409 is a terminal business conflict. Never raise 40001 here: PostgREST 14
-- treats serialization_failure as transient and can retry stale revisions indefinitely.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.kora_records WHERE collection='publications'
    AND data->>'channel'='newsletter'
    GROUP BY data->>'newsletterId', (data->>'version')::bigint HAVING count(*) > 1)
  THEN RAISE EXCEPTION 'Duplicate historical newsletter exports: reconcile before migration'; END IF;
END $$;

CREATE UNIQUE INDEX kora_newsletter_export_once ON public.kora_records
  ((data->>'newsletterId'), ((data->>'version')::bigint))
  WHERE collection='publications' AND data->>'channel'='newsletter';

-- This trigger also covers newsletter updates through the A4.2 signal transaction.
-- No application-settable GUC bypasses it. A lease expiration grants no write privilege.
CREATE FUNCTION public.kora_newsletter_write_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b jsonb; a jsonb; f text; v_changed boolean;
BEGIN
  IF (TG_OP <> 'INSERT' AND (OLD.collection='newsletters' OR
      (OLD.collection='publications' AND OLD.data->>'channel'='newsletter')))
     OR (TG_OP <> 'DELETE' AND (NEW.collection='newsletters' OR
      (NEW.collection='publications' AND NEW.data->>'channel'='newsletter'))) THEN
    IF current_user <> 'postgres' THEN
      RAISE LOG '%', jsonb_build_object('event','kora.newsletter.direct_write_denied','operation',TG_OP);
      RAISE EXCEPTION 'Newsletter writes require controlled RPC' USING ERRCODE='42501';
    END IF;
    IF TG_OP='DELETE' THEN
      RAISE EXCEPTION 'Newsletter and export deletion is forbidden';
    END IF;
    IF TG_OP='UPDATE' AND (NEW.collection IS DISTINCT FROM OLD.collection OR NEW.id IS DISTINCT FROM OLD.id) THEN
      RAISE EXCEPTION 'Newsletter identity is immutable';
    END IF;
    IF TG_OP='UPDATE' AND OLD.collection='publications' THEN
      RAISE EXCEPTION 'Newsletter exports are immutable';
    END IF;
  END IF;
  IF TG_OP='UPDATE' AND OLD.collection='newsletters' THEN
    b := OLD.data; a := NEW.data;
    IF b->>'status'='exportee' OR a->>'id' IS DISTINCT FROM OLD.id
      OR jsonb_typeof(a->'revision') IS DISTINCT FROM 'number'
      OR (a->>'revision')::numeric > 9007199254740991
      OR jsonb_typeof(a->'version') IS DISTINCT FROM 'number'
      OR (a->>'version')::numeric < 1 OR (a->>'version')::numeric > 9007199254740991
      OR (a->>'version')::numeric <> trunc((a->>'version')::numeric)
      OR (a->>'revision')::numeric <> COALESCE((b->>'revision')::numeric,0)+1
    THEN RAISE EXCEPTION 'Newsletter state changed' USING ERRCODE='PT409'; END IF;
    IF a->>'createdAt' IS DISTINCT FROM b->>'createdAt' OR a->>'createdBy' IS DISTINCT FROM b->>'createdBy' THEN
      RAISE EXCEPTION 'Newsletter creation metadata is immutable';
    END IF;
    v_changed := (a->'title',a->'intro',a->'items',a->'weekOf',a->'scheduledFor')
      IS DISTINCT FROM (b->'title',b->'intro',b->'items',b->'weekOf',b->'scheduledFor');
    IF jsonb_typeof(a->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(a->'items') > 100 THEN
      RAISE EXCEPTION 'Invalid newsletter items';
    END IF;
    IF v_changed THEN
      IF (a->>'version')::numeric IS DISTINCT FROM (b->>'version')::numeric+1
        OR a->>'status' IS DISTINCT FROM 'composition'
        OR COALESCE((a#>>'{approval,valid}')::boolean,false)
      THEN RAISE EXCEPTION 'Newsletter edits must invalidate approval'; END IF;
    ELSE
      IF a->'version' IS DISTINCT FROM b->'version' OR jsonb_array_length(a->'items')=0
        OR a#>>'{approval,valid}' IS DISTINCT FROM 'true'
        OR a#>'{approval,version}' IS DISTINCT FROM a->'version'
        OR a#>>'{approval,channel}' IS DISTINCT FROM 'newsletter'
        OR COALESCE(a->>'status','') NOT IN ('approuvee','exportee')
      THEN RAISE EXCEPTION 'Invalid newsletter decision'; END IF;
      IF a->>'status'='exportee' AND (b->>'status' IS DISTINCT FROM 'approuvee' OR a->'approval' IS DISTINCT FROM b->'approval') THEN
        RAISE EXCEPTION 'Export requires current approval';
      END IF;
    END IF;
    FOREACH f IN ARRAY ARRAY['id','signalId','articleId'] LOOP
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(a->'items') i
        WHERE COALESCE(i->>f,'') <> '' GROUP BY i->>f HAVING count(*)>1)
      THEN RAISE EXCEPTION 'Duplicate newsletter subject'; END IF;
    END LOOP;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION public.kora_newsletter_write_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.kora_newsletter_write_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER kora_01_newsletter_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.kora_records
  FOR EACH ROW EXECUTE FUNCTION public.kora_newsletter_write_guard();

CREATE FUNCTION public.kora_newsletter_commit(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
SET lock_timeout='3s' SET statement_timeout='15s' AS $$
DECLARE
  b jsonb := p_input->'before'; a jsonb := p_input->'after';
  e jsonb := p_input->'audit'; p jsonb := p_input->'publication';
  v_current jsonb; v_id text := a->>'id';
BEGIN
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR pg_column_size(p_input)>1048576
    OR NOT (p_input ?& ARRAY['before','after','audit','publication'])
    OR jsonb_typeof(b) NOT IN ('object','null') OR jsonb_typeof(a) IS DISTINCT FROM 'object'
    OR jsonb_typeof(e) IS DISTINCT FROM 'object' OR jsonb_typeof(p) NOT IN ('object','null')
    OR COALESCE(v_id,'')='' OR length(v_id)>64 OR (b<>'null'::jsonb AND b->>'id' IS DISTINCT FROM v_id)
    OR COALESCE(e->>'id','')='' OR e->>'id' LIKE 'aud_a43_%'
    OR e->>'entity' IS DISTINCT FROM 'newsletter' OR e->>'entityId' IS DISTINCT FROM v_id
    OR COALESCE(e->>'action','') NOT IN ('newsletter.create','newsletter.update','newsletter.item_add',
      'newsletter.item_remove','newsletter.approve','publication.success')
    OR jsonb_typeof(a->'version') IS DISTINCT FROM 'number' OR (a->>'version')::numeric<1
    OR (a->>'version')::numeric>9007199254740991
    OR (a->>'version')::numeric<>trunc((a->>'version')::numeric)
    OR jsonb_typeof(a->'revision') IS DISTINCT FROM 'number' OR (a->>'revision')::numeric<0
    OR (a->>'revision')::numeric>9007199254740991
    OR (a->>'revision')::numeric<>trunc((a->>'revision')::numeric)
  THEN RAISE EXCEPTION 'Invalid newsletter transaction'; END IF;

  -- Same lock key as kora_signal_mutations_commit; the row lock also serializes SQL writes.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('newsletters:'||v_id,0));
  SELECT data INTO v_current FROM public.kora_records WHERE collection='newsletters' AND id=v_id FOR UPDATE;

  -- Exact business export replay: frozen content, same approval/version, no new audit/attempt.
  IF p<>'null'::jsonb AND v_current->>'status'='exportee'
    AND v_current#>>'{approval,valid}'='true'
    AND v_current#>'{approval,version}'=v_current->'version'
    AND (v_current - ARRAY['status','revision','updatedAt'])=(b - ARRAY['status','revision','updatedAt'])
    AND COALESCE((v_current->>'revision')::bigint,0) BETWEEN COALESCE((b->>'revision')::bigint,0) AND COALESCE((b->>'revision')::bigint,0)+1
    AND EXISTS (SELECT 1 FROM public.kora_records WHERE collection='publications'
      AND data->>'channel'='newsletter' AND data->>'newsletterId'=v_id
      AND data->'version'=v_current->'version' AND data->>'status'='succes')
  THEN RETURN v_current; END IF;

  IF (b='null'::jsonb AND v_current IS NOT NULL) OR
    (b<>'null'::jsonb AND v_current IS DISTINCT FROM b)
  THEN
    RAISE LOG '%', jsonb_build_object('event','kora.newsletter.cas_conflict','newsletterId',v_id);
    RAISE EXCEPTION 'Newsletter state changed' USING ERRCODE='PT409';
  END IF;
  IF b='null'::jsonb AND (a->>'version'<>'1' OR a->>'revision'<>'0'
      OR a->>'status' IS DISTINCT FROM 'composition' OR a->'approval' IS DISTINCT FROM 'null'::jsonb
      OR a->'items' IS DISTINCT FROM '[]'::jsonb)
  THEN RAISE EXCEPTION 'Invalid initial newsletter'; END IF;

  IF p<>'null'::jsonb THEN
    -- Revalidate against the locked persistent state, immediately before the export writes.
    IF v_current->>'status' IS DISTINCT FROM 'approuvee'
      OR v_current#>>'{approval,valid}' IS DISTINCT FROM 'true'
      OR v_current#>'{approval,version}' IS DISTINCT FROM v_current->'version'
      OR v_current#>>'{approval,channel}' IS DISTINCT FROM 'newsletter'
      OR a->>'status' IS DISTINCT FROM 'exportee'
      OR COALESCE(p->>'id','')='' OR p->>'newsletterId' IS DISTINCT FROM v_id
      OR p->'version' IS DISTINCT FROM v_current->'version'
      OR p->>'channel' IS DISTINCT FROM 'newsletter' OR p->>'status' IS DISTINCT FROM 'succes'
      OR p->>'mode' IS DISTINCT FROM 'export' OR e->>'action' IS DISTINCT FROM 'publication.success'
    THEN RAISE EXCEPTION 'Invalid or obsolete newsletter export'; END IF;
  ELSIF a->>'status'='exportee' THEN RAISE EXCEPTION 'Missing newsletter export'; END IF;

  IF b='null'::jsonb THEN
    INSERT INTO public.kora_records(collection,id,data) VALUES('newsletters',v_id,a);
  ELSE
    UPDATE public.kora_records SET data=a,updated_at=clock_timestamp() WHERE collection='newsletters' AND id=v_id;
  END IF;
  IF p<>'null'::jsonb THEN
    INSERT INTO public.kora_records(collection,id,data) VALUES('publications',p->>'id',p);
  END IF;
  -- An error here rolls back the newsletter and its export as well.
  INSERT INTO public.kora_records(collection,id,data) VALUES('audit',e->>'id',e);
  RETURN a;
END $$;
ALTER FUNCTION public.kora_newsletter_commit(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.kora_newsletter_commit(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kora_newsletter_commit(jsonb) TO service_role;
