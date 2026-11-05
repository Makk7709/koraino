import { z } from "zod";
import type { ArticleRecord, SignalRecord } from "./records";
import type { PaidAttemptInput, ReserveResult } from "./paid-attempts";

/** Durable ownership: TTL expiry never authorizes a second paid generation. */
export interface ArticleGenerationClaim {
  token: string;
  signal: SignalRecord;
}
export const generationReservationSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), suspending: z.boolean(), reason: z.string() }),
  z.object({ blocked: z.enum(["busy", "article_exists", "signal_changed"]) }),
]);
export type GenerationReservation =
  | ReserveResult
  | {
      blocked: "busy" | "article_exists" | "signal_changed";
    };
export interface ArticleGenerationsRepository {
  /** Claim and financial reservation commit together, before any provider work. */
  reserve(claim: ArticleGenerationClaim, attempt: PaidAttemptInput): Promise<GenerationReservation>;
  /** Bind the exact authenticated HTTP intent to the ownership claim. */
  reserveLinked(
    claim: ArticleGenerationClaim,
    attempt: PaidAttemptInput,
    httpOperationId: string,
  ): Promise<GenerationReservation>;
  start(signalId: string, token: string, attemptId: string): Promise<void>;
  /** Atomically create the article, link the unchanged signal, and complete the claim. */
  complete(signalId: string, token: string, article: ArticleRecord): Promise<void>;
  /** Never releases ownership, and never downgrades a completed generation. */
  uncertain(signalId: string, token: string): Promise<void>;
}
