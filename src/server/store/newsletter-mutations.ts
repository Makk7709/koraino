import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { conflict } from "../http";
import type { AuditEvent, NewsletterRecord, PublicationRecord } from "./records";

export const newsletterExpectation = z.object({
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

/** Validate the RPC response before treating it as committed editorial state. */
export const newsletterRecordSchema = newsletterExpectation
  .extend({
    id: z.string().min(1).max(64),
    title: z.string(),
    intro: z.string(),
    weekOf: z.string(),
    scheduledFor: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    createdBy: z.string(),
    status: z.enum(["composition", "approuvee", "exportee"]),
    items: z.array(
      z.object({
        id: z.string().min(1),
        signalId: z.string().nullable(),
        articleId: z.string().nullable(),
        title: z.string(),
        summary: z.string(),
        order: z.number().int().positive(),
      }),
    ),
    approval: z
      .object({
        id: z.string(),
        version: z.number().int().positive(),
        channel: z.literal("newsletter"),
        approvedBy: z.string(),
        approvedAt: z.string(),
        scheduledAt: z.string().nullable(),
        valid: z.boolean(),
        invalidatedAt: z.string().nullable(),
        invalidatedReason: z.string().nullable(),
      })
      .nullable(),
    revision: newsletterExpectation.shape.revision.default(0),
  })
  .passthrough() satisfies z.ZodType<NewsletterRecord, z.ZodTypeDef, unknown>;

export const revisionOf = (edition: NewsletterRecord) => edition.revision ?? 0;
export const newsletterConflict = () =>
  conflict(
    "version_mismatch",
    "Cette édition a changé. Vos saisies sont conservées ; rechargez la version courante avant de réessayer.",
  );

export function expectNewsletter(
  edition: NewsletterRecord,
  expected: z.infer<typeof newsletterExpectation>,
  exportReplay = false,
) {
  if (
    edition.version !== expected.version ||
    (revisionOf(edition) !== expected.revision &&
      !(
        exportReplay &&
        edition.status === "exportee" &&
        revisionOf(edition) === expected.revision + 1
      ))
  )
    throw newsletterConflict();
}

export interface NewsletterMutation {
  before: NewsletterRecord | null;
  after: NewsletterRecord;
  audit: AuditEvent;
  publication: PublicationRecord | null;
}

export interface NewsletterMutationsRepository {
  /** CAS of the entire stored state, with audit and optional export in one transaction. */
  commit(input: NewsletterMutation): Promise<NewsletterRecord>;
}

const contentOf = (e: NewsletterRecord) => ({
  title: e.title,
  intro: e.intro,
  items: e.items,
  weekOf: e.weekOf,
  scheduledFor: e.scheduledFor,
});

/** Shared memory invariant; PostgreSQL enforces the equivalent in a trigger. */
export function validateNewsletterTransition(
  before: NewsletterRecord | null,
  after: NewsletterRecord,
) {
  newsletterRecordSchema.parse(after);
  for (const field of ["id", "signalId", "articleId"] as const) {
    const ids = after.items.flatMap((i) => (i[field] ? [i[field]] : []));
    if (new Set(ids).size !== ids.length) throw new Error("Duplicate newsletter subject");
  }
  if (!before) {
    if (
      after.version !== 1 ||
      revisionOf(after) !== 0 ||
      after.status !== "composition" ||
      after.approval
    )
      throw new Error("Invalid initial newsletter");
    return;
  }
  if (
    before.status === "exportee" ||
    after.id !== before.id ||
    revisionOf(after) !== revisionOf(before) + 1
  )
    throw newsletterConflict();
  if (after.createdAt !== before.createdAt || after.createdBy !== before.createdBy)
    throw new Error("Newsletter creation metadata is immutable");
  if (!isDeepStrictEqual(contentOf(before), contentOf(after))) {
    if (
      after.version !== before.version + 1 ||
      after.status !== "composition" ||
      after.approval?.valid
    )
      throw new Error("Newsletter edits must invalidate approval");
  } else {
    if (
      after.version !== before.version ||
      !after.items.length ||
      !after.approval?.valid ||
      after.approval.version !== after.version ||
      after.approval.channel !== "newsletter" ||
      !["approuvee", "exportee"].includes(after.status)
    )
      throw new Error("Invalid newsletter decision");
    if (
      after.status === "exportee" &&
      (before.status !== "approuvee" || !isDeepStrictEqual(before.approval, after.approval))
    )
      throw new Error("Export requires current approval");
  }
}

export function isNewsletterExportReplay(current: NewsletterRecord, input: NewsletterMutation) {
  return (
    !!input.publication &&
    !!input.before &&
    current.status === "exportee" &&
    current.version === input.before.version &&
    current.approval?.valid &&
    current.approval.version === current.version &&
    isDeepStrictEqual(contentOf(current), contentOf(input.before)) &&
    isDeepStrictEqual(current.approval, input.before.approval) &&
    (revisionOf(current) === revisionOf(input.before) ||
      revisionOf(current) === revisionOf(input.before) + 1)
  );
}
