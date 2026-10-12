-- =====================================================================
-- KORA Newsroom IA — schéma PostgreSQL cible (PostgreSQL 14+)
--
-- Correspond au contrat d'API src/lib/api/types.ts et au dépôt en mémoire
-- du pilote (src/server/store). Principes :
--   * séparation stricte par espace de travail : chaque table porte
--     workspace_id ; les références passent par des clés composites
--     (workspace_id, id) pour interdire tout lien entre deux espaces ;
--     la sécurité au niveau des lignes (RLS) filtre sur kora.workspace_id ;
--   * statuts contraints par CHECK ; dates inconnues = NULL ;
--   * grilles de score versionnées (somme des poids = 100), un signal garde
--     la version de grille de son évaluation ;
--   * publication idempotente : clé contenu + version + canal unique ;
--   * journal d'audit en ajout seul.
-- Les identifiants sont des textes (ex. sig_pasqal) pour rester identiques
-- aux exports CSV/JSON et à l'API.
-- =====================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS kora;
SET search_path TO kora, public;

-- ---------------------------------------------------------------------
-- Espaces de travail, utilisateurs, rôles
-- ---------------------------------------------------------------------

CREATE TABLE workspaces (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id           text NOT NULL,
  name         text NOT NULL,
  email        text NOT NULL,
  team         text NOT NULL,
  avatar_url   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, email)
);

CREATE TABLE user_roles (
  workspace_id text NOT NULL,
  user_id      text NOT NULL,
  role         text NOT NULL CHECK (role IN ('admin', 'redacteur', 'validateur', 'lecteur')),
  PRIMARY KEY (workspace_id, user_id, role),
  FOREIGN KEY (workspace_id, user_id) REFERENCES users (workspace_id, id) ON DELETE CASCADE
);

-- Paramètres, quotas mensuels et état budgétaire (§12).
CREATE TABLE workspace_settings (
  workspace_id          text PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  limit_api_budget_eur  numeric(10, 2) NOT NULL DEFAULT 150 CHECK (limit_api_budget_eur >= 0),
  limit_search_queries  integer NOT NULL DEFAULT 3000 CHECK (limit_search_queries >= 0),
  limit_observations    integer NOT NULL DEFAULT 6000 CHECK (limit_observations >= 0),
  limit_articles        integer NOT NULL DEFAULT 25 CHECK (limit_articles >= 0),
  limit_linkedin_posts  integer NOT NULL DEFAULT 25 CHECK (limit_linkedin_posts >= 0),
  limit_newsletters     integer NOT NULL DEFAULT 5 CHECK (limit_newsletters >= 0),
  limit_companies       integer NOT NULL DEFAULT 150 CHECK (limit_companies >= 0),
  limit_sources         integer NOT NULL DEFAULT 300 CHECK (limit_sources >= 0),
  limit_storage_gb      numeric(8, 2) NOT NULL DEFAULT 10 CHECK (limit_storage_gb >= 0),
  paid_calls_suspended  boolean NOT NULL DEFAULT false,
  suspended_month       char(7) CHECK (suspended_month ~ '^\d{4}-\d{2}$'),
  reserved_eur          numeric(10, 4) NOT NULL DEFAULT 0 CHECK (reserved_eur >= 0),
  storage_base_gb       numeric(8, 3) NOT NULL DEFAULT 0 CHECK (storage_base_gb >= 0)
);

-- ---------------------------------------------------------------------
-- Registre : entreprises et sources (§3.1)
-- ---------------------------------------------------------------------

CREATE TABLE companies (
  workspace_id   text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id             text NOT NULL,
  name           text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  aliases        text[] NOT NULL DEFAULT '{}',
  domain         text NOT NULL CHECK (domain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$'),
  sector         text NOT NULL,
  territory      text NOT NULL,
  priority       text NOT NULL DEFAULT 'normale' CHECK (priority IN ('haute', 'normale', 'basse')),
  themes         text[] NOT NULL DEFAULT '{}' CHECK (themes <@ ARRAY[
                   'deeptech_quantique', 'ia_industrie', 'transition_energetique', 'talents_rh',
                   'sante_biotech', 'mobilite', 'numerique']::text[]),
  brand_initials text NOT NULL,
  brand_bg       text NOT NULL CHECK (brand_bg ~ '^#[0-9a-fA-F]{6}$'),
  brand_fg       text NOT NULL CHECK (brand_fg ~ '^#[0-9a-fA-F]{6}$'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, domain)
);
CREATE UNIQUE INDEX companies_name_uq ON companies (workspace_id, lower(name));

CREATE TABLE sources (
  workspace_id    text NOT NULL,
  id              text NOT NULL,
  company_id      text NOT NULL,
  type            text NOT NULL CHECK (type IN ('site_officiel', 'actualites', 'communiques', 'rss', 'recherche_web', 'newsletter_import')),
  label           text NOT NULL,
  url             text NOT NULL CHECK (url ~* '^https?://'),
  frequency       text NOT NULL DEFAULT 'quotidienne' CHECK (frequency IN ('quotidienne', 'hebdomadaire')),
  access          text NOT NULL DEFAULT 'en_attente' CHECK (access IN ('ok', 'erreur', 'en_attente', 'desactivee')),
  last_run_at     timestamptz,
  last_success_at timestamptz,
  failure_code    text,
  failure_reason  text,
  attempts        smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, company_id, url),
  FOREIGN KEY (workspace_id, company_id) REFERENCES companies (workspace_id, id) ON DELETE CASCADE,
  CHECK (access <> 'erreur' OR failure_code IS NOT NULL)
);
CREATE INDEX sources_company_idx ON sources (workspace_id, company_id);
CREATE INDEX sources_access_idx ON sources (workspace_id, access);

CREATE TABLE collection_runs (
  workspace_id     text NOT NULL,
  id               text NOT NULL,
  source_id        text NOT NULL,
  company_id       text NOT NULL,
  started_at       timestamptz NOT NULL,
  finished_at      timestamptz,
  status           text NOT NULL CHECK (status IN ('succes', 'succes_sans_actualite', 'echec', 'bloque_quota')),
  new_observations integer NOT NULL DEFAULT 0 CHECK (new_observations >= 0),
  error_code       text,
  error_message    text,
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, source_id) REFERENCES sources (workspace_id, id) ON DELETE CASCADE,
  CHECK (finished_at IS NULL OR finished_at >= started_at),
  CHECK (status NOT IN ('echec', 'bloque_quota') OR error_code IS NOT NULL)
);
CREATE INDEX collection_runs_source_idx ON collection_runs (workspace_id, source_id, started_at DESC);

-- ---------------------------------------------------------------------
-- Signal Engine : grilles, signaux, observations (§3.2, §3.3)
-- ---------------------------------------------------------------------

CREATE TABLE scoring_grids (
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  version      integer NOT NULL CHECK (version >= 1),
  w_importance smallint NOT NULL CHECK (w_importance BETWEEN 0 AND 100),
  w_nouveaute  smallint NOT NULL CHECK (w_nouveaute BETWEEN 0 AND 100),
  w_territoire smallint NOT NULL CHECK (w_territoire BETWEEN 0 AND 100),
  w_lecteurs   smallint NOT NULL CHECK (w_lecteurs BETWEEN 0 AND 100),
  w_diffusion  smallint NOT NULL CHECK (w_diffusion BETWEEN 0 AND 100),
  active       boolean NOT NULL DEFAULT false,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text NOT NULL,
  PRIMARY KEY (workspace_id, version),
  CONSTRAINT scoring_grids_weights_sum_100
    CHECK (w_importance + w_nouveaute + w_territoire + w_lecteurs + w_diffusion = 100)
);
-- Une seule grille active par espace ; les anciennes versions restent consultables.
CREATE UNIQUE INDEX scoring_grids_one_active ON scoring_grids (workspace_id) WHERE active;

CREATE TABLE signals (
  workspace_id          text NOT NULL,
  id                    text NOT NULL,
  company_id            text,
  title                 text NOT NULL,
  summary               text NOT NULL,
  category              text NOT NULL CHECK (category IN ('financement', 'acquisition', 'contrat', 'partenariat', 'innovation',
                          'produit', 'brevet', 'recrutement', 'croissance', 'international', 'distinction', 'recherche')),
  themes                text[] NOT NULL DEFAULT '{}',
  tags                  text[] NOT NULL DEFAULT '{}',
  status                text NOT NULL DEFAULT 'nouveau'
                          CHECK (status IN ('nouveau', 'a_traiter', 'en_revue', 'surveille', 'traite', 'rejete')),
  status_reason         text,
  primary_outlet_name   text NOT NULL,
  primary_outlet_domain text NOT NULL,
  primary_url           text NOT NULL,
  collected_at          timestamptz NOT NULL,
  published_at          timestamptz,          -- NULL = date inconnue (jamais inventée)
  event_date            timestamptz,          -- NULL = date inconnue
  match_confidence      smallint NOT NULL CHECK (match_confidence BETWEEN 0 AND 100),
  score_total           smallint NOT NULL CHECK (score_total BETWEEN 0 AND 100),
  grid_version          integer NOT NULL,
  sub_importance        smallint NOT NULL CHECK (sub_importance BETWEEN 0 AND 100),
  sub_nouveaute         smallint NOT NULL CHECK (sub_nouveaute BETWEEN 0 AND 100),
  sub_territoire        smallint NOT NULL CHECK (sub_territoire BETWEEN 0 AND 100),
  sub_lecteurs          smallint NOT NULL CHECK (sub_lecteurs BETWEEN 0 AND 100),
  sub_diffusion         smallint NOT NULL CHECK (sub_diffusion BETWEEN 0 AND 100),
  score_reasons         jsonb NOT NULL,
  why_interesting       text[] NOT NULL DEFAULT '{}',
  suggested_angle       jsonb NOT NULL,
  reading_minutes       smallint NOT NULL DEFAULT 1 CHECK (reading_minutes >= 1),
  review_kind           text CHECK (review_kind IN ('homonymie', 'fusion_incertaine')),
  review_note           text,
  article_id            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  -- Rattachement : suppression d'une entreprise = détachement préalable par l'application.
  FOREIGN KEY (workspace_id, company_id) REFERENCES companies (workspace_id, id),
  -- Le score référence la version de grille utilisée (historique non réécrit).
  FOREIGN KEY (workspace_id, grid_version) REFERENCES scoring_grids (workspace_id, version),
  CHECK (status <> 'rejete' OR status_reason IS NOT NULL),
  CHECK ((review_kind IS NULL) = (review_note IS NULL)),
  CHECK (company_id IS NOT NULL OR review_kind IS NOT NULL)
);
CREATE INDEX signals_status_idx ON signals (workspace_id, status, created_at DESC);
CREATE INDEX signals_company_idx ON signals (workspace_id, company_id);
CREATE INDEX signals_score_idx ON signals (workspace_id, score_total DESC);
CREATE INDEX signals_created_idx ON signals (workspace_id, created_at DESC);

CREATE TABLE observations (
  workspace_id     text NOT NULL,
  id               text NOT NULL,
  signal_id        text,
  source_id        text,
  company_id       text,
  outlet_name      text NOT NULL,
  outlet_domain    text NOT NULL,
  outlet_brand     jsonb NOT NULL,
  url              text NOT NULL CHECK (url ~* '^https?://'),
  url_canonical    text NOT NULL,
  title            text NOT NULL,
  excerpt          text NOT NULL,   -- texte nettoyé (aucun HTML externe conservé)
  collected_at     timestamptz NOT NULL,
  published_at     timestamptz,
  event_date       timestamptz,
  match_confidence smallint NOT NULL CHECK (match_confidence BETWEEN 0 AND 100),
  is_syndicated    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (workspace_id, id),
  -- Déduplication exacte : une URL canonique n'est collectée qu'une fois.
  UNIQUE (workspace_id, url_canonical),
  FOREIGN KEY (workspace_id, signal_id) REFERENCES signals (workspace_id, id),
  FOREIGN KEY (workspace_id, source_id) REFERENCES sources (workspace_id, id),
  FOREIGN KEY (workspace_id, company_id) REFERENCES companies (workspace_id, id)
);
CREATE INDEX observations_signal_idx ON observations (workspace_id, signal_id);
CREATE INDEX observations_collected_idx ON observations (workspace_id, collected_at DESC);

-- ---------------------------------------------------------------------
-- Editorial Studio, Human Content Guard (§4, §6)
-- ---------------------------------------------------------------------

CREATE TABLE articles (
  workspace_id           text NOT NULL,
  id                     text NOT NULL,
  signal_id              text,
  company_id             text,
  origin                 text NOT NULL CHECK (origin IN ('kora', 'import_humain')),
  author                 text,   -- auteur humain nommé, jamais remplacé
  status                 text NOT NULL DEFAULT 'brouillon'
                           CHECK (status IN ('brouillon', 'en_revue', 'approuve', 'programme', 'publie', 'rejete')),
  current_version        integer NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  title                  text NOT NULL,
  excerpt                text NOT NULL DEFAULT '',
  angles                 text[] NOT NULL DEFAULT '{}',
  plan                   text[] NOT NULL DEFAULT '{}',
  wordpress_remote_id    text,
  wordpress_status       text NOT NULL DEFAULT 'aucun' CHECK (wordpress_status IN ('aucun', 'brouillon', 'programme', 'publie')),
  wordpress_last_sync_at timestamptz,
  published_at           timestamptz,
  created_by             text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, signal_id) REFERENCES signals (workspace_id, id),
  FOREIGN KEY (workspace_id, company_id) REFERENCES companies (workspace_id, id),
  CHECK (origin <> 'import_humain' OR author IS NOT NULL),
  CHECK (wordpress_status = 'aucun' OR wordpress_remote_id IS NOT NULL)
);
-- Un seul article par signal.
CREATE UNIQUE INDEX articles_signal_uq ON articles (workspace_id, signal_id) WHERE signal_id IS NOT NULL;
CREATE INDEX articles_status_idx ON articles (workspace_id, status, updated_at DESC);

ALTER TABLE signals
  ADD FOREIGN KEY (workspace_id, article_id) REFERENCES articles (workspace_id, id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE article_versions (
  workspace_id text NOT NULL,
  article_id   text NOT NULL,
  n            integer NOT NULL CHECK (n >= 1),
  title        text NOT NULL,
  chapo        text NOT NULL DEFAULT '',
  body         text NOT NULL DEFAULT '',
  excerpt      text NOT NULL DEFAULT '',
  seo_title    text NOT NULL DEFAULT '',
  categories   text[] NOT NULL DEFAULT '{}',
  tags         text[] NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text NOT NULL,   -- « KORA » pour une version générée
  note         text,
  PRIMARY KEY (workspace_id, article_id, n),
  FOREIGN KEY (workspace_id, article_id) REFERENCES articles (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE fact_checks (
  workspace_id    text NOT NULL,
  id              text NOT NULL,
  article_id      text NOT NULL,
  claim           text NOT NULL,
  observation_ids text[] NOT NULL DEFAULT '{}',
  status          text NOT NULL CHECK (status IN ('etaye', 'non_corrobore', 'contradictoire')),
  resolved_by     text,
  resolved_at     timestamptz,
  resolution_note text,
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, article_id) REFERENCES articles (workspace_id, id) ON DELETE CASCADE,
  CHECK ((resolved_by IS NULL) = (resolved_at IS NULL))
);
CREATE INDEX fact_checks_article_idx ON fact_checks (workspace_id, article_id);

CREATE TABLE imports (
  workspace_id   text NOT NULL,
  id             text NOT NULL,
  filename       text NOT NULL,
  mime           text NOT NULL CHECK (mime IN (
                   'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  size_bytes     integer NOT NULL CHECK (size_bytes BETWEEN 0 AND 10485760),   -- 10 Mo maximum
  author         text NOT NULL,
  original_file  bytea NOT NULL,     -- fichier original conservé tel quel
  original_text  text NOT NULL,
  extracted_text text NOT NULL,
  article_id     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, article_id) REFERENCES articles (workspace_id, id),
  CHECK (lower(filename) ~ '\.(txt|docx)$')
);

CREATE TABLE import_proposals (
  workspace_id text NOT NULL,
  id           text NOT NULL,
  import_id    text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('enrichissement', 'correction', 'mise_en_forme')),
  before_text  text NOT NULL,
  after_text   text NOT NULL,
  rationale    text NOT NULL,
  decision     text NOT NULL DEFAULT 'en_attente' CHECK (decision IN ('en_attente', 'acceptee', 'refusee')),
  start_offset integer NOT NULL CHECK (start_offset >= 0),
  end_offset   integer NOT NULL,
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, import_id) REFERENCES imports (workspace_id, id) ON DELETE CASCADE,
  CHECK (end_offset >= start_offset)
);

-- ---------------------------------------------------------------------
-- Diffusion : LinkedIn, newsletter, approbations, envois (§4.3, §6)
-- ---------------------------------------------------------------------

CREATE TABLE linkedin_posts (
  workspace_id        text NOT NULL,
  id                  text NOT NULL,
  article_id          text,
  signal_id           text,
  company_id          text,
  title               text NOT NULL,
  selected_variant_id text NOT NULL,
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  status              text NOT NULL DEFAULT 'brouillon' CHECK (status IN ('brouillon', 'a_valider', 'approuve', 'exporte', 'publie')),
  created_by          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, article_id) REFERENCES articles (workspace_id, id),
  FOREIGN KEY (workspace_id, signal_id) REFERENCES signals (workspace_id, id),
  FOREIGN KEY (workspace_id, company_id) REFERENCES companies (workspace_id, id),
  CHECK (article_id IS NOT NULL OR signal_id IS NOT NULL)
);

CREATE TABLE linkedin_variants (
  workspace_id text NOT NULL,
  id           text NOT NULL,
  post_id      text NOT NULL,
  position     smallint NOT NULL CHECK (position >= 0),
  text         text NOT NULL CHECK (length(text) <= 3000),
  hashtags     text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, post_id, position),
  FOREIGN KEY (workspace_id, post_id) REFERENCES linkedin_posts (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE newsletters (
  workspace_id  text NOT NULL,
  id            text NOT NULL,
  title         text NOT NULL,
  week_of       date NOT NULL,
  intro         text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'composition' CHECK (status IN ('composition', 'approuvee', 'exportee')),
  version       integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  scheduled_for timestamptz,   -- information éditoriale : KORA n'envoie jamais la newsletter
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE newsletter_items (
  workspace_id  text NOT NULL,
  id            text NOT NULL,
  newsletter_id text NOT NULL,
  signal_id     text,
  article_id    text,
  title         text NOT NULL,
  summary       text NOT NULL,
  position      integer NOT NULL CHECK (position >= 1),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, newsletter_id, position) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workspace_id, newsletter_id) REFERENCES newsletters (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, signal_id) REFERENCES signals (workspace_id, id),
  FOREIGN KEY (workspace_id, article_id) REFERENCES articles (workspace_id, id),
  CHECK (signal_id IS NOT NULL OR article_id IS NOT NULL)
);
CREATE UNIQUE INDEX newsletter_items_signal_uq ON newsletter_items (workspace_id, newsletter_id, signal_id)
  WHERE signal_id IS NOT NULL;

-- Approbation = validateur, date, version, canal, programmation éventuelle.
-- Toute modification du contenu invalide l'approbation (valid = false + motif).
CREATE TABLE approvals (
  workspace_id       text NOT NULL,
  id                 text NOT NULL,
  article_id         text,
  linkedin_post_id   text,
  newsletter_id      text,
  version            integer NOT NULL CHECK (version >= 1),
  channel            text NOT NULL CHECK (channel IN ('wordpress', 'linkedin', 'newsletter')),
  approved_by        text NOT NULL,
  approved_at        timestamptz NOT NULL,
  scheduled_at       timestamptz,
  valid              boolean NOT NULL DEFAULT true,
  invalidated_at     timestamptz,
  invalidated_reason text,
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, article_id) REFERENCES articles (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, linkedin_post_id) REFERENCES linkedin_posts (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, newsletter_id) REFERENCES newsletters (workspace_id, id) ON DELETE CASCADE,
  CHECK (num_nonnulls(article_id, linkedin_post_id, newsletter_id) = 1),
  CHECK (valid OR (invalidated_at IS NOT NULL AND invalidated_reason IS NOT NULL))
);
-- Au plus une approbation valide par contenu et par canal.
CREATE UNIQUE INDEX approvals_one_valid ON approvals
  (workspace_id, coalesce(article_id, linkedin_post_id, newsletter_id), channel) WHERE valid;

CREATE TABLE publication_attempts (
  workspace_id     text NOT NULL,
  id               text NOT NULL,
  idempotency_key  char(64) NOT NULL CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),  -- sha-256(contenu:version:canal)
  article_id       text,
  linkedin_post_id text,
  newsletter_id    text,
  channel          text NOT NULL CHECK (channel IN ('wordpress', 'linkedin', 'newsletter')),
  version          integer NOT NULL CHECK (version >= 1),
  status           text NOT NULL CHECK (status IN ('succes', 'echec', 'bloque', 'verification_requise')),
  code             text,
  message          text NOT NULL,
  attempts         integer NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  remote_id        text,
  mode             text NOT NULL CHECK (mode IN ('brouillon_distant', 'export', 'publication')),
  at               timestamptz NOT NULL,
  by_user          text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, article_id) REFERENCES articles (workspace_id, id),
  FOREIGN KEY (workspace_id, linkedin_post_id) REFERENCES linkedin_posts (workspace_id, id),
  FOREIGN KEY (workspace_id, newsletter_id) REFERENCES newsletters (workspace_id, id),
  CHECK (num_nonnulls(article_id, linkedin_post_id, newsletter_id) >= 1),
  CHECK (status <> 'bloque' OR code IS NOT NULL)
);
-- Idempotence : un même contenu + version + canal n'est envoyé qu'une fois (pas de doublon).
CREATE UNIQUE INDEX publication_attempts_idempotency_uq ON publication_attempts (workspace_id, idempotency_key)
  WHERE status IN ('succes', 'verification_requise');
CREATE INDEX publication_attempts_article_idx ON publication_attempts (workspace_id, article_id, at DESC);

-- ---------------------------------------------------------------------
-- Référentiel éditorial (WF6)
-- ---------------------------------------------------------------------

CREATE TABLE editorial_rules (
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id           text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('ton', 'longueur', 'structure', 'vocabulaire', 'interdit')),
  text         text NOT NULL,
  active       boolean NOT NULL DEFAULT true,
  version      integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE editorial_rule_revisions (
  workspace_id text NOT NULL,
  rule_id      text NOT NULL,
  version      integer NOT NULL CHECK (version >= 1),
  text         text NOT NULL,
  active       boolean NOT NULL,
  updated_at   timestamptz NOT NULL,
  updated_by   text NOT NULL,
  PRIMARY KEY (workspace_id, rule_id, version),
  FOREIGN KEY (workspace_id, rule_id) REFERENCES editorial_rules (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE editorial_examples (
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id           text NOT NULL,
  title        text NOT NULL,
  excerpt      text NOT NULL,
  url          text CHECK (url IS NULL OR url ~* '^https?://'),
  published_at timestamptz,
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE rule_proposals (
  workspace_id         text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id                   text NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('ton', 'longueur', 'structure', 'vocabulaire', 'interdit')),
  proposed_text        text NOT NULL,
  rule_id              text,
  based_on_corrections integer NOT NULL CHECK (based_on_corrections >= 0),
  rationale            text NOT NULL,
  status               text NOT NULL DEFAULT 'proposee' CHECK (status IN ('proposee', 'acceptee', 'refusee')),
  signature            text NOT NULL,   -- une proposition décidée n'est jamais reproposée
  created_at           timestamptz NOT NULL DEFAULT now(),
  decided_by           text,
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, signature),
  FOREIGN KEY (workspace_id, rule_id) REFERENCES editorial_rules (workspace_id, id),
  CHECK ((status = 'proposee') = (decided_by IS NULL))
);

-- ---------------------------------------------------------------------
-- Exploitation : consommation, alertes, journal, notifications
-- ---------------------------------------------------------------------

-- Chaque appel payant (réservé avant l'appel) ou production comptée laisse une ligne.
CREATE TABLE usage_ledger (
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id           text NOT NULL,
  at           timestamptz NOT NULL DEFAULT now(),
  kind         text NOT NULL CHECK (kind IN ('generation_article', 'generation_linkedin', 'generation_summary', 'search_query', 'observation')),
  units        integer NOT NULL DEFAULT 0 CHECK (units >= 0),
  cost_eur     numeric(10, 4) NOT NULL DEFAULT 0 CHECK (cost_eur >= 0),
  label        text NOT NULL,
  PRIMARY KEY (workspace_id, id)
);
CREATE INDEX usage_ledger_month_idx ON usage_ledger (workspace_id, at);

CREATE TABLE quota_alerts (
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  month        char(7) NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  meter        text NOT NULL CHECK (meter IN ('api_budget_eur', 'search_queries', 'observations', 'articles',
                 'linkedin_posts', 'newsletters', 'companies', 'sources', 'storage_gb')),
  level        text NOT NULL CHECK (level IN ('seuil_80', 'atteint')),
  notified_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, month, meter, level)
);

CREATE TABLE audit_events (
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id           text NOT NULL,
  at           timestamptz NOT NULL DEFAULT now(),
  actor        text NOT NULL,
  action       text NOT NULL,
  entity       text NOT NULL CHECK (entity IN ('company', 'source', 'signal', 'article', 'linkedin', 'newsletter',
                 'rule', 'grid', 'import', 'publication', 'user', 'quota')),
  entity_id    text NOT NULL,
  details      text NOT NULL,
  PRIMARY KEY (workspace_id, id)
);
CREATE INDEX audit_events_entity_idx ON audit_events (workspace_id, entity, entity_id, at DESC);
CREATE INDEX audit_events_at_idx ON audit_events (workspace_id, at DESC);

-- Journal en ajout seul.
CREATE FUNCTION audit_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events est en ajout seul (% interdit)', TG_OP;
END;
$$;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();

CREATE TABLE notifications (
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id           text NOT NULL,
  user_id      text,   -- NULL = notification d'équipe
  at           timestamptz NOT NULL DEFAULT now(),
  kind         text NOT NULL CHECK (kind IN ('signal', 'approbation', 'erreur_source', 'quota', 'publication')),
  title        text NOT NULL,
  body         text NOT NULL,
  read         boolean NOT NULL DEFAULT false,
  link         text,
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, user_id) REFERENCES users (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX notifications_unread_idx ON notifications (workspace_id, read, at DESC);

-- ---------------------------------------------------------------------
-- Sécurité au niveau des lignes : chaque connexion fixe kora.workspace_id
-- (SET kora.workspace_id = 'ws_inovallee') ; aucune ligne d'un autre espace
-- n'est visible ni modifiable.
-- ---------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'workspace_id' AND NOT a.attisdropped
    WHERE n.nspname = 'kora' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE kora.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON kora.%I USING (workspace_id = current_setting(''kora.workspace_id'', true)) '
      'WITH CHECK (workspace_id = current_setting(''kora.workspace_id'', true))',
      t || '_workspace_isolation', t);
  END LOOP;
END;
$$;

COMMIT;
