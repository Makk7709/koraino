-- A4.2: isolated PostgreSQL transaction rollback tests. Never execute against production.
BEGIN;
INSERT INTO public.kora_records(collection,id,data) VALUES
('signals','a42-target','{"id":"a42-target","articleId":"a42-art-target","observationIds":[]}'::jsonb),
('signals','a42-source','{"id":"a42-source","articleId":"a42-art-source","observationIds":["a42-observation"]}'::jsonb),
('observations','a42-observation','{"id":"a42-observation","signalId":"a42-source"}'::jsonb),
('articles','a42-art-target','{"id":"a42-art-target","signalId":"a42-target"}'::jsonb),
('articles','a42-art-source','{"id":"a42-art-source","signalId":"a42-source"}'::jsonb);

SET LOCAL ROLE service_role;
DO $$
DECLARE
  changes jsonb;
  before_obs jsonb := '{"id":"a42-observation","signalId":"a42-source"}'::jsonb;
BEGIN
  IF has_function_privilege('anon','public.kora_signal_mutations_commit(jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','public.kora_signal_mutations_commit(jsonb)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.kora_signal_mutations_commit(jsonb)','EXECUTE')
  THEN RAISE EXCEPTION 'A4.2 RPC permissions invalid'; END IF;

  -- The second article update fails, but the preceding observation update must roll back.
  changes := jsonb_build_array(
    jsonb_build_object('collection','observations','id','a42-observation','before',before_obs,
      'after',jsonb_build_object('id','a42-observation','signalId','a42-target')),
    jsonb_build_object('collection','articles','id','a42-art-source',
      'before',jsonb_build_object('id','a42-art-source','signalId','a42-source'),
      'after',jsonb_build_object('id','a42-art-source','signalId','a42-target'))
  );
  BEGIN
    PERFORM public.kora_signal_mutations_commit(changes);
    RAISE EXCEPTION 'TEST duplicate article accepted' USING ERRCODE = 'XX000';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'TEST duplicate article accepted' THEN RAISE; END IF;
  END;
  IF (SELECT data FROM public.kora_records WHERE collection='observations' AND id='a42-observation')
      IS DISTINCT FROM before_obs
  THEN RAISE EXCEPTION 'A4.2 rollback failed after duplicate article'; END IF;

  -- A stale snapshot must abort before writing a single row.
  changes := jsonb_build_array(
    jsonb_build_object('collection','observations','id','a42-observation',
      'before',jsonb_build_object('id','a42-observation','signalId','wrong'),
      'after',jsonb_build_object('id','a42-observation','signalId','a42-target'))
  );
  BEGIN
    PERFORM public.kora_signal_mutations_commit(changes);
    RAISE EXCEPTION 'TEST stale snapshot accepted' USING ERRCODE = 'XX000';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'TEST stale snapshot accepted' THEN RAISE; END IF;
  END;
  IF (SELECT data FROM public.kora_records WHERE collection='observations' AND id='a42-observation')
      IS DISTINCT FROM before_obs
  THEN RAISE EXCEPTION 'A4.2 state changed after stale rejection'; END IF;
END $$;
RESET ROLE;

-- Inject an error after a new signal and an observation have already been written.
CREATE FUNCTION public.a42_test_fail_signal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.collection = 'signals' AND NEW.id = 'a42-source'
    THEN RAISE EXCEPTION 'a42 injected signal update failure'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER a42_test_fail_signal BEFORE UPDATE ON public.kora_records
  FOR EACH ROW EXECUTE FUNCTION public.a42_test_fail_signal();

SET LOCAL ROLE service_role;
DO $$
DECLARE
  changes jsonb;
BEGIN
  changes := jsonb_build_array(
    jsonb_build_object('collection','signals','id','a42-new',
      'before',null,'after',jsonb_build_object('id','a42-new','observationIds',jsonb_build_array('a42-observation'))),
    jsonb_build_object('collection','observations','id','a42-observation',
      'before',jsonb_build_object('id','a42-observation','signalId','a42-source'),
      'after',jsonb_build_object('id','a42-observation','signalId','a42-new')),
    jsonb_build_object('collection','signals','id','a42-source',
      'before',jsonb_build_object('id','a42-source','articleId','a42-art-source','observationIds',jsonb_build_array('a42-observation')),
      'after',jsonb_build_object('id','a42-source','articleId','a42-art-source','observationIds','[]'::jsonb))
  );
  BEGIN
    PERFORM public.kora_signal_mutations_commit(changes);
    RAISE EXCEPTION 'TEST injected failure not raised' USING ERRCODE = 'XX000';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'a42 injected signal update failure' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.kora_records WHERE collection='signals' AND id='a42-new')
    OR (SELECT data->>'signalId' FROM public.kora_records
      WHERE collection='observations' AND id='a42-observation') <> 'a42-source'
  THEN RAISE EXCEPTION 'A4.2 rollback failed after injected error'; END IF;
  RAISE NOTICE 'PASS: A4.2 atomic merge/split rollback, CAS, permissions';
END $$;
RESET ROLE;
ROLLBACK;
