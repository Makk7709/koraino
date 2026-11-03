import type {
  ArticleRecord,
  AuditEvent,
  LinkedInPostRecord,
  NewsletterRecord,
  ObservationRecord,
  SignalRecord,
} from "./records";

/** One checked row change. A null before/after means insert/delete. */
export type SignalMutation =
  | { collection: "signals"; id: string; before: SignalRecord | null; after: SignalRecord | null }
  | {
      collection: "observations";
      id: string;
      before: ObservationRecord | null;
      after: ObservationRecord | null;
    }
  | { collection: "articles"; id: string; before: ArticleRecord | null; after: ArticleRecord | null }
  | {
      collection: "linkedin";
      id: string;
      before: LinkedInPostRecord | null;
      after: LinkedInPostRecord | null;
    }
  | {
      collection: "newsletters";
      id: string;
      before: NewsletterRecord | null;
      after: NewsletterRecord | null;
    }
  | { collection: "audit"; id: string; before: AuditEvent | null; after: AuditEvent | null };

export interface SignalMutationsRepository {
  /** CAS for every affected row, then all-or-nothing commit including audit. */
  commit(changes: SignalMutation[]): Promise<void>;
}
