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
}

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
    status: "aucun" | "brouillon" | "programme" | "publie";
    lastSyncAt: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

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
}

export interface ScoringGridInput {
  weights: Record<Criterion, number>;
  note?: string | null;
}
