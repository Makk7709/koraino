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
  User,
} from "@/lib/api/types";

/**
 * Enregistrements stockés. Ils reprennent les DTO du contrat, sans les champs calculés
 * (compteurs, indicateur documentaire…) et avec quelques champs internes jamais exposés.
 */

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

export type ArticleRecord = Article & {
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
}

export type { AuditEvent, CollectionRun, EditorialExample, Notification, PublicationAttempt, User };
