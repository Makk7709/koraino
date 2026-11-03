import type { ScoringGrid, Signal, SignalStatus } from "@/lib/api/types";
import { adapters } from "../adapters";
import type { Ctx, Handler } from "../context";
import { assertCan } from "../domain/permissions";
import { applyGrid, isDecided, validateWeights } from "../domain/scoring";
import { normalize } from "../domain/text";
import { conflict, json, notFound, unprocessable } from "../http";
import type { GridRecord, ObservationRecord, SignalRecord } from "../store/records";
import type { SignalMutation } from "../store/signal-mutations";
import { collectAll, collectOne } from "../services/collection";
import { audit } from "../services/journal";
import { addItem, ensureCurrentEdition, removeItems, renumber } from "../services/newsletters";
import { improveSummary } from "../services/summary-ai";
import {
  activeGrid,
  applyGridToSignals,
  rebuildSignal,
  saveRebuilt,
  STATUS_LABEL,
} from "../services/signals";
import { currentEdition, loadSignalView, signalDetail, toSignal } from "../services/view";
import { CATEGORIES, parse, schemas, SIGNAL_STATUSES, THEMES } from "../validation";

async function getSignalOr404(ctx: Ctx, id: string): Promise<SignalRecord> {
  const s = await ctx.repo.signals.get(id);
  if (!s) throw notFound("Signal introuvable.");
  return s;
}

async function signalDto(ctx: Ctx, id: string): Promise<Signal> {
  const rec = await getSignalOr404(ctx, id);
  return toSignal(rec, await loadSignalView(ctx.repo, ctx.now));
}

/** Reconstruit un signal ; un signal décidé conserve le score et la grille de sa décision. */
async function rebuild(ctx: Ctx, signal: SignalRecord, grid: GridRecord, others: SignalRecord[]) {
  const [observations, company] = await Promise.all([
    ctx.repo.observations.list(),
    signal.companyId ? ctx.repo.companies.get(signal.companyId) : Promise.resolve(undefined),
  ]);
  const ids = new Set(signal.observationIds);
  const rebuilt = rebuildSignal({
    signal,
    observations: observations.filter((o) => ids.has(o.id)),
    company: company ?? null,
    grid,
    others,
    now: ctx.now,
  });
  if (isDecided(signal.status)) {
    rebuilt.signal = {
      ...rebuilt.signal,
      score: signal.score,
      whyInteresting: signal.whyInteresting,
      suggestedAngle: signal.suggestedAngle,
    };
  }
  await saveRebuilt(ctx.repo, rebuilt);
  return rebuilt.signal;
}

/* ------------------------------------------------------------------ */
/* Collecte (WF1)                                                      */
/* ------------------------------------------------------------------ */

export const collectSourceHandler: Handler = async (ctx) => {
  assertCan(ctx.user, "collect");
  const source = await ctx.repo.sources.get(ctx.params["id"]!);
  if (!source) throw notFound("Source introuvable.");
  return json(await collectOne(ctx, source));
};

export const collectAllHandler: Handler = async (ctx) => {
  assertCan(ctx.user, "collect");
  const batch = await collectAll(ctx, parse(schemas.collectAll, ctx.body));
  const created = batch.runs.reduce((s, r) => s + r.newObservations, 0);
  const failed = batch.runs.filter((r) => r.status === "echec").length;
  const blocked = batch.runs.filter((r) => r.status === "bloque_quota").length;
  await audit(
    ctx,
    "collect.all",
    "source",
    "*",
    `Lot de ${batch.runs.length} source(s) sur ${batch.total} : ${created} nouvelles observations, ${failed} échec(s)` +
      (blocked ? `, ${blocked} bloquée(s) par le budget` : "") +
      (batch.remaining ? ` ; ${batch.remaining} source(s) restante(s)` : " ; collecte terminée"),
  );
  return json(batch);
};

export const listRuns: Handler = async (ctx) => {
  const sourceId = ctx.query.get("sourceId");
  const limit = clampInt(ctx.query.get("limit"), 50, 1, 500);
  const runs = (await ctx.repo.runs.list())
    .filter((r) => !sourceId || r.sourceId === sourceId)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || b.id.localeCompare(a.id))
    .slice(0, limit);
  return json(runs);
};

/* ------------------------------------------------------------------ */
/* Signaux                                                             */
/* ------------------------------------------------------------------ */

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = raw === null || raw === "" ? fallback : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export const listSignals: Handler = async (ctx) => {
  const q = ctx.query;
  const status = q.get("status");
  const category = q.get("category");
  const theme = q.get("theme");
  if (status && status !== "tous" && !(SIGNAL_STATUSES as readonly string[]).includes(status)) {
    throw unprocessable("invalid_filter", `Statut inconnu : ${status}`);
  }
  if (category && !(CATEGORIES as readonly string[]).includes(category)) {
    throw unprocessable("invalid_filter", `Catégorie inconnue : ${category}`);
  }
  if (theme && !(THEMES as readonly string[]).includes(theme)) {
    throw unprocessable("invalid_filter", `Thématique inconnue : ${theme}`);
  }
  const companyId = q.get("companyId");
  const outletRaw = (q.get("outlet") ?? "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  const outlet = normalize(outletRaw);
  const text = normalize(q.get("q") ?? "");
  const sort = q.get("sort") === "score" ? "score" : "recent";
  const limit = clampInt(q.get("limit"), 50, 1, 200);
  const offset = clampInt(q.get("offset"), 0, 0, 100_000);

  const view = await loadSignalView(ctx.repo, ctx.now);
  const all = await ctx.repo.signals.list();
  const filtered = all.filter((s) => {
    if (status && status !== "tous" && s.status !== status) return false;
    if (companyId && s.companyId !== companyId) return false;
    if (category && s.category !== category) return false;
    if (theme && !s.themes.includes(theme as Signal["themes"][number])) return false;
    if (outlet) {
      const outlets = (view.obsBySignal.get(s.id) ?? []).map((o) => o.outlet);
      if (
        ![s.primaryOutlet, ...outlets].some(
          (o) => normalize(o.name) === outlet || o.domain === outletRaw,
        )
      )
        return false;
    }
    if (text) {
      const company = s.companyId ? view.companies.get(s.companyId) : undefined;
      const hay = normalize([s.title, s.summary, company?.name ?? "", ...s.tags].join(" "));
      if (!hay.includes(text)) return false;
    }
    return true;
  });
  // Même date que celle affichée (publication, sinon événement), puis la collecte.
  const newsTime = (s: SignalRecord) => Date.parse(s.publishedAt ?? s.eventDate ?? s.collectedAt);
  const byRecent = (a: SignalRecord, b: SignalRecord) =>
    newsTime(b) - newsTime(a) ||
    Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
    b.id.localeCompare(a.id);
  filtered.sort(
    sort === "score" ? (a, b) => b.score.total - a.score.total || byRecent(a, b) : byRecent,
  );
  return json({
    items: filtered.slice(offset, offset + limit).map((s) => toSignal(s, view)),
    total: filtered.length,
  });
};

export const getSignal: Handler = async (ctx) =>
  json(await signalDetail(ctx.repo, await getSignalOr404(ctx, ctx.params["id"]!), ctx.now));

export const patchSignal: Handler = async (ctx) => {
  const input = parse(schemas.signalPatch, ctx.body);
  let rec = await getSignalOr404(ctx, ctx.params["id"]!);
  const touchesSignal =
    input.status !== undefined || input.companyId !== undefined || input.statusReason !== undefined;
  if (touchesSignal || input.inNewsletter === undefined) assertCan(ctx.user, "signal.write");
  if (input.inNewsletter !== undefined) assertCan(ctx.user, "newsletter.write");
  const at = ctx.now.toISOString();

  if (input.status !== undefined && input.status !== rec.status) {
    const reason = input.statusReason?.trim() || null;
    if (input.status === "rejete" && !reason) {
      throw unprocessable("reason_required", "Le motif est obligatoire pour rejeter un signal.");
    }
    const from: SignalStatus = rec.status;
    rec = { ...rec, status: input.status, statusReason: reason, updatedAt: at };
    await ctx.repo.signals.update(rec);
    await audit(
      ctx,
      "signal.status",
      "signal",
      rec.id,
      `${STATUS_LABEL[from]} → ${STATUS_LABEL[input.status]}${reason ? ` — motif : ${reason}` : ""}`,
    );
  } else if (input.statusReason !== undefined && input.status === undefined) {
    rec = { ...rec, statusReason: input.statusReason?.trim() || null, updatedAt: at };
    await ctx.repo.signals.update(rec);
  }

  if (input.companyId !== undefined && input.companyId !== rec.companyId) {
    const others = await ctx.repo.signals.list();
    if (input.companyId) {
      const company = await ctx.repo.companies.get(input.companyId);
      if (!company) throw notFound("Entreprise introuvable.");
      for (const id of rec.observationIds) {
        const o = await ctx.repo.observations.get(id);
        if (o)
          await ctx.repo.observations.update({ ...o, companyId: company.id, matchConfidence: 100 });
      }
      rec = {
        ...rec,
        companyId: company.id,
        matchConfidence: 100,
        review: null,
        themes: [...company.themes],
        updatedAt: at,
      };
      rec = await rebuild(ctx, rec, await activeGrid(ctx.repo), others);
      await audit(ctx, "signal.attach", "signal", rec.id, `Rattachement manuel à ${company.name}`);
    } else {
      for (const id of rec.observationIds) {
        const o = await ctx.repo.observations.get(id);
        if (o) await ctx.repo.observations.update({ ...o, companyId: null });
      }
      rec = {
        ...rec,
        companyId: null,
        themes: [],
        review: { kind: "homonymie", note: "Détaché manuellement : entreprise à rattacher" },
        updatedAt: at,
      };
      rec = await rebuild(ctx, rec, await activeGrid(ctx.repo), others);
      await audit(ctx, "signal.detach", "signal", rec.id, "Rattachement retiré");
    }
  }

  if (input.inNewsletter !== undefined) {
    if (input.inNewsletter) {
      const edition = await ensureCurrentEdition(ctx);
      if (!edition.items.some((i) => i.signalId === rec.id))
        await addItem(ctx, edition, { signalId: rec.id });
    } else {
      const edition = await currentEdition(ctx.repo);
      if (edition) await removeItems(ctx, edition, (i) => i.signalId === rec.id);
    }
  }
  return json(await signalDto(ctx, rec.id));
};

/** A4.2: prepare all changes before a single compare-and-swap transaction. */
export const mergeSignals: Handler = async (ctx) => {
  assertCan(ctx.user, "signal.write");
  const { otherIds } = parse(schemas.merge, ctx.body);
  const target = await getSignalOr404(ctx, ctx.params["id"]!);
  const ids = [...new Set(otherIds)];
  if (ids.includes(target.id))
    throw unprocessable("invalid_merge", "Un signal ne peut être fusionné avec lui-même.");
  const others: SignalRecord[] = [];
  for (const id of ids) others.push(await getSignalOr404(ctx, id));
  const companies = new Set(
    [target, ...others].map((signal) => signal.companyId).filter((id): id is string => !!id),
  );
  if (companies.size > 1)
    throw unprocessable("company_mismatch", "Les signaux concernent des entreprises différentes.");

  const companyId = target.companyId ?? [...companies][0] ?? null;
  const removed = new Set(ids);
  const [allObservations, allArticles, allPosts, allNewsletters, allSignals, grid, company] =
    await Promise.all([
      ctx.repo.observations.list(),
      ctx.repo.articles.list(),
      ctx.repo.linkedin.list(),
      ctx.repo.newsletters.list(),
      ctx.repo.signals.list(),
      activeGrid(ctx.repo),
      companyId ? ctx.repo.companies.get(companyId) : Promise.resolve(undefined),
    ]);
  const involved = new Set([target.id, ...ids]);
  const linkedArticles = allArticles.filter((a) => a.signalId && involved.has(a.signalId));
  // A4 guarantees at most one article per signal. Never silently discard an article.
  if (linkedArticles.length > 1)
    throw conflict(
      "merge_article_conflict",
      "La fusion de signaux possédant plusieurs articles nécessite un arbitrage éditorial.",
      { articleIds: linkedArticles.map((a) => a.id) },
    );
  const movedObs = others.flatMap((signal) => signal.observationIds);
  const finalObsIds = [...new Set([...target.observationIds, ...movedObs])];
  const obsById = new Map(allObservations.map((obs) => [obs.id, obs]));
  if (finalObsIds.some((id) => !obsById.has(id)))
    throw conflict("signal_changed", "Une observation a disparu : rechargez les signaux.");

  const changes: SignalMutation[] = [];
  const finalObservations = finalObsIds.map((id) => {
    const previous = obsById.get(id)!;
    const after = {
      ...previous,
      signalId: target.id,
      ...(removed.has(previous.signalId ?? "") && companyId ? { companyId } : {}),
    };
    if (JSON.stringify(previous) !== JSON.stringify(after))
      changes.push({ collection: "observations", id, before: previous, after });
    return after;
  });
  for (const article of allArticles) {
    if (article.signalId && removed.has(article.signalId)) {
      changes.push({
        collection: "articles", id: article.id, before: article,
        after: { ...article, signalId: target.id },
      });
    }
  }
  for (const post of allPosts) {
    if (post.signalId && removed.has(post.signalId)) {
      changes.push({
        collection: "linkedin", id: post.id, before: post,
        after: { ...post, signalId: target.id },
      });
    }
  }
  for (const edition of allNewsletters) {
    if (!edition.items.some((item) => item.signalId && removed.has(item.signalId))) continue;
    let seen = edition.items.some((item) => item.signalId === target.id);
    const items = edition.items.flatMap((item) => {
      if (!item.signalId || !removed.has(item.signalId)) return [item];
      if (seen) return [];
      seen = true;
      return [{ ...item, signalId: target.id }];
    });
    changes.push({
      collection: "newsletters", id: edition.id, before: edition,
      after: { ...edition, items: renumber(items) },
    });
  }
  const merged: SignalRecord = {
    ...target,
    companyId,
    themes: target.companyId ? target.themes : [...(company?.themes ?? [])],
    observationIds: finalObsIds,
    articleId: linkedArticles[0]?.id ?? null,
    review: target.review?.kind === "fusion_incertaine" || companyId ? null : target.review,
    matchConfidence: Math.max(target.matchConfidence, ...others.map((signal) => signal.matchConfidence)),
    tags: [...new Set([...target.tags, ...others.flatMap((signal) => signal.tags)])].slice(0, 6),
  };
  const rebuilt = rebuildSignal({
    signal: merged,
    observations: finalObservations,
    company: company ?? null,
    grid,
    others: allSignals.filter((signal) => !removed.has(signal.id)),
    now: ctx.now,
  });
  changes.push({ collection: "signals", id: target.id, before: target, after: rebuilt.signal });
  for (const source of others)
    changes.push({ collection: "signals", id: source.id, before: source, after: null });
  changes.push({
    collection: "audit",
    id: ctx.repo.nextId("aud"),
    before: null,
    after: {
      id: "", at: "", actor: "", action: "", entity: "signal", entityId: "", details: "",
    },
  });
  const last = changes[changes.length - 1]!;
  if (last.collection !== "audit" || !last.after) throw new Error("Missing transaction audit");
  last.after = {
    id: last.id, at: ctx.now.toISOString(), actor: ctx.user.name,
    action: "signal.merge", entity: "signal", entityId: target.id,
    details: `Fusion de ${ids.join(", ")} dans ${target.id} (${movedObs.length} observation(s))`,
  };
  await ctx.repo.signalMutations.commit(changes);
  return json(await signalDto(ctx, target.id));
};

export const splitSignal: Handler = async (ctx) => {
  assertCan(ctx.user, "signal.write");
  const { observationIds } = parse(schemas.split, ctx.body);
  const original = await getSignalOr404(ctx, ctx.params["id"]!);
  const moving = [...new Set(observationIds)];
  if (moving.some((id) => !original.observationIds.includes(id)))
    throw unprocessable("invalid_split", "Ces observations n'appartiennent pas au signal.", { observationIds: moving });
  if (moving.length >= original.observationIds.length)
    throw unprocessable("invalid_split", "La défusion doit laisser au moins une observation dans le signal d'origine.");

  const [allObservations, grid, allSignals, company] = await Promise.all([
    ctx.repo.observations.list(),
    activeGrid(ctx.repo),
    ctx.repo.signals.list(),
    original.companyId ? ctx.repo.companies.get(original.companyId) : Promise.resolve(undefined),
  ]);
  const obsById = new Map(allObservations.map((observation) => [observation.id, observation]));
  const selected = moving.map((id) => obsById.get(id));
  if (selected.some((observation) => !observation || observation.signalId !== original.id))
    throw conflict("signal_changed", "Les observations ont changé : rechargez le signal.");
  const sorted = [...selected] as ObservationRecord[];
  sorted.sort((a, b) =>
    Date.parse(a.publishedAt ?? a.collectedAt) - Date.parse(b.publishedAt ?? b.collectedAt),
  );
  const first = sorted[0]!;
  const at = ctx.now.toISOString();
  const createdId = ctx.repo.nextId("sig");
  // Summary preparation (possibly billable) happens before the first business mutation.
  const summaryInput = { title: first.title, text: first.excerpt };
  const summary = await improveSummary(ctx, summaryInput, adapters().textModel.summarize(summaryInput));

  const remainingIds = original.observationIds.filter((id) => !moving.includes(id));
  const remainingObs = remainingIds.map((id) => obsById.get(id));
  if (remainingObs.some((observation) => !observation))
    throw conflict("signal_changed", "Une observation a disparu : rechargez le signal.");
  const newObs = sorted.map((observation) => ({ ...observation, signalId: createdId }));
  const source: SignalRecord = {
    ...original,
    observationIds: remainingIds,
    review: original.review?.kind === "fusion_incertaine" ? null : original.review,
    updatedAt: at,
  };
  const draft: SignalRecord = {
    ...original,
    id: createdId,
    title: first.title,
    summary,
    status: "nouveau",
    statusReason: null,
    observationIds: moving,
    review: null,
    articleId: null,
    createdAt: at,
    updatedAt: at,
  };
  const withoutNew = allSignals.filter((signal) => signal.id !== original.id);
  const kept = rebuildSignal({
    signal: source,
    observations: remainingObs as ObservationRecord[],
    company: company ?? null,
    grid,
    others: allSignals,
    now: ctx.now,
  }).signal;
  const created = rebuildSignal({
    signal: draft,
    observations: newObs,
    company: company ?? null,
    grid,
    others: [...withoutNew, kept],
    now: ctx.now,
  }).signal;
  const changes: SignalMutation[] = [
    ...sorted.map((observation): SignalMutation => ({
      collection: "observations", id: observation.id, before: observation,
      after: { ...observation, signalId: createdId },
    })),
    { collection: "signals", id: original.id, before: original, after: kept },
    { collection: "signals", id: createdId, before: null, after: created },
  ];
  const auditId = ctx.repo.nextId("aud");
  changes.push({
    collection: "audit", id: auditId, before: null,
    after: {
      id: auditId, at, actor: ctx.user.name,
      action: "signal.split", entity: "signal", entityId: original.id,
      details: `Défusion : ${moving.length} observation(s) détachée(s) vers ${created.id}`,
    },
  });
  await ctx.repo.signalMutations.commit(changes);
  const view = await loadSignalView(ctx.repo, ctx.now);
  return json({ original: toSignal(kept, view), created: toSignal(created, view) }, { status: 201 });
};

/** Recalcul avec la grille active ; les signaux traités ou rejetés gardent leur grille d'origine. */
export const rescoreSignals: Handler = async (ctx) => {
  assertCan(ctx.user, "grid.write");
  const grid = await activeGrid(ctx.repo);
  const rescored = await applyGridToSignals(ctx.repo, grid);
  await audit(
    ctx,
    "grid.rescore",
    "grid",
    grid.id,
    `${rescored} signal(aux) recalculé(s) avec la grille v${grid.version}`,
  );
  return json({ rescored });
};

/* ------------------------------------------------------------------ */
/* Grilles de score                                                    */
/* ------------------------------------------------------------------ */

function toGrid(g: GridRecord): ScoringGrid {
  const { id: _id, ...dto } = g;
  return dto;
}

export const listGrids: Handler = async (ctx) =>
  json((await ctx.repo.grids.list()).sort((a, b) => b.version - a.version).map(toGrid));

export const createGrid: Handler = async (ctx) => {
  assertCan(ctx.user, "grid.write");
  const input = parse(schemas.grid, ctx.body);
  const error = validateWeights(input.weights);
  if (error) throw unprocessable("weights_sum_invalid", error, { weights: input.weights });
  const grids = await ctx.repo.grids.list();
  const version = Math.max(0, ...grids.map((g) => g.version)) + 1;
  for (const g of grids) if (g.active) await ctx.repo.grids.update({ ...g, active: false });
  const rec: GridRecord = {
    id: `grid_v${version}`,
    version,
    weights: { ...input.weights },
    createdAt: ctx.now.toISOString(),
    createdBy: ctx.user.name,
    active: true,
    note: input.note ?? null,
  };
  await ctx.repo.grids.insert(rec);
  // La grille active s'applique aussitôt aux signaux non décidés ; les décisions historiques
  // gardent leur score et leur version (voir `applyGridToSignals`).
  const rescored = await applyGridToSignals(ctx.repo, rec);
  const w = rec.weights;
  await audit(
    ctx,
    "grid.create",
    "grid",
    rec.id,
    `Grille v${version} : importance ${w.importance}, nouveauté ${w.nouveaute}, territoire ${w.territoire}, lecteurs ${w.lecteurs}, diffusion ${w.diffusion} ; ${rescored} signal(aux) recalculé(s)`,
  );
  return json({ ...toGrid(rec), rescored }, { status: 201 });
};
