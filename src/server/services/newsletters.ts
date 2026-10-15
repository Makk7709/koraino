import type { NewsletterItem } from "@/lib/api/types";
import { adapters } from "../adapters";
import type { Ctx } from "../context";
import { COSTS } from "../domain/budget";
import { addDays, dayStart, HOUR, mondayOf } from "../domain/dates";
import { invalidateApproval, MODIFIED_AFTER_APPROVAL } from "../domain/workflow";
import { conflict, notFound } from "../http";
import type { ArticleRecord, NewsletterRecord, SignalRecord } from "../store/records";
import { audit } from "./journal";
import { GENERATION_LOCK_TTL_MS, WRITE_LOCK_TTL_MS, withLock } from "./locks";
import { assertQuota, paidCall } from "./usage";
import { currentEdition } from "./view";

const weekFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** Nouvelle édition (semaine suivante par défaut, envoi prévu le lundi à 9 h). */
export async function createEdition(
  ctx: Pick<Ctx, "repo" | "user" | "now">,
  input: { title?: string; weekOf?: string } = {},
): Promise<NewsletterRecord> {
  await assertQuota(ctx.repo, ctx.now, "newsletters");
  const week = input.weekOf ? mondayOf(new Date(input.weekOf)) : addDays(mondayOf(ctx.now), 7);
  const scheduled = new Date(dayStart(week).getTime() + 9 * HOUR);
  const rec: NewsletterRecord = {
    id: ctx.repo.nextId("nl"),
    title: input.title ?? `Newsletter Inovallée — semaine du ${weekFmt.format(week)}`,
    weekOf: week.toISOString(),
    intro: "Cette semaine sur Inovallée : les actualités marquantes des entreprises du territoire.",
    items: [],
    status: "composition",
    version: 1,
    approval: null,
    scheduledFor: scheduled.toISOString(),
    createdAt: ctx.now.toISOString(),
    updatedAt: ctx.now.toISOString(),
    createdBy: ctx.user.name,
  };
  await ctx.repo.newsletters.insert(rec);
  await audit(ctx, "newsletter.create", "newsletter", rec.id, rec.title);
  return rec;
}

/** Sous verrou : deux ajouts simultanés sans édition en cours n'en créent qu'une. */
export function ensureCurrentEdition(
  ctx: Pick<Ctx, "repo" | "user" | "now">,
): Promise<NewsletterRecord> {
  return withLock(
    ctx.repo,
    "newsletter-current",
    {
      ttlMs: WRITE_LOCK_TTL_MS,
      waitMs: 5_000,
      busy: () =>
        conflict(
          "newsletter_busy",
          "L'édition en cours est en train d'être créée : réessayez dans quelques secondes.",
        ),
    },
    async () => (await currentEdition(ctx.repo)) ?? createEdition(ctx),
  );
}

/** Toute modification crée une nouvelle version et invalide l'approbation. */
export function touchEdition(rec: NewsletterRecord, now: Date): NewsletterRecord {
  const at = now.toISOString();
  return {
    ...rec,
    version: rec.version + 1,
    approval: invalidateApproval(rec.approval, at, MODIFIED_AFTER_APPROVAL),
    status: "composition",
    updatedAt: at,
  };
}

export function renumber(items: NewsletterItem[]): NewsletterItem[] {
  return [...items].sort((a, b) => a.order - b.order).map((item, i) => ({ ...item, order: i + 1 }));
}

function assertNotExported(edition: NewsletterRecord) {
  if (edition.status === "exportee") {
    throw conflict(
      "invalid_state",
      "Cette édition a déjà été exportée : créez une nouvelle édition.",
    );
  }
}

/**
 * Ajoute un signal ou un article à une édition (résumé généré : appel payant). Verrou par sujet
 * contre le double ajout ; l'édition est relue après l'appel pour ne pas écraser une
 * modification faite pendant la génération.
 */
export async function addItem(
  ctx: Pick<Ctx, "repo" | "user" | "now">,
  edition: NewsletterRecord,
  input: { signalId?: string | null | undefined; articleId?: string | null | undefined },
): Promise<NewsletterRecord> {
  assertNotExported(edition);
  const article = input.articleId ? await ctx.repo.articles.get(input.articleId) : undefined;
  const signalId = input.signalId ?? article?.signalId ?? null;
  const signal = signalId ? await ctx.repo.signals.get(signalId) : undefined;
  if (input.articleId && !article) throw notFound("Article introuvable.");
  if (signalId && !signal) throw notFound("Signal introuvable.");
  return withLock(
    ctx.repo,
    `newsletter-item:${edition.id}:${signalId ?? input.articleId}`,
    {
      ttlMs: GENERATION_LOCK_TTL_MS,
      busy: () =>
        conflict(
          "generation_in_progress",
          "Ce sujet est déjà en cours d'ajout à l'édition : patientez quelques secondes.",
        ),
    },
    () =>
      insertItem(
        ctx,
        edition.id,
        { signalId, articleId: input.articleId ?? null },
        article,
        signal,
      ),
  );
}

async function insertItem(
  ctx: Pick<Ctx, "repo" | "user" | "now">,
  editionId: string,
  input: { signalId: string | null; articleId: string | null },
  article: ArticleRecord | undefined,
  signal: SignalRecord | undefined,
): Promise<NewsletterRecord> {
  const current = async () => {
    const rec = await ctx.repo.newsletters.get(editionId);
    if (!rec) throw notFound("Édition introuvable.");
    assertNotExported(rec);
    return rec;
  };
  const edition = await current();
  const duplicate = edition.items.find(
    (i) =>
      (input.signalId && i.signalId === input.signalId) ||
      (input.articleId && i.articleId === input.articleId),
  );
  if (duplicate) {
    throw conflict("already_in_newsletter", "Ce sujet figure déjà dans l'édition.", {
      itemId: duplicate.id,
    });
  }
  const title = article?.title ?? signal?.title ?? "";
  const text = article?.excerpt || signal?.summary || title;
  const summary = await paidCall(
    ctx,
    {
      kind: "generation_summary",
      estimate: COSTS.summary,
      units: 1,
      label: `Résumé newsletter : ${title}`,
    },
    async () => {
      const input = { title, text };
      const base = adapters().textModel.summarize(input);
      return (await adapters().ai?.enhanceSummary(input, base)) ?? base;
    },
  );
  const next = await withLock(
    ctx.repo,
    `newsletter-write:${editionId}`,
    {
      ttlMs: WRITE_LOCK_TTL_MS,
      waitMs: 5_000,
      busy: () =>
        conflict(
          "newsletter_busy",
          "L'édition est en cours de mise à jour : réessayez dans quelques secondes.",
        ),
    },
    async () => {
      const latest = await current();
      const item: NewsletterItem = {
        id: ctx.repo.nextId("nli"),
        signalId: input.signalId,
        articleId: article?.id ?? signal?.articleId ?? null,
        title,
        summary,
        order: latest.items.length + 1,
      };
      const updated = touchEdition(
        { ...latest, items: renumber([...latest.items, item]) },
        ctx.now,
      );
      await ctx.repo.newsletters.update(updated);
      return updated;
    },
  );
  await audit(ctx, "newsletter.item_add", "newsletter", editionId, `Ajout : ${title}`);
  return next;
}

export async function removeItems(
  ctx: Pick<Ctx, "repo" | "user" | "now">,
  edition: NewsletterRecord,
  predicate: (item: NewsletterItem) => boolean,
): Promise<NewsletterRecord> {
  const removed = edition.items.filter(predicate);
  if (!removed.length) return edition;
  if (edition.status === "exportee") {
    throw conflict(
      "invalid_state",
      "Cette édition a déjà été exportée : elle n'est plus modifiable.",
    );
  }
  const next = touchEdition(
    { ...edition, items: renumber(edition.items.filter((i) => !predicate(i))) },
    ctx.now,
  );
  await ctx.repo.newsletters.update(next);
  await audit(
    ctx,
    "newsletter.item_remove",
    "newsletter",
    edition.id,
    `Retrait : ${removed.map((i) => i.title).join(" ; ")}`,
  );
  return next;
}
