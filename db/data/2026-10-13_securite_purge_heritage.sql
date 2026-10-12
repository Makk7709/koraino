-- Purge des données héritées de la période sans authentification (audit sécurité E2, 13/10/2026).
--
-- QUAND : une seule fois, juste après la mise en production de l'authentification Supabase
-- (branche securite/auth-linkedin et ses correctifs). Idempotent : le rejouer ne fait rien de
-- plus que supprimer les connexions LinkedIn existantes à ce moment-là.
--
-- COMMENT : console Lovable Cloud > Database > SQL editor (ou psql avec un rôle propriétaire),
-- coller le fichier entier et l'exécuter. La transaction applique tout ou rien.
--
-- AVANT : KORA_ADMIN_EMAILS doit contenir l'adresse du premier administrateur réel. Après la
-- purge, il s'amorce à sa première connexion (aucun administrateur actif ne subsiste sinon).
--
-- CE QUI EST SUPPRIMÉ
-- 1. Toutes les connexions LinkedIn (public.app_user_connections). Avant l'authentification,
--    tout visiteur agissait sous u_sophie (ou sous le profil de démo de son choix) : une
--    connexion enregistrée peut appartenir à n'importe qui. Chaque utilisateur reconnecte son
--    compte depuis KORA.
--    LIMITE : seule la clé chiffrée est effacée. L'autorisation accordée à la passerelle Lovable
--    reste valide côté LinkedIn (aucune révocation possible en SQL) : les titulaires peuvent la
--    retirer dans LinkedIn > Préférences > Confidentialité des données > Services autorisés.
-- 2. Les 4 utilisateurs de démonstration du seed (u_sophie admin, u_lucas, u_claire, u_marc),
--    uniquement s'ils n'ont jamais été rattachés à un compte Supabase (authUserId vide). Ils
--    apparaissaient « Invitation en attente » (renvoyer l'invitation enverrait un accès à une
--    boîte inconnue) et u_sophie comptait comme administrateur.
--    Aucun autre enregistrement ne référence leur identifiant : auteurs, validateurs et
--    décideurs sont stockés par nom affiché (createdBy, approvedBy, decidedBy, by, actor), qui
--    reste lisible dans l'historique. Le journal d'audit est conservé tel quel.
BEGIN;

DELETE FROM public.app_user_connections;

DELETE FROM public.kora_records
WHERE collection = 'users'
  AND id IN ('u_sophie', 'u_lucas', 'u_claire', 'u_marc')
  AND coalesce(data->>'authUserId', '') = '';

COMMIT;

-- VÉRIFICATION (lecture seule) : utilisateurs restants et administrateurs actifs.
-- SELECT id, data->>'email' AS email, data->'roles' AS roles,
--        coalesce(data->>'authUserId', '') <> '' AS rattache, data->>'activatedAt' AS active_le
-- FROM public.kora_records WHERE collection = 'users' ORDER BY id;
-- SELECT count(*) AS connexions_linkedin FROM public.app_user_connections;
