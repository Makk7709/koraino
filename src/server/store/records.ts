import type {
  Article,
  ArticleVersion,
  AuditEvent,
  CollectionRun,
  Company,
  EditorialExample,
  EditorialRule,
  HumanImport,
  ImportProposal,
  LinkedInPost,
  NewsletterEdition,
  Notification,
  Observation,
  PublicationAttempt,
  QuotaMeter,
  RuleProposal,
  ScoringGrid,
  Signal,
  Source,
  User as UserDto,
  WordPressRemoteStatus,
  WordPressSettings,
} from "@/lib/api/types";

/**
 * Enregistrements stockés. Ils reprennent les DTO du contrat, sans les champs calculés
 * (compteurs, indicateur documentaire…) et avec quelques champs internes jamais exposés.
 */

/** Jamais renvoyé tel quel : l'API expose `toPublicUser` (`hasAccount` au lieu de ces champs). */
export type UserRecord = Omit<UserDto, "hasAccount"> & {
  /** Compte Supabase Auth rattaché (à l'invitation ou à l'amorçage administrateur). */
  authUserId?: string | null;
  /** Première connexion réussie, ou rattachement d'un compte déjà confirmé. */
  activatedAt?: string | null;
};

export type CompanyRecord = Omit<Company, "sourceCount" | "failingSourceCount" | "signalCount"> & {
  /** Entreprise fictive du jeu de démonstration (la collecte simulée peut générer des actualités). */
  fictional: boolean;
};

/** Comportement du collecteur simulé pour une source. */
export type SourceSimulation =
  | { mode: "auto" }
  | { mode: "news" }
  | { mode: "empty" }
  | { mode: "transient" }
  | { mode: "fail"; code: string; reason: string };

export type SourceRecord = Source & {
  createdAt: string;
  runCount: number;
  simulation: SourceSimulation;
};

export type ObservationRecord = Observation;

export type SignalRecord = Omit<Signal, "evidence" | "inNewsletter">;

export type GridRecord = ScoringGrid & { id: string };

/** Lien vers le contenu WordPress ; `editUrl` est calculé à la lecture, jamais stocké. */
export interface WordPressLink {
  remoteId: string | null;
  status: WordPressRemoteStatus;
  lastSyncAt: string | null;
  /**
   * Site qui a produit `remoteId` (interne, jamais exposé) : null ou absent pour un identifiant
   * simulé ou antérieur à l'intégration réelle.
   */
  site?: string | null;
  /**
   * `modified_gmt` renvoyé par WordPress après le dernier ENVOI de KORA (interne, jamais exposé) ;
   * absent pour un lien antérieur à ce suivi. Une actualisation ne le change pas : sinon une
   * retouche faite dans WordPress serait « blanchie » et le renvoi suivant l'écraserait sans alerte.
   */
  sentModifiedGmt?: string | null;
}

export type ArticleRecord = Omit<Article, "wordpress"> & {
  wordpress: WordPressLink;
  versions: ArticleVersion[];
  publishedAt: string | null;
  createdBy: string;
};

export type LinkedInPostRecord = LinkedInPost & { createdBy: string };

export type NewsletterRecord = Omit<NewsletterEdition, "scheduledFor"> & {
  scheduledFor: string;
  createdBy: string;
};

export type ImportProposalRecord = ImportProposal & { start: number; end: number };

export type ImportRecord = Omit<HumanImport, "proposals"> & {
  proposals: ImportProposalRecord[];
  /** Fichier original conservé tel quel. */
  bytes: Uint8Array;
};

export interface RuleRevision {
  version: number;
  text: string;
  active: boolean;
  updatedAt: string;
  updatedBy: string;
}

export type RuleRecord = EditorialRule & { history: RuleRevision[] };

export type RuleProposalRecord = RuleProposal & { signature: string };

export type UsageKind =
  | "generation_article"
  | "generation_linkedin"
  | "generation_summary"
  | "search_query"
  | "observation";

/** Journal de consommation : chaque appel payant ou production comptée laisse une entrée. */
export interface UsageEntry {
  id: string;
  at: string;
  kind: UsageKind;
  units: number;
  costEur: number;
  label: string;
}

export type QuotaKey = QuotaMeter["key"];

export interface Settings {
  workspaceId: string;
  quotaLimits: Record<QuotaKey, number>;
  /** Appels payants suspendus (plafond budgétaire atteint ou réservation refusée). */
  paidCallsSuspended: boolean;
  suspendedMonth: string | null;
  /** Montant réservé par les appels en cours (réservation avant appel). */
  reservedEur: number;
  /** Seuils d'alerte déjà notifiés, ex. "2026-10:api_budget_eur:0.8". */
  notifiedAlerts: string[];
  /** Volume de fichiers client hors imports (Go). */
  storageBaseGb: number;
  /** Correspondance des catégories WordPress ; absente des réglages enregistrés avant elle. */
  wordpress?: WordPressSettings;
}

/**
 * Tentative stockée. `site` (interne, jamais exposé) : site WordPress visé ; absent avant ce
 * suivi. Une reprise après interruption n'a lieu que sur ce site.
 */
export type PublicationRecord = PublicationAttempt & { site?: string | null };

export type { AuditEvent, CollectionRun, EditorialExample, Notification, PublicationAttempt };
/** Nom sous lequel `repository.ts` type la collection `users`. */
export type User = UserRecord;
