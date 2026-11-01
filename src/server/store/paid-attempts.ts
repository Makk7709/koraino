import { z } from "zod";
import type { UsageEntry, UsageKind } from "./records";

const kinds = z.enum([
  "generation_article", "generation_linkedin", "generation_summary",
  "classification", "search_query", "observation",
]);

export const usageEntrySchema = z.object({
  id: z.string().min(1),
  at: z.string().datetime({ offset: true }),
  kind: kinds,
  units: z.number().finite().nonnegative(),
  costEur: z.number().finite().nonnegative(),
  label: z.string().min(1).max(500),
}).strict();

export const paidAttemptSchema = z.object({
  id: z.string().min(5),
  workspaceId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  kind: kinds,
  estimateEur: z.number().finite().positive(),
  units: z.number().finite().nonnegative(),
  label: z.string().min(1).max(500),
  createdAt: z.string().datetime({ offset: true }),
}).strict();

export type PaidAttemptInput = z.infer<typeof paidAttemptSchema>;
export type PaidAttemptStatus =
  | "reserved"
  | "in_flight"
  | "settled"
  | "not_sent"
  | "unknown"
  | "reconciled_billed"
  | "reconciled_not_billed";

export const reconciliationEvidenceSchema = z.object({
  source: z.enum(["provider_invoice", "provider_usage_export", "provider_support_confirmation"]),
  reference: z.string().min(6).max(256),
  operator: z.string().min(3).max(128),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  currency: z.literal("EUR"),
  checkedAt: z.string().datetime({ offset: true }),
}).strict();

export type PaidReconciliationEvidence = z.infer<typeof reconciliationEvidenceSchema>;
export type PaidReconciliation = {
  resolution: "billed" | "not_billed";
  billedEur: number;
  evidence: PaidReconciliationEvidence;
};

export type PaidAttemptRecord = PaidAttemptInput & {
  status: PaidAttemptStatus;
  billingStatus:
    | "not_sent"
    | "not_charged"
    | "estimate_unverified"
    | "unknown"
    | "provider_confirmed"
    | "confirmed_not_charged";
  startedAt?: string;
  completedAt?: string;
  failureCode?: string;
  usageLines: UsageEntry[];
  estimatedUsageLines?: UsageEntry[];
  estimatedCostEur?: number;
  estimatedOverrunEur?: number;
  reconciliation?: PaidReconciliation;
  budgetOverrunAtReconciliation?: boolean;
};

export type ReserveResult =
  | { ok: true }
  | { ok: false; suspending: boolean; reason: string };

export interface PaidAttemptsRepository {
  reserve(attempt: PaidAttemptInput): Promise<ReserveResult>;
  start(id: string): Promise<void>;
  unknown(id: string, code: "provider_or_callback_error" | "persist_error"): Promise<void>;
  overrun(id: string, lines: UsageEntry[]): Promise<void>;
  finish(id: string, lines: UsageEntry[], status: "settled" | "not_sent"): Promise<void>;
  get(id: string): Promise<PaidAttemptRecord | undefined>;
}

export function validateUsageLines(lines: UsageEntry[], id: string, estimate: number): UsageEntry[] {
  let total = 0;
  for (const [index, line] of lines.entries()) {
    usageEntrySchema.parse(line);
    if (line.id !== `${id}:line:${index}`) {
      throw new Error("Usage line id does not match attempt");
    }
    total += line.costEur;
  }
  if (total > estimate + 1e-9) throw new Error("Usage exceeds estimate");
  return lines;
}

export function usageKind(value: UsageKind): UsageKind {
  return kinds.parse(value);
}

/** Exact 4-decimal monetary units for the estimated-cost ledger. */
export function validateEstimatedUsageLines(lines: UsageEntry[], id: string): number {
  let units = 0;
  if (lines.length === 0) throw new Error("Empty estimated usage");
  for (const [index, line] of lines.entries()) {
    usageEntrySchema.parse(line);
    if (line.id !== `${id}:line:${index}`) throw new Error("Estimated usage line id mismatch");
    const scaled = line.costEur * 10000;
    if (!Number.isSafeInteger(Math.round(scaled)) || Math.abs(scaled - Math.round(scaled)) > 1e-7)
      throw new Error("Invalid estimated cost precision");
    units += Math.round(scaled);
    if (!Number.isSafeInteger(units)) throw new Error("Estimated cost overflow");
  }
  return units / 10000;
}
