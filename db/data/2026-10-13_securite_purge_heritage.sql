-- Purge des données héritées de la période sans authentification (audit sécurité E2, 13/10/2026).
--
-- QUAND : une fois, juste après la mise en production de l'authentification Supabase (branche
-- securite/auth-linkedin et ses correctifs). Rejouable sans danger : les utilisateurs rattachés
-- à un compte Supabase et activés, ainsi que leurs connexions LinkedIn, ne sont jamais touchés
-- (seule exception : la connexion LinkedIn des 4 profils de démo, toujours effacée).
--
-- COMMENT : console Lovable Cloud > Database > SQL editor (ou psql avec un rôle propriétaire),
-- coller le fichier entier et l'exécuter. La transaction applique tout ou rien.
--
-- AVANT : KORA_ADMIN_EMAILS doit contenir l'adresse du premier administrateur réel. Après la
-- purge, il s'amorce à sa première connexion (aucun administrateur actif ne subsiste sinon).
--
-- CE QUI EST SUPPRIMÉ
-- 1. Les 4 utilisateurs de démonstration du seed (u_sophie admin, u_lucas, u_claire, u_marc),
--    uniquement s'ils n'ont jamais été rattachés à un compte Supabase (authUserId vide). Ils
--    apparaissaient « Invitation en attente » (renvoyer l'invitation enverrait un accès à une
--    boîte inconnue) et u_sophie comptait comme administrateur.
--    Aucun autre enregistrement ne référence leur identifiant : auteurs, validateurs et
--    décideurs sont stockés par nom affiché (createdBy, approvedBy, decidedBy, by, actor), qui
--    reste lisible dans l'historique. Le journal d'audit est conservé tel quel.
-- 2. Les connexions LinkedIn (public.app_user_connections) qui n'appartiennent pas à un
--    utilisateur réel : celles des 4 profils de démo (même rattachés : avant l'authentification,
--    tout visiteur agissait sous u_sophie ou sous le profil de son choix, la connexion peut
--    appartenir à n'importe qui) et celles de tout utilisateur absent, non rattaché ou jamais
--    connecté. Les titulaires légitimes reconnectent leur compte depuis KORA.
--    Placée APRÈS l'étape 1 pour couvrir les utilisateurs qu'elle vient de supprimer.
--    LIMITE : seule la clé chiffrée est effacée. L'autorisation accordée à la passerelle Lovable
--    reste valide côté LinkedIn (aucune révocation possible en SQL) : les titulaires peuvent la
--    retirer dans LinkedIn > Préférences > Confidentialité des données > Services autorisés.
-- 3. Les connexions LinkedIn en attente au format précédent (une ligne par clic « Connecter »,
--    clé linkedin-connect:<utilisateur>:<demande>) : le code actuel n'en garde qu'une par
--    utilisateur (clé linkedin-connect:<utilisateur>) et ne relit plus jamais les anciennes.
BEGIN;

DELETE FROM public.kora_records
WHERE collection = 'users'
  AND id IN ('u_sophie', 'u_lucas', 'u_claire', 'u_marc')
  AND coalesce(data->>'authUserId', '') = '';

DELETE FROM public.app_user_connections c
WHERE c.user_id IN ('u_sophie', 'u_lucas', 'u_claire', 'u_marc')
   OR NOT EXISTS (
     SELECT 1
     FROM public.kora_records r
     WHERE r.collection = 'users'
       AND r.id = c.user_id
       AND coalesce(r.data->>'authUserId', '') <> ''
       AND coalesce(r.data->>'activatedAt', '') <> ''
   );

DELETE FROM public.kora_records
WHERE collection = 'locks'
  AND id LIKE 'linkedin-connect:%:%';

COMMIT;

-- VÉRIFICATION (lecture seule) : utilisateurs restants, administrateurs actifs, connexions.
-- SELECT id, data->>'email' AS email, data->'roles' AS roles,
--        coalesce(data->>'authUserId', '') <> '' AS rattache, data->>'activatedAt' AS active_le
-- FROM public.kora_records WHERE collection = 'users' ORDER BY id;
-- SELECT user_id, connector_id, updated_at FROM public.app_user_connections ORDER BY user_id;
