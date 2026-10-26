import type { ScoringGrid, Signal, SignalStatus } from "@/lib/api/types";
import { adapters, enhanceSummary } from "../adapters";
import type { Ctx, Handler } from "../context";
import { assertCan } from "../domain/permissions";
import { applyGrid, isDecided, validateWeights } from "../domain/scoring";
import { normalize } from "../domain/text";
import { json, notFound, unprocessable } from "../http";
import type { GridRecord, SignalRecord } from "../store/records";
import { collectAll, collectOne } from "../services/collection";
import { audit } from "../services/journal";
import { addItem, ensureCurrentEdition, removeItems, renumber } from "../services/newsletters";
import { activeGrid, rebuildSignal, saveRebuilt, STATUS_LABEL } from "../services/signals";
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

export const mergeSignals: Handler = async (ctx) => {
  assertCan(ctx.user, "signal.write");
  const { otherIds } = parse(schemas.merge, ctx.body);
  const target = await getSignalOr404(ctx, ctx.params["id"]!);
  const ids = [...new Set(otherIds)];
  if (ids.includes(target.id))
    throw unprocessable("invalid_merge", "Un signal ne peut pas être fusionné avec lui-même.");
  const others: SignalRecord[] = [];
  for (const id of ids) others.push(await getSignalOr404(ctx, id));
  const companies = new Set(
    [target, ...others].map((s) => s.companyId).filter((c): c is string => !!c),
  );
  if (companies.size > 1) {
    throw unprocessable(
      "company_mismatch",
      "Fusion impossible : les signaux concernent des entreprises différentes.",
    );
  }
  const companyId = target.companyId ?? [...companies][0] ?? null;
  const movedObs = others.flatMap((s) => s.observationIds);
  for (const id of movedObs) {
    const o = await ctx.repo.observations.get(id);
    if (o)
      await ctx.repo.observations.update({
        ...o,
        signalId: target.id,
        companyId: companyId ?? o.companyId,
      });
  }
  let articleId = target.articleId;
  const removed = new Set(ids);
  for (const a of await ctx.repo.articles.list()) {
    if (a.signalId && removed.has(a.signalId)) {
      await ctx.repo.articles.update({ ...a, signalId: target.id });
      articleId ??= a.id;
    }
  }
  for (const p of await ctx.repo.linkedin.list()) {
    if (p.signalId && removed.has(p.signalId))
      await ctx.repo.linkedin.update({ ...p, signalId: target.id });
  }
  for (const n of await ctx.repo.newsletters.list()) {
    if (!n.items.some((i) => i.signalId && removed.has(i.signalId))) continue;
    let seen = n.items.some((i) => i.signalId === target.id);
    const items = n.items.flatMap((i) => {
      if (!i.signalId || !removed.has(i.signalId)) return [i];
      if (seen) return [];
      seen = true;
      return [{ ...i, signalId: target.id }];
    });
    await ctx.repo.newsletters.update({ ...n, items: renumber(items) });
  }
  for (const id of ids) await ctx.repo.signals.remove(id);

  const company = companyId ? await ctx.repo.companies.get(companyId) : undefined;
  const merged: SignalRecord = {
    ...target,
    companyId,
    themes: target.companyId ? target.themes : [...(company?.themes ?? [])],
    observationIds: [...target.observationIds, ...movedObs],
    articleId,
    review: target.review?.kind === "fusion_incertaine" || companyId ? null : target.review,
    matchConfidence: Math.max(target.matchConfidence, ...others.map((o) => o.matchConfidence)),
    tags: [...new Set([...target.tags, ...others.flatMap((o) => o.tags)])].slice(0, 6),
  };
  const rebuilt = await rebuild(
    ctx,
    merged,
    await activeGrid(ctx.repo),
    await ctx.repo.signals.list(),
  );
  await audit(
    ctx,
    "signal.merge",
    "signal",
    target.id,
    `Fusion de ${ids.join(", ")} dans ${target.id} (${movedObs.length} observation(s))`,
  );
  return json(await signalDto(ctx, rebuilt.id));
};

export const splitSignal: Handler = async (ctx) => {
  assertCan(ctx.user, "signal.write");
  const { observationIds } = parse(schemas.split, ctx.body);
  const original = await getSignalOr404(ctx, ctx.params["id"]!);
  const moving = [...new Set(observationIds)];
  const unknown = moving.filter((id) => !original.observationIds.includes(id));
  if (unknown.length) {
    throw unprocessable("invalid_split", "Ces observations n'appartiennent pas au signal.", {
      observationIds: unknown,
    });
  }
  if (moving.length >= original.observationIds.length) {
    throw unprocessable(
      "invalid_split",
      "La défusion doit laisser au moins une observation dans le signal d'origine.",
    );
  }
  const observations = await Promise.all(moving.map((id) => ctx.repo.observations.get(id)));
  const first = observations
    .filter((o): o is NonNullable<typeof o> => !!o)
    .sort(
      (a, b) =>
        Date.parse(a.publishedAt ?? a.collectedAt) - Date.parse(b.publishedAt ?? b.collectedAt),
    )[0]!;
  const at = ctx.now.toISOString();
  const createdId = ctx.repo.nextId("sig");
  for (const o of observations)
    if (o) await ctx.repo.observations.update({ ...o, signalId: createdId });
  const grid = await activeGrid(ctx.repo);
  const remaining: SignalRecord = {
    ...original,
    observationIds: original.observationIds.filter((id) => !moving.includes(id)),
    review: original.review?.kind === "fusion_incertaine" ? null : original.review,
    updatedAt: at,
  };
  const draft: SignalRecord = {
    ...original,
    id: createdId,
    title: first.title,
    summary: await enhanceSummary({ title: first.title, text: first.excerpt }),
    status: "nouveau",
    statusReason: null,
    observationIds: moving,
    review: null,
    articleId: null,
    createdAt: at,
    updatedAt: at,
  };
  await ctx.repo.signals.insert(draft);
  const all = await ctx.repo.signals.list();
  const kept = await rebuild(ctx, remaining, grid, all);
  const created = await rebuild(ctx, draft, grid, all);
  await audit(
    ctx,
    "signal.split",
    "signal",
    original.id,
    `Défusion : ${moving.length} observation(s) détachée(s) vers ${created.id}`,
  );
  const view = await loadSignalView(ctx.repo, ctx.now);
  return json(
    { original: toSignal(kept, view), created: toSignal(created, view) },
    { status: 201 },
  );
};

/** Recalcul avec la grille active ; les signaux traités ou rejetés gardent leur grille d'origine. */
export const rescoreSignals: Handler = async (ctx) => {
  assertCan(ctx.user, "grid.write");
  const grid = await activeGrid(ctx.repo);
  let rescored = 0;
  for (const s of await ctx.repo.signals.list()) {
    if (isDecided(s.status)) continue;
    const score = applyGrid(s.score, grid);
    if (score.total === s.score.total && score.gridVersion === s.score.gridVersion) continue;
    await ctx.repo.signals.update({ ...s, score });
    rescored += 1;
  }
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
  const w = rec.weights;
  await audit(
    ctx,
    "grid.create",
    "grid",
    rec.id,
    `Grille v${version} : importance ${w.importance}, nouveauté ${w.nouveaute}, territoire ${w.territoire}, lecteurs ${w.lecteurs}, diffusion ${w.diffusion}`,
  );
  return json(toGrid(rec), { status: 201 });
};
