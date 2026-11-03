import { createHash } from "node:crypto";
import { z } from "zod";
import type { Ctx, Handler } from "../context";
import { conflict, HttpError, json } from "../http";
import { articleDetail } from "./view";

const keySchema = z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/);
const hexDigest = (input: string): string => createHash("sha256").update(input).digest("hex");
export type IdempotencyClaim =
  | { kind: "claimed" }
  | { kind: "pending" | "uncertain" | "conflict" | "closed_not_sent" }
  | { kind: "recovered_completed"; articleId: string }
  | { kind: "completed"; status: number; bodyText: string };
export type IdempotencyRecord = {
  id: string;
  state: "pending" | "uncertain" | "completed";
  httpStatus?: number;
  bodyText?: string;
};
export interface IdempotencyRepository {
  begin(input: {
    id: string;
    workspaceId: string;
    actorId: string;
    route: string;
    fingerprint: string;
  }): Promise<IdempotencyClaim>;
  complete(id: string, status: number, bodyText: string): Promise<void>;
  uncertain(id: string): Promise<void>;
  get(id: string): Promise<IdempotencyRecord | undefined>;
}
const claimSchema: z.ZodType<IdempotencyClaim> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("claimed") }),
  z.object({ kind: z.literal("pending") }),
  z.object({ kind: z.literal("uncertain") }),
  z.object({ kind: z.literal("conflict") }),
  z.object({
    kind: z.literal("recovered_completed"),
    articleId: z.string().min(1),
  }),
  z.object({ kind: z.literal("closed_not_sent") }),
  z.object({
    kind: z.literal("completed"),
    status: z.number().int().min(200).max(299),
    bodyText: z.string().max(131072),
  }),
]);
export const parseIdempotencyClaim = (value: unknown): IdempotencyClaim => claimSchema.parse(value);

/** HTTP request identity: authenticated actor + route + stable client intent key. */
export async function withHttpIdempotency(
  ctx: Ctx,
  routePattern: string,
  fn: Handler,
): Promise<Response> {
  const rawKey = ctx.request.headers.get("idempotency-key");
  const key = keySchema.safeParse(rawKey);
  if (!key.success) {
    throw new HttpError(
      428,
      "idempotency_key_required",
      "Clé Idempotency-Key requise (16 à 128 caractères).",
    );
  }
  const route = ctx.request.method.toUpperCase() + " " + ctx.url.pathname.replace(/^\/api/, "");
  if (route.length > 300)
    throw new HttpError(400, "invalid_idempotency_scope", "Route trop longue.");
  const id = hexDigest([ctx.repo.workspaceId, ctx.user.id, key.data].join("\u0000"));
  const fingerprint = hexDigest(
    JSON.stringify({ routePattern, route, body: ctx.body ?? null, query: ctx.url.search }),
  );
  const claim = await ctx.repo.idempotency.begin({
    id,
    workspaceId: ctx.repo.workspaceId,
    actorId: ctx.user.id,
    route,
    fingerprint,
  });
  if (claim.kind === "conflict")
    throw conflict("idempotency_key_reused", "Cette clé correspond à une autre opération.");
  if (claim.kind === "pending")
    throw conflict("idempotency_in_progress", "Cette opération est déjà en cours.");
  if (claim.kind === "uncertain")
    throw conflict(
      "idempotency_uncertain",
      "Statut incertain : réexécution payante bloquée, rapprochement requis.",
    );
  if (claim.kind === "closed_not_sent")
    throw conflict("idempotency_closed_not_sent", "Cette tentative a été clôturée administrativement. Utilisez une nouvelle demande.");
  if (claim.kind === "recovered_completed") {
    const article = await ctx.repo.articles.get(claim.articleId);
    if (!article || !article.signalId || (await ctx.repo.signals.get(article.signalId))?.articleId !== article.id)
      throw conflict("recovery_inconsistent", "L’article récupéré ne correspond plus à son signal.");
    return json(await articleDetail(ctx.repo, article, ctx.now), { status: 201 });
  }
  if (claim.kind === "completed") {
    console.info(JSON.stringify({ event: "kora.idempotency.replayed", operationId: id }));
    return new Response(claim.bodyText, {
      status: claim.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-kora-idempotency": "replayed",
      },
    });
  }

  try {
    const response = await fn({ ...ctx, httpOperationId: id });
    if (response.status < 200 || response.status > 299) {
      throw new Error("Idempotent handler returned a non-successful response");
    }
    const bodyText = await response.clone().text();
    if (
      new TextEncoder().encode(bodyText).byteLength > 131072 ||
      !(response.headers.get("content-type") ?? "").includes("application/json")
    ) {
      throw new Error("Idempotent response not storable");
    }
    try {
      await ctx.repo.idempotency.complete(id, response.status, bodyText);
    } catch (persistError: unknown) {
      const persisted = await ctx.repo.idempotency.get(id).catch(() => undefined);
      if (!(
        persisted?.state === "completed" &&
        persisted.httpStatus === response.status &&
        persisted.bodyText === bodyText
      )) {
        throw persistError;
      }
      console.warn(
        JSON.stringify({ event: "kora.idempotency.finish_ack_recovered", operationId: id }),
      );
    }
    return response;
  } catch (error: unknown) {
    await ctx.repo.idempotency.uncertain(id).catch((persistError: unknown) => {
      console.error(
        JSON.stringify({
          event: "kora.idempotency.uncertain_write_failed",
          operationId: id,
          errorType: persistError instanceof Error ? persistError.name : "unknown",
        }),
      );
    });
    throw error;
  }
}
