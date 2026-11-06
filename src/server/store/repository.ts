import type { NewsletterMutationsRepository } from "./newsletter-mutations";
import type { ArticleGenerationsRepository } from "./article-generations";
import type { SignalMutationsRepository } from "./signal-mutations";
import type { PaidAttemptsRepository } from "./paid-attempts";
import type { IdempotencyRepository } from "../services/http-idempotency";
import type { WordPressSettings } from "@/lib/api/types";
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
  PublicationRecord,
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
  publications: Collection<PublicationRecord>;
  imports: Collection<ImportRecord>;
  linkedin: Collection<LinkedInPostRecord>;
  newsletters: Collection<NewsletterRecord>;
  rules: Collection<RuleRecord>;
  examples: Collection<EditorialExample>;
  ruleProposals: Collection<RuleProposalRecord>;
  usage: Collection<UsageEntry>;
  paidAttempts: PaidAttemptsRepository;
  articleGenerations: ArticleGenerationsRepository;
  signalMutations: SignalMutationsRepository;
  newsletterMutations: NewsletterMutationsRepository;
  idempotency: IdempotencyRepository;
  audit: Collection<AuditEvent>;
  notifications: Collection<Notification>;
  getSettings(): Promise<Settings>;
  /**
   * Remplace les réglages partagés. Un ancien `wordpress` présent dans `settings` n'y est pas
   * réécrit : il n'est recopié à son nouvel emplacement que si celui-ci est encore vide.
   */
  saveSettings(settings: Settings): Promise<void>;
  /**
   * Correspondance des catégories WordPress, rangée hors des réglages partagés pour qu'aucune
   * écriture de `saveSettings` ne l'écrase. Jamais enregistrée à cet emplacement : l'ancien
   * `settings.wordpress` est lu en secours.
   */
  getWordPressSettings(): Promise<WordPressSettings>;
  /** Remplace la correspondance ; les écritures concurrentes sont sérialisées par l'appelant. */
  saveWordPressSettings(settings: WordPressSettings): Promise<void>;
  /** Identifiant unique préfixé (ex. `sig_n1042`). */
  nextId(prefix: string): string;
  /**
   * Verrou exclusif à expiration (la base n'offre pas de transaction côté application).
   * Renvoie un jeton de détention, ou `null` si un autre détenteur non expiré le possède.
   * L'expiration autorise un successeur sans arrêter l'ancien détenteur. Ce verrou seul
   * ne protège donc pas les écritures après le TTL : utiliser une transaction et/ou
   * une propriété durable pour les opérations qui peuvent dépasser cette durée.
   */
  acquireLock(key: string, ttlMs: number): Promise<string | null>;
  /**
   * Pose le verrou en évinçant tout détenteur, expiré ou non : son jeton ne libère plus rien et
   * la clé n'occupe jamais qu'une ligne. Renvoie un jeton imprévisible.
   */
  replaceLock(key: string, ttlMs: number): Promise<string>;
  /** Libère le verrou s'il est encore détenu avec ce jeton (sans effet sinon). */
  releaseLock(key: string, token: string): Promise<void>;
}
