-- Registre du pilote Inovallée : alias des entreprises et sources « Site officiel » sans flux.
--
-- 1. Alias. Depuis le 26/10/2026, la collecte interroge Google News et Perplexity sur le nom
--    courant ET les alias (« "Bertin Alpao" OR "Alpao" »). Les noms ci-dessous sont ceux que la
--    presse emploie ; ils sont ajoutés s'ils manquent, sans doublon (comparaison sans casse).
--    À compléter avec Inovallée : un alias trop court ou trop courant (« Allegro », « Roseau »,
--    « Yona ») rattacherait des articles étrangers à l'entreprise, d'où une liste prudente.
-- 2. Sources sans flux. Douze pages d'accueil « Site officiel » n'annoncent aucun flux RSS ni
--    Atom (constat du 15/10/2026, anomalie P2-55). Depuis le 26/10/2026, une telle page est un
--    échec définitif `NO_FEED`, visible dans l'encadré des sources en échec, après essai des
--    adresses habituelles (/feed/, /rss, /feed.xml, /rss.xml). Ce script les passe dans cet état
--    dès maintenant, sans notification, pour que le registre dise la vérité avant la prochaine
--    collecte ; « Réessayer » les remettra en « OK » si une de ces adresses répond, sinon il
--    faut indiquer l'adresse d'un flux ou d'une page d'actualités (PATCH /api/sources/:id).
-- Rejouable sans effet.
BEGIN;

-- 1. Alias --------------------------------------------------------------------------------------
WITH wanted(company_id, name, alias) AS (
  VALUES
    ('co_dolphin_semiconductor', 'Dolphin Semiconductor', 'Dolphin Design'),
    ('co_nanoxplore_design_services', 'NanoXplore Design Services', 'NanoXplore'),
    ('co_naver_labs_europe', 'Naver Labs Europe', 'Naver Labs'),
    ('co_blue_ortho', 'Blue Ortho', 'BlueOrtho'),
    ('co_cedrat_technologies', 'Cedrat Technologies', 'CTEC')
),
targets AS (
  SELECT c.id, c.data,
         (SELECT jsonb_agg(w.alias ORDER BY w.alias)
            FROM wanted w
           WHERE (w.company_id = c.id OR lower(w.name) = lower(c.data->>'name'))
             AND NOT EXISTS (
               SELECT 1 FROM jsonb_array_elements_text(coalesce(c.data->'aliases', '[]'::jsonb)) a
                WHERE lower(a) = lower(w.alias))) AS missing
    FROM public.kora_records c
   WHERE c.collection = 'companies'
),
updated AS (
  UPDATE public.kora_records c
     SET data = jsonb_set(c.data, '{aliases}', coalesce(c.data->'aliases', '[]'::jsonb) || t.missing),
         updated_at = now()
    FROM targets t
   WHERE c.collection = 'companies' AND c.id = t.id AND t.missing IS NOT NULL
  RETURNING c.id, c.data->>'name' AS name, t.missing
)
INSERT INTO public.kora_records (collection, id, data)
SELECT 'audit', 'aud_alias_' || u.id || '_' || md5(u.missing::text), jsonb_build_object(
  'id', 'aud_alias_' || u.id || '_' || md5(u.missing::text),
  'at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'actor', 'KORA',
  'action', 'company.update',
  'entity', 'company',
  'entityId', u.id,
  'details', u.name || ' — alias ajoutés : ' || (SELECT string_agg(a, ', ') FROM jsonb_array_elements_text(u.missing) a)
)
FROM updated u
ON CONFLICT (collection, id) DO NOTHING;

-- 2. Sources « Site officiel » sans flux ------------------------------------------------------------
WITH no_feed(source_id) AS (
  VALUES
    ('src_anatoscope_site'), ('src_arturia_site'), ('src_cedrat_technologies_site'),
    ('src_enwires_site'), ('src_erplain_site'), ('src_nanoxplore_design_services_site'),
    ('src_neoveli_site'), ('src_probayes_site'), ('src_talnia_site'),
    ('src_technidata_site'), ('src_visioglobe_site'), ('src_yona_robotics_site')
),
flagged AS (
  UPDATE public.kora_records s
     SET data = s.data || jsonb_build_object(
           'access', 'erreur',
           'failureCode', 'NO_FEED',
           'failureReason', 'Aucun flux RSS annoncé sur cette page, ni aux adresses habituelles (/feed/, /rss, /feed.xml, /rss.xml) : rien à collecter. Indiquez l''adresse du flux ou d''une page d''actualités.',
           'attempts', 1
         ),
         updated_at = now()
   WHERE s.collection = 'sources'
     AND s.id IN (SELECT source_id FROM no_feed)
     AND s.data->>'type' = 'site_officiel'
     AND s.data->>'access' IN ('ok', 'en_attente')
     AND s.data->>'failureCode' IS DISTINCT FROM 'NO_FEED'
  RETURNING s.id, s.data->>'label' AS label, s.data->>'url' AS url
)
INSERT INTO public.kora_records (collection, id, data)
SELECT 'audit', 'aud_nofeed_' || f.id, jsonb_build_object(
  'id', 'aud_nofeed_' || f.id,
  'at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'actor', 'KORA',
  'action', 'source.update',
  'entity', 'source',
  'entityId', f.id,
  'details', f.label || ' (' || f.url || ') — page sans flux RSS : source marquée en échec NO_FEED, adresse à corriger'
)
FROM flagged f
ON CONFLICT (collection, id) DO NOTHING;

COMMIT;

-- Vérification (lecture seule) :
--   SELECT data->>'name' AS entreprise, data->'aliases' AS alias
--     FROM public.kora_records WHERE collection = 'companies' ORDER BY 1;
--   SELECT id, data->>'access' AS acces, data->>'failureCode' AS code
--     FROM public.kora_records WHERE collection = 'sources' AND data->>'type' = 'site_officiel' ORDER BY 1;
