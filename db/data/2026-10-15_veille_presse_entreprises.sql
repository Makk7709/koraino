-- Veille presse (Google News + Perplexity) pour chaque entreprise qui n'en a pas encore.
-- L'application crée cette source à l'ajout d'une entreprise ; les entreprises importées par
-- script (registre Inovallée du 12/10/2026) ne l'ont pas reçue. Rejouable sans effet.
BEGIN;
WITH missing AS (
  SELECT c.id AS company_id, c.data->>'name' AS name
  FROM public.kora_records c
  WHERE c.collection = 'companies'
    AND NOT EXISTS (
      SELECT 1 FROM public.kora_records s
      WHERE s.collection = 'sources'
        AND s.data->>'companyId' = c.id
        AND s.data->>'type' = 'recherche_web'
    )
),
prepared AS (
  SELECT
    company_id,
    name,
    'src_' || regexp_replace(company_id, '^co_', '') || '_presse' AS source_id,
    -- Même URL que googleNewsUrl() : nom entre guillemets, encodé comme encodeURIComponent.
    'https://news.google.com/rss/search?q=' || (
      SELECT string_agg(
        CASE WHEN ch ~ '^[A-Za-z0-9_.!~*''()-]$' THEN ch
             ELSE regexp_replace(upper(encode(convert_to(ch, 'UTF8'), 'hex')), '(..)', '%\1', 'g')
        END, '' ORDER BY n)
      FROM regexp_split_to_table('"' || name || '"', '') WITH ORDINALITY AS t(ch, n)
    ) || '&hl=fr&gl=FR&ceid=FR:fr' AS url
  FROM missing
),
inserted AS (
  INSERT INTO public.kora_records (collection, id, data)
  SELECT 'sources', source_id, jsonb_build_object(
    'id', source_id,
    'companyId', company_id,
    'type', 'recherche_web',
    'label', 'Google News — ' || name,
    'url', url,
    'frequency', 'quotidienne',
    'access', 'en_attente',
    'lastRunAt', null,
    'lastSuccessAt', null,
    'failureCode', null,
    'failureReason', null,
    'attempts', 0,
    'createdAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'runCount', 0,
    'simulation', jsonb_build_object('mode', 'auto')
  )
  FROM prepared
  ON CONFLICT (collection, id) DO NOTHING
  RETURNING id, data
)
INSERT INTO public.kora_records (collection, id, data)
SELECT 'audit', 'aud_' || i.id, jsonb_build_object(
  'id', 'aud_' || i.id,
  'at', i.data->>'createdAt',
  'actor', 'KORA',
  'action', 'source.create',
  'entity', 'source',
  'entityId', i.id,
  'details', p.name || ' — ' || (i.data->>'label') || ' (' || (i.data->>'url') || ')'
)
FROM inserted i
JOIN prepared p ON p.source_id = i.id
ON CONFLICT (collection, id) DO NOTHING;
COMMIT;
