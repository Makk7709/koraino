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
export type PaidAttemptStatus = "reserved" | "in_flight" | "settled" | "not_sent" | "unknown";
export type PaidAttemptRecord = PaidAttemptInput & {
  status: PaidAttemptStatus;
  billingStatus: "not_sent" | "not_charged" | "estimate_unverified" | "unknown";
  startedAt?: string;
  completedAt?: string;
  failureCode?: string;
  usageLines: UsageEntry[];
};

export type ReserveResult =
  | { ok: true }
  | { ok: false; suspending: boolean; reason: string };

export interface PaidAttemptsRepository {
  reserve(attempt: PaidAttemptInput): Promise<ReserveResult>;
  start(id: string): Promise<void>;
  unknown(id: string, code: "provider_or_callback_error" | "persist_error"): Promise<void>;
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
