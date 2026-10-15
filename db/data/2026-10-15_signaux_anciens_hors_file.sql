-- Retire de la file « Nouveau » les signaux dont l'actualité a plus de 30 jours : entrés avant
-- la règle de fraîcheur (collecte du 15/10/2026), ils ne sont pas des nouveautés.
-- Même effet que « Ignorer » dans l'application : statut « Rejeté » avec motif, entrée au journal
-- d'audit ; « Restaurer » les remet en file. Les signaux sans date ne sont pas touchés.
-- Rejouable sans effet.
--
-- Comptage préalable (lecture seule) :
--   SELECT
--     count(*) FILTER (WHERE coalesce(data->>'publishedAt', data->>'eventDate') IS NOT NULL
--       AND coalesce(data->>'publishedAt', data->>'eventDate')::timestamptz < now() - interval '30 days') AS anciens,
--     count(*) FILTER (WHERE coalesce(data->>'publishedAt', data->>'eventDate') IS NULL) AS sans_date,
--     count(*) AS total_nouveau
--   FROM public.kora_records WHERE collection = 'signals' AND data->>'status' = 'nouveau';
BEGIN;
WITH retired AS (
  UPDATE public.kora_records s
  SET data = s.data || jsonb_build_object(
        'status', 'rejete',
        'statusReason', 'Actualité ancienne : publiée il y a plus de 30 jours',
        'updatedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ),
      updated_at = now()
  WHERE s.collection = 'signals'
    AND s.data->>'status' = 'nouveau'
    AND coalesce(s.data->>'publishedAt', s.data->>'eventDate') IS NOT NULL
    AND coalesce(s.data->>'publishedAt', s.data->>'eventDate')::timestamptz < now() - interval '30 days'
  RETURNING s.id, s.data
)
INSERT INTO public.kora_records (collection, id, data)
SELECT 'audit', 'aud_ancien_' || r.id, jsonb_build_object(
  'id', 'aud_ancien_' || r.id,
  'at', r.data->>'updatedAt',
  'actor', 'KORA',
  'action', 'signal.status',
  'entity', 'signal',
  'entityId', r.id,
  'details', 'Nouveau → Rejeté — motif : ' || (r.data->>'statusReason')
)
FROM retired r
ON CONFLICT (collection, id) DO NOTHING;
COMMIT;
