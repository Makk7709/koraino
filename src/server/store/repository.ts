import type {
  ArticleRecord,
  AuditEvent,
  CollectionRun,
  CompanyRecord,
  EditorialExample,
  GridRecord,
  ImportRecord,
  LinkedInPostRecord,
  NewsletterRecord,
  Notification,
  ObservationRecord,
  PublicationAttempt,
  RuleProposalRecord,
  RuleRecord,
  Settings,
  SignalRecord,
  SourceRecord,
  UsageEntry,
  User,
} from "./records";

/**
 * Accès aux données d'un espace (workspace). Interface asynchrone pour pouvoir brancher
 * PostgreSQL (cf. db/postgres/schema.sql) sans toucher aux handlers ni au domaine.
 */
export interface Collection<T extends { id: string }> {
  get(id: string): Promise<T | undefined>;
  list(): Promise<T[]>;
  insert(item: T): Promise<T>;
  /** Remplace l'enregistrement existant (même id). */
  update(item: T): Promise<T>;
  remove(id: string): Promise<boolean>;
}

export interface Repository {
  readonly workspaceId: string;
  users: Collection<User>;
  companies: Collection<CompanyRecord>;
  sources: Collection<SourceRecord>;
  runs: Collection<CollectionRun>;
  observations: Collection<ObservationRecord>;
  signals: Collection<SignalRecord>;
  grids: Collection<GridRecord>;
  articles: Collection<ArticleRecord>;
  publications: Collection<PublicationAttempt>;
  imports: Collection<ImportRecord>;
  linkedin: Collection<LinkedInPostRecord>;
  newsletters: Collection<NewsletterRecord>;
  rules: Collection<RuleRecord>;
  examples: Collection<EditorialExample>;
  ruleProposals: Collection<RuleProposalRecord>;
  usage: Collection<UsageEntry>;
  audit: Collection<AuditEvent>;
  notifications: Collection<Notification>;
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
  /** Identifiant unique préfixé (ex. `sig_n1042`). */
  nextId(prefix: string): string;
}
