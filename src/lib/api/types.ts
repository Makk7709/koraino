/**
 * Contrat d'API KORA Newsroom — partagé entre le serveur (src/server) et le front.
 * Toutes les dates sont des chaînes ISO 8601. Une date inconnue vaut `null` (jamais inventée).
 */

/* ------------------------------------------------------------------ */
/* Utilisateurs & rôles (§7)                                           */
/* ------------------------------------------------------------------ */

export type Role = "admin" | "redacteur" | "validateur" | "lecteur";

export interface User {
  id: string;
  name: string;
  email: string;
  team: string;
  roles: Role[];
  avatarUrl: string | null;
  /** Compte de connexion activé (mode supabase) ; sinon invitation en attente. */
  hasAccount?: boolean;
}

/* ------------------------------------------------------------------ */
/* Registre : entreprises & sources (§3.1)                             */
/* ------------------------------------------------------------------ */

export type CompanyPriority = "haute" | "normale" | "basse";

/** Thématique éditoriale servant aux regroupements du dashboard. */
export type Theme =
  | "deeptech_quantique"
  | "ia_industrie"
  | "transition_energetique"
  | "talents_rh"
  | "sante_biotech"
  | "mobilite"
  | "numerique";

export interface Company {
  id: string;
  name: string;
  aliases: string[];
  domain: string;
  sector: string;
  territory: string;
  priority: CompanyPriority;
  themes: Theme[];
  /** Couleurs du monogramme affiché à la place d'un logo. */
  brand: { initials: string; bg: string; fg: string };
  createdAt: string;
  sourceCount: number;
  failingSourceCount: number;
  signalCount: number;
}

export type SourceType =
  "site_officiel" | "actualites" | "communiques" | "rss" | "recherche_web" | "newsletter_import";
export type SourceAccess = "ok" | "erreur" | "en_attente" | "desactivee";
export type SourceFrequency = "quotidienne" | "hebdomadaire";

export interface Source {
  id: string;
  companyId: string;
  type: SourceType;
  label: string;
  url: string;
  frequency: SourceFrequency;
  access: SourceAccess;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  failureCode: string | null;
  failureReason: string | null;
  /** Essais consécutifs en échec (borné, cf. §6). */
  attempts: number;
}

export type CollectionRunStatus = "succes" | "succes_sans_actualite" | "echec" | "bloque_quota";

/** Recherche complémentaire (Perplexity) menée pendant une exécution de collecte. */
export interface CollectionEnrichment {
  provider: "perplexity";
  status: "ok" | "non_configure" | "erreur";
  /** Résultats renvoyés par Perplexity. */
  received: number;
  /** Résultats retenus : datés, hors site de l'entreprise, qui la citent. */
  matched: number;
  /** Nouvelles observations issues de Perplexity. */
  added: number;
  message: string | null;
}

export interface CollectionRun {
  id: string;
  sourceId: string;
  companyId: string;
  startedAt: string;
  finishedAt: string | null;
  status: CollectionRunStatus;
  newObservations: number;
  errorCode: string | null;
  errorMessage: string | null;
  /** Absent sur les exécutions antérieures ou sans recherche complémentaire. */
  enrichment?: CollectionEnrichment | null;
}

/** Lot d'une collecte globale (`POST /collect`) : le client enchaîne les lots jusqu'à `remaining: 0`. */
export interface CollectionBatch {
  /** Début de la collecte globale : à renvoyer tel quel pour obtenir le lot suivant. */
  since: string;
  /** Sources actives au moment de l'appel. */
  total: number;
  /** Exécutions de ce lot (plus les exécutions `bloque_quota` des sources restantes, le cas échéant). */
  runs: CollectionRun[];
  /** Sources actives non encore collectées depuis `since` ; 0 : collecte terminée. */
  remaining: number;
}

/* ------------------------------------------------------------------ */
/* Signal Engine : observations, signaux, déduplication (§3.2)         */
/* ------------------------------------------------------------------ */

export type Category =
  | "financement"
  | "acquisition"
  | "contrat"
  | "partenariat"
  | "innovation"
  | "produit"
  | "brevet"
  | "recrutement"
  | "croissance"
  | "international"
  | "distinction"
  | "recherche";

/** Média / émetteur d'une observation (ex. Les Echos). */
export interface Outlet {
  name: string;
  domain: string;
  brand: { initials: string; bg: string; fg: string };
}

export interface Observation {
  id: string;
  signalId: string | null;
  sourceId: string | null;
  /** null = « à rattacher » (homonymie ou alias non résolu). */
  companyId: string | null;
  outlet: Outlet;
  url: string;
  title: string;
  excerpt: string;
  collectedAt: string;
  publishedAt: string | null;
  eventDate: string | null;
  /** Confiance de rattachement à l'entreprise (0–100), pas une probabilité de véracité. */
  matchConfidence: number;
  /** Reprise d'un même communiqué : ne compte pas comme corroboration indépendante. */
  isSyndicated: boolean;
  /** Canal de découverte ; absent sur les observations antérieures ou simulées. */
  via?: ObservationVia;
}

/** Flux de la source, Google News ou recherche Perplexity. */
export type ObservationVia = "flux" | "google_news" | "perplexity";

export type SignalStatus = "nouveau" | "a_traiter" | "en_revue" | "surveille" | "traite" | "rejete";

export type Criterion = "importance" | "nouveaute" | "territoire" | "lecteurs" | "diffusion";

export interface ScoringGrid {
  version: number;
  /** Poids en %, somme = 100. */
  weights: Record<Criterion, number>;
  createdAt: string;
  createdBy: string;
  active: boolean;
  note: string | null;
}

/**
 * Lecture du contenu par le modèle à la création du signal : catégorie et importance éditoriale
 * (0–100), avec le motif. Absente sans clé IA ou si le modèle n'a pas répondu : la catégorie vient
 * alors des indices lexicaux et l'importance de la catégorie.
 */
export interface ContentAssessment {
  category: Category;
  importance: number;
  reason: string;
  /** Modèle qui a produit l'évaluation (traçabilité). */
  model: string;
}

export interface ScoreResult {
  /** Score éditorial 0–100. L'UI l'affiche sur 10 (ex. 92 → 9.2/10). */
  total: number;
  gridVersion: number;
  subScores: Record<Criterion, number>;
  reasons: Record<Criterion, string>;
}

export type EvidenceLevel = "solide" | "a_consolider" | "fragile";

/** Indicateur documentaire : état explicable, pas une probabilité (§3.3). */
export interface EvidenceState {
  level: EvidenceLevel;
  directSource: boolean;
  independentCorroborations: number;
  freshnessDays: number | null;
  contradictions: string[];
  explanation: string[];
}

export interface Signal {
  id: string;
  companyId: string | null;
  title: string;
  summary: string;
  category: Category;
  themes: Theme[];
  tags: string[];
  status: SignalStatus;
  statusReason: string | null;
  observationIds: string[];
  primaryOutlet: Outlet;
  primaryUrl: string;
  collectedAt: string;
  publishedAt: string | null;
  eventDate: string | null;
  matchConfidence: number;
  score: ScoreResult;
  /** Évaluation du contenu par le modèle, quand elle existe ; sert à recalculer le score. */
  assessment?: ContentAssessment | null;
  evidence: EvidenceState;
  whyInteresting: string[];
  suggestedAngle: { text: string; tags: string[] };
  readingMinutes: number;
  /** Fusion incertaine / homonymie soumise à revue humaine. */
  review: { kind: "homonymie" | "fusion_incertaine"; note: string } | null;
  inNewsletter: boolean;
  articleId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SignalDetail extends Signal {
  company: Company | null;
  observations: Observation[];
}

/* ------------------------------------------------------------------ */
/* Editorial Studio, Human Content Guard, approbations (§4, §6)        */
/* ------------------------------------------------------------------ */

export type ArticleStatus =
  "brouillon" | "en_revue" | "approuve" | "programme" | "publie" | "rejete";
export type ArticleOrigin = "kora" | "import_humain";
export type Channel = "wordpress" | "linkedin" | "newsletter";

export interface FactCheck {
  id: string;
  claim: string;
  observationIds: string[];
  status: "etaye" | "non_corrobore" | "contradictoire";
  /** Arbitrage humain d'une contradiction (qui, quand, pourquoi). */
  resolution?: { by: string; at: string; note: string | null } | null;
}

export interface ArticleVersion {
  n: number;
  title: string;
  chapo: string;
  body: string;
  excerpt: string;
  seoTitle: string;
  categories: string[];
  tags: string[];
  createdAt: string;
  createdBy: string;
  note: string | null;
}

export interface Approval {
  id: string;
  version: number;
  channel: Channel;
  approvedBy: string;
  approvedAt: string;
  scheduledAt: string | null;
  valid: boolean;
  invalidatedAt: string | null;
  invalidatedReason: string | null;
}

export interface Article {
  id: string;
  signalId: string | null;
  companyId: string | null;
  origin: ArticleOrigin;
  /** Auteur humain nommé — jamais remplacé par une attribution automatique. */
  author: string | null;
  status: ArticleStatus;
  currentVersion: number;
  title: string;
  excerpt: string;
  angles: string[];
  plan: string[];
  factChecks: FactCheck[];
  approvals: Approval[];
  wordpress: {
    remoteId: string | null;
    status: WordPressRemoteStatus;
    lastSyncAt: string | null;
    /** Lien d'édition dans l'administration WordPress, calculé à la lecture (jamais stocké). */
    editUrl?: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * État du contenu côté WordPress : `en_attente` = soumis à relecture, `supprime` = mis à la
 * corbeille ou supprimé sur le site (un nouvel envoi recrée alors un brouillon).
 */
export type WordPressRemoteStatus =
  "aucun" | "brouillon" | "en_attente" | "programme" | "publie" | "supprime";

export interface ArticleDetail extends Article {
  versions: ArticleVersion[];
  signal: Signal | null;
  observations: Observation[];
  publications: PublicationAttempt[];
}

export interface ImportProposal {
  id: string;
  kind: "enrichissement" | "correction" | "mise_en_forme";
  before: string;
  after: string;
  rationale: string;
  decision: "en_attente" | "acceptee" | "refusee";
}

export interface HumanImport {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  author: string;
  originalText: string;
  extractedText: string;
  proposals: ImportProposal[];
  articleId: string | null;
  createdAt: string;
  createdBy: string;
}

/* ------------------------------------------------------------------ */
/* Diffusion : publications, LinkedIn, newsletter (§4.3, §6)           */
/* ------------------------------------------------------------------ */

export type PublicationStatus = "succes" | "echec" | "bloque" | "verification_requise";

export interface PublicationAttempt {
  id: string;
  idempotencyKey: string;
  articleId: string | null;
  linkedinPostId: string | null;
  /** Export d'une édition de newsletter. */
  newsletterId?: string | null;
  channel: Channel;
  version: number;
  status: PublicationStatus;
  code: string | null;
  message: string;
  attempts: number;
  remoteId: string | null;
  mode: "brouillon_distant" | "export" | "publication";
  at: string;
  by: string;
  /** Utilisateur qui a lancé la tentative ; absent sur les tentatives antérieures à ce suivi. */
  byUserId?: string | null;
}

export type LinkedInStatus = "brouillon" | "a_valider" | "approuve" | "exporte" | "publie";

export interface LinkedInVariant {
  id: string;
  text: string;
  hashtags: string[];
}

export interface LinkedInPost {
  id: string;
  articleId: string | null;
  signalId: string | null;
  companyId: string | null;
  title: string;
  variants: LinkedInVariant[];
  selectedVariantId: string;
  version: number;
  status: LinkedInStatus;
  approval: Approval | null;
  createdAt: string;
  updatedAt: string;
}

/** Connexion LinkedIn de l'utilisateur courant (connecteur par utilisateur). */
export interface LinkedInConnection {
  connected: boolean;
  name?: string | null;
  memberId?: string | null;
  reconnectRequired?: boolean;
  error?: string | null;
}

/* ------------------------------------------------------------------ */
/* WordPress : brouillons distants sur le site configuré (§4.3)        */
/* ------------------------------------------------------------------ */

/** `reel` : site configuré ; `simule` : tests et démonstration locale ; `non_configure` : envoi impossible. */
export type WordPressMode = "reel" | "simule" | "non_configure";

export interface WordPressCategory {
  id: number;
  slug: string;
  name: string;
  parent: number;
}

export interface WordPressSettings {
  /** Catégorie KORA (libellé, ex. « Levée de fonds ») → slug de la catégorie WordPress. */
  categoryMap: Record<string, string>;
  /** Slug utilisé quand aucune catégorie de la version n'a de correspondance. */
  defaultCategory: string | null;
}

/** Réponse de GET /wordpress. */
export interface WordPressStatus {
  mode: WordPressMode;
  /** Origine du site configuré, null hors mode réel. */
  site: string | null;
  /** Noms des variables d'environnement manquantes (jamais leurs valeurs). */
  missing: string[];
  settings: WordPressSettings;
  /** Libellés des catégories KORA proposés à la correspondance. */
  koraCategories: string[];
}

/** Réponse de GET /wordpress/check (administrateurs). */
export interface WordPressCheck {
  ok: boolean;
  account: { id: number; name: string; roles: string[] | null } | null;
  /** Le compte peut publier lui-même : rôle trop élevé pour le pilote (Contributeur attendu). */
  canPublish: boolean | null;
  error: { code: string; message: string } | null;
}

/** Réponse de POST /me/linkedin/connect : `state` est à rendre tel quel à /me/linkedin/complete. */
export interface LinkedInConnectStart {
  authorizationUrl: string;
  state: string;
}

/** Corps de POST /me/linkedin/complete. */
export interface LinkedInConnectComplete {
  code: string;
  state: string;
}

export type NewsletterStatus = "composition" | "approuvee" | "exportee";

export interface NewsletterItem {
  id: string;
  signalId: string | null;
  articleId: string | null;
  title: string;
  summary: string;
  order: number;
}

export interface NewsletterEdition {
  id: string;
  title: string;
  weekOf: string;
  intro: string;
  items: NewsletterItem[];
  status: NewsletterStatus;
  version: number;
  approval: Approval | null;
  /** Date d'envoi prévue (information éditoriale : KORA n'envoie jamais la newsletter). */
  scheduledFor?: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Editorial DNA (WF6), quotas, journal, notifications                 */
/* ------------------------------------------------------------------ */

export type RuleKind = "ton" | "longueur" | "structure" | "vocabulaire" | "interdit";

export interface EditorialRule {
  id: string;
  kind: RuleKind;
  text: string;
  active: boolean;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

export interface EditorialExample {
  id: string;
  title: string;
  excerpt: string;
  url: string | null;
  publishedAt: string | null;
}

export interface RuleProposal {
  id: string;
  kind: RuleKind;
  proposedText: string;
  ruleId: string | null;
  basedOnCorrections: number;
  rationale: string;
  status: "proposee" | "acceptee" | "refusee";
  createdAt: string;
  decidedBy: string | null;
}

export interface EditorialDna {
  rules: EditorialRule[];
  examples: EditorialExample[];
  proposals: RuleProposal[];
}

export interface QuotaMeter {
  key:
    | "api_budget_eur"
    | "search_queries"
    | "observations"
    | "articles"
    | "linkedin_posts"
    | "newsletters"
    | "companies"
    | "sources"
    | "storage_gb";
  label: string;
  used: number;
  limit: number;
  unit: string;
  /** 0–1 ; alertes à 0.8 puis 1. */
  ratio: number;
  alert: "ok" | "seuil_80" | "atteint";
}

export interface UsageSnapshot {
  month: string;
  meters: QuotaMeter[];
  /** À 100 % du budget API, les appels payants sont suspendus ; lecture et exports restent accessibles. */
  paidCallsSuspended: boolean;
}

export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  action: string;
  entity:
    | "company"
    | "source"
    | "signal"
    | "article"
    | "linkedin"
    | "newsletter"
    | "rule"
    | "grid"
    | "import"
    | "publication"
    | "user"
    | "quota";
  entityId: string;
  details: string;
}

export interface Notification {
  id: string;
  at: string;
  kind: "signal" | "approbation" | "erreur_source" | "quota" | "publication";
  title: string;
  body: string;
  read: boolean;
  link: string | null;
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

export interface KpiCard {
  key: "companies" | "signals" | "priority_topics" | "wordpress_drafts" | "linkedin_to_validate";
  value: number;
  label: string;
  /** Variation affichée telle quelle (ex. "+12%" ou "+2"). */
  trend: string;
  trendDirection: "up" | "down" | "flat";
  spark: number[];
}

export interface DashboardGroupItem {
  key: string;
  label: string;
  count: number;
  icon: string;
  /** Teinte de la tuile d'icône (maquette). */
  tone?: "rose" | "orange" | "amber" | "green" | "blue" | "purple" | "teal" | "gray";
}

export interface DashboardGroup {
  key: "prioritaires" | "a_surveiller" | "traites";
  label: string;
  total: number;
  items: DashboardGroupItem[];
}

export interface ActivityPoint {
  date: string;
  signals: number;
  articles: number;
}

export interface Dashboard {
  period: { from: string; to: string };
  kpis: KpiCard[];
  groups: DashboardGroup[];
  activity: {
    points: ActivityPoint[];
    totalSignals: number;
    totalArticles: number;
    /** Variation vs période précédente, ex. "+42%". */
    trend: string;
  };
  latestWordpressDraft: {
    articleId: string;
    title: string;
    updatedAt: string;
    ready: boolean;
  } | null;
  latestLinkedInPost: {
    postId: string;
    excerpt: string;
    updatedAt: string;
    status: LinkedInStatus;
  } | null;
  newsletter: {
    editionId: string;
    title: string;
    selectedCount: number;
    scheduledFor: string;
    includeNext: boolean;
    /** Signal concerné par l'interrupteur « Inclure dans la prochaine édition ». */
    signalId?: string | null;
  } | null;
  engine: { active: boolean; sourcesCount: number; features: string[] };
}

/* ------------------------------------------------------------------ */
/* Recherche globale & export                                          */
/* ------------------------------------------------------------------ */

export interface SearchResult {
  kind: "company" | "signal" | "article" | "source";
  id: string;
  title: string;
  subtitle: string;
  link: string;
}

export type ExportEntity =
  | "companies"
  | "sources"
  | "signals"
  | "observations"
  | "scores"
  | "rules"
  | "decisions"
  | "articles"
  | "audit";

/* ------------------------------------------------------------------ */
/* Enveloppes                                                          */
/* ------------------------------------------------------------------ */

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface Paginated<T> {
  items: T[];
  total: number;
}

/* ------------------------------------------------------------------ */
/* Authentification & utilisateurs                                     */
/* ------------------------------------------------------------------ */

/** `supabase` : comptes Supabase Auth sur invitation ; `demo` : changement de profil libre. */
export type AuthMode = "supabase" | "demo";

export interface AuthConfig {
  mode: AuthMode;
}

export type InvitationStatus = "sent" | "existing_account" | "not_applicable" | "failed";

export interface InvitationResult {
  invitation: InvitationStatus;
  /** Explication lorsque l'invitation a échoué. */
  message?: string;
}

export interface CreatedUser extends InvitationResult {
  user: User;
}

/* ------------------------------------------------------------------ */
/* Corps de requêtes                                                   */
/* ------------------------------------------------------------------ */

export interface SignalListQuery {
  status?: SignalStatus | "tous";
  companyId?: string;
  outlet?: string;
  category?: Category;
  theme?: Theme;
  q?: string;
  sort?: "recent" | "score";
  limit?: number;
  offset?: number;
}

export interface CompanyInput {
  name: string;
  aliases?: string[];
  domain: string;
  sector: string;
  territory?: string;
  priority?: CompanyPriority;
  themes?: Theme[];
}

export interface SourceInput {
  companyId: string;
  type: SourceType;
  label: string;
  url: string;
  frequency?: SourceFrequency;
}

export interface SignalPatch {
  status?: SignalStatus;
  statusReason?: string | null;
  companyId?: string | null;
  inNewsletter?: boolean;
}

export interface ArticleVersionInput {
  title: string;
  chapo: string;
  body: string;
  excerpt?: string;
  seoTitle?: string;
  categories?: string[];
  tags?: string[];
  note?: string | null;
}

export interface ApproveInput {
  channel: Channel;
  /** Version que le validateur a relue ; refusée si ce n'est plus la version courante. */
  version: number;
  scheduledAt?: string | null;
}

export interface PublishInput {
  channel: Channel;
  /**
   * WordPress seulement : remplacer un brouillon modifié dans WordPress depuis le dernier envoi
   * (après un refus 409 `wordpress_remote_modified`). Sans effet pour les autres canaux.
   */
  overwriteRemoteChanges?: boolean;
}

/** Corps optionnel de POST /linkedin/:id/publish : verdict humain sur une publication non confirmée. */
export interface LinkedInPublishInput {
  resolution?: "published" | "not_published";
}

export interface ScoringGridInput {
  weights: Record<Criterion, number>;
  note?: string | null;
}

export interface UserInput {
  name: string;
  email: string;
  team?: string;
  roles: Role[];
}

export interface UserPatch {
  name?: string;
  team?: string;
  roles?: Role[];
}
