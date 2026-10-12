import type { CollectionRun } from "@/lib/api/types";
import { adapters, enhanceSummary } from "../adapters";
import type { CollectResult, RawItem } from "../adapters/collector";
import type { Ctx } from "../context";
import { budgetExhausted, COSTS } from "../domain/budget";
import {
  CLUSTER_WINDOW_DAYS,
  canonicalUrl,
  classifyCategory,
  decideCluster,
  MATCH_THRESHOLD,
  matchCompany,
} from "../domain/clustering";
import { DAY } from "../domain/dates";
import { isDecided } from "../domain/scoring";
import { sanitizeText, validateSourceUrl } from "../domain/security";
import { HttpError, conflict } from "../http";
import { CATEGORY_LABEL, THEME_TAGS } from "../store/catalog";
import type {
  CompanyRecord,
  ObservationRecord,
  SignalRecord,
  SourceRecord,
} from "../store/records";
import { notify } from "./journal";
import { activeGrid, rebuildSignal, saveRebuilt } from "./signals";
import { paidCall } from "./usage";

/** Nombre maximal d'essais par exécution (§6 : tentatives bornées). */
export const MAX_ATTEMPTS = 3;
/** Nombre maximal de publications retenues par source et par exécution. */
const MAX_ITEMS = 3;

/** État chargé une fois par lot de collecte. */
interface CollectState {
  companies: CompanyRecord[];
  observations: ObservationRecord[];
  knownUrls: Set<string>;
  signals: SignalRecord[];
}

async function loadState(ctx: Pick<Ctx, "repo">): Promise<CollectState> {
  const [companies, observations, signals] = await Promise.all([
    ctx.repo.companies.list(),
    ctx.repo.observations.list(),
    ctx.repo.signals.list(),
  ]);
  return {
    companies,
    observations,
    signals,
    knownUrls: new Set(observations.map((o) => canonicalUrl(o.url))),
  };
}

function knownEvents(state: CollectState, companyId: string | null) {
  if (!companyId) return [];
  return state.signals
    .filter((s) => s.companyId === companyId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 3)
    .map((s) => {
      const first = state.observations.find((o) => o.id === s.observationIds[0]);
      return { title: s.title, excerpt: first?.excerpt ?? s.summary };
    });
}

/** Classement d'une publication brute : nettoyage, dédoublonnage, rattachement, regroupement. */
async function ingest(
  ctx: Pick<Ctx, "repo" | "now">,
  state: CollectState,
  source: SourceRecord,
  item: RawItem,
): Promise<ObservationRecord | null> {
  const { repo, now } = ctx;
  const urlCheck = validateSourceUrl(item.url);
  if (!urlCheck.ok) return null;
  const key = canonicalUrl(urlCheck.url.toString());
  if (state.knownUrls.has(key)) return null;

  // Contenu externe : traité comme donnée, jamais comme instruction.
  const title = sanitizeText(item.title, 300);
  const excerpt = sanitizeText(item.html, 1200);
  if (!title || !excerpt) return null;

  const match = matchCompany(`${title} ${excerpt}`, item.url, state.companies, source.companyId);
  const companyId = match.confidence >= MATCH_THRESHOLD ? match.companyId : null;
  const company = companyId ? (state.companies.find((c) => c.id === companyId) ?? null) : null;
  const category = classifyCategory(`${title} ${excerpt}`);
  const obs: ObservationRecord = {
    id: repo.nextId("obs"),
    signalId: null,
    sourceId: source.id,
    companyId,
    outlet: item.outlet,
    url: urlCheck.url.toString(),
    title,
    excerpt,
    collectedAt: now.toISOString(),
    publishedAt: item.publishedAt,
    eventDate: item.eventDate,
    matchConfidence: match.confidence,
    isSyndicated: false,
  };
  state.knownUrls.add(key);

  const windowStart = now.getTime() - (CLUSTER_WINDOW_DAYS + 1) * DAY;
  const candidates = state.signals
    .filter((s) => companyId && s.companyId === companyId && Date.parse(s.createdAt) >= windowStart)
    .map((s) => ({
      signal: s,
      observations: state.observations.filter((o) => o.signalId === s.id),
    }));
  const decision = decideCluster(obs, category, candidates);
  const grid = await activeGrid(repo);

  if (decision.kind === "attach") {
    const target = state.signals.find((s) => s.id === decision.signalId)!;
    const members = [
      ...state.observations.filter((o) => o.signalId === target.id),
      { ...obs, signalId: target.id },
    ];
    await repo.observations.insert({ ...obs, signalId: target.id });
    const rebuilt = rebuildSignal({
      signal: { ...target, observationIds: members.map((o) => o.id) },
      observations: members,
      company,
      grid,
      others: state.signals,
      now,
    });
    // Un signal déjà décidé conserve le score et la grille de sa décision.
    if (isDecided(target.status)) {
      rebuilt.signal = {
        ...rebuilt.signal,
        score: target.score,
        whyInteresting: target.whyInteresting,
        suggestedAngle: target.suggestedAngle,
      };
    }
    await saveRebuilt(repo, rebuilt);
    replaceSignal(state, rebuilt.signal, rebuilt.observations);
    return rebuilt.observations.find((o) => o.id === obs.id) ?? obs;
  }

  const signalId = repo.nextId("sig");
  const themes = company ? [...company.themes] : [];
  const review: SignalRecord["review"] =
    decision.kind === "uncertain"
      ? {
          kind: "fusion_incertaine",
          note: `Proche du signal « ${state.signals.find((s) => s.id === decision.signalId)?.title ?? decision.signalId} » (similarité ${Math.round(decision.similarity * 100)} %) : fusion à confirmer`,
        }
      : companyId
        ? null
        : match.review;
  const draft: SignalRecord = {
    id: signalId,
    companyId,
    title,
    summary: await enhanceSummary({ title, text: excerpt }),
    category,
    themes,
    tags: [CATEGORY_LABEL[category], ...themes.map((t) => THEME_TAGS[t])].slice(0, 4),
    status: "nouveau",
    statusReason: null,
    observationIds: [obs.id],
    primaryOutlet: obs.outlet,
    primaryUrl: obs.url,
    collectedAt: obs.collectedAt,
    publishedAt: obs.publishedAt,
    eventDate: obs.eventDate,
    matchConfidence: match.confidence,
    score: {
      total: 0,
      gridVersion: grid.version,
      subScores: { importance: 0, nouveaute: 0, territoire: 0, lecteurs: 0, diffusion: 0 },
      reasons: { importance: "", nouveaute: "", territoire: "", lecteurs: "", diffusion: "" },
    },
    whyInteresting: [],
    suggestedAngle: { text: "", tags: [] },
    readingMinutes: 1,
    review,
    articleId: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const rebuilt = rebuildSignal({
    signal: draft,
    observations: [obs],
    company,
    grid,
    others: state.signals,
    now,
  });
  await repo.observations.insert(rebuilt.observations[0]!);
  await repo.signals.insert(rebuilt.signal);
  replaceSignal(state, rebuilt.signal, rebuilt.observations);
  if (rebuilt.signal.score.total >= 80) {
    await notify(repo, now, {
      kind: "signal",
      title: `Nouveau signal prioritaire${company ? ` : ${company.name}` : ""}`,
      body: `${rebuilt.signal.title} — score ${(rebuilt.signal.score.total / 10).toFixed(1)}/10`,
      link: `/signaux?id=${rebuilt.signal.id}`,
    });
  }
  return rebuilt.observations[0]!;
}

function replaceSignal(
  state: CollectState,
  signal: SignalRecord,
  observations: ObservationRecord[],
) {
  const i = state.signals.findIndex((s) => s.id === signal.id);
  if (i >= 0) state.signals[i] = signal;
  else state.signals.push(signal);
  const ids = new Set(observations.map((o) => o.id));
  state.observations = [...state.observations.filter((o) => !ids.has(o.id)), ...observations];
}

async function recordRun(ctx: Pick<Ctx, "repo">, run: CollectionRun): Promise<CollectionRun> {
  await ctx.repo.runs.insert(run);
  return run;
}

/**
 * Exécute la collecte d'une source (WF1). Le coût estimé est réservé avant l'appel :
 * si le budget est épuisé, l'exécution est consignée « bloque_quota » et l'erreur 402 propagée.
 */
async function runSource(
  ctx: Pick<Ctx, "repo" | "user" | "now">,
  state: CollectState,
  source: SourceRecord,
): Promise<CollectionRun> {
  const { repo, now } = ctx;
  const startedAt = now.toISOString();
  const base = {
    id: repo.nextId("run"),
    sourceId: source.id,
    companyId: source.companyId,
    startedAt,
  };
  const company = state.companies.find((c) => c.id === source.companyId) ?? null;

  let outcome: { result: CollectResult; attempts: number };
  try {
    outcome = await paidCall(
      ctx,
      {
        kind: "search_query",
        estimate: COSTS.search + MAX_ITEMS * COSTS.observation,
        units: 1,
        label: `Collecte ${source.label}`,
      },
      async () => {
        const collector = adapters().collector;
        let attempt = 1;
        let result = await collector.collect({
          source,
          company,
          attempt,
          now,
          knownEvents: knownEvents(state, source.companyId),
        });
        while (!result.ok && attempt < MAX_ATTEMPTS) {
          attempt += 1;
          result = await collector.collect({
            source,
            company,
            attempt,
            now,
            knownEvents: knownEvents(state, source.companyId),
          });
        }
        return { result, attempts: attempt };
      },
      ({ result }) => [
        {
          kind: "search_query",
          costEur: COSTS.search,
          units: 1,
          label: `Collecte ${source.label}`,
        },
        ...(result.ok && result.items.length
          ? [
              {
                kind: "observation" as const,
                costEur: Math.min(result.items.length, MAX_ITEMS) * COSTS.observation,
                units: Math.min(result.items.length, MAX_ITEMS),
                label: `Observations ${source.label}`,
              },
            ]
          : []),
      ],
    );
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 402) throw e;
    return recordRun(ctx, blockedRun(base, now));
  }

  const { result, attempts } = outcome;
  const current = (await repo.sources.get(source.id)) ?? source;
  if (!result.ok) {
    const wasFailing = current.access === "erreur";
    await repo.sources.update({
      ...current,
      access: "erreur",
      lastRunAt: now.toISOString(),
      failureCode: result.code,
      failureReason: result.reason,
      attempts: Math.min(MAX_ATTEMPTS, attempts),
      runCount: current.runCount + 1,
    });
    if (!wasFailing) {
      await notify(repo, now, {
        kind: "erreur_source",
        title: `Source en échec${company ? ` : ${company.name}` : ""}`,
        body: `${current.label} — ${result.code} (${result.reason}) après ${attempts} tentative(s).`,
        link: `/veille?source=${current.id}`,
      });
    }
    return recordRun(ctx, {
      ...base,
      finishedAt: now.toISOString(),
      status: "echec",
      newObservations: 0,
      errorCode: result.code,
      errorMessage: result.reason,
    });
  }

  let created = 0;
  for (const item of result.items.slice(0, MAX_ITEMS)) {
    if (await ingest(ctx, state, current, item)) created += 1;
  }
  await repo.sources.update({
    ...current,
    access: "ok",
    lastRunAt: now.toISOString(),
    lastSuccessAt: now.toISOString(),
    failureCode: null,
    failureReason: null,
    attempts: 0,
    runCount: current.runCount + 1,
  });
  return recordRun(ctx, {
    ...base,
    finishedAt: now.toISOString(),
    status: created > 0 ? "succes" : "succes_sans_actualite",
    newObservations: created,
    errorCode: null,
    errorMessage: null,
  });
}

function blockedRun(
  base: Pick<CollectionRun, "id" | "sourceId" | "companyId" | "startedAt">,
  now: Date,
): CollectionRun {
  return {
    ...base,
    finishedAt: now.toISOString(),
    status: "bloque_quota",
    newObservations: 0,
    errorCode: "budget_exhausted",
    errorMessage: "Budget API atteint : collecte suspendue",
  };
}

/** Collecte d'une source ; 402 `budget_exhausted` si le plafond est atteint (exécution consignée). */
export async function collectOne(
  ctx: Pick<Ctx, "repo" | "user" | "now">,
  source: SourceRecord,
): Promise<CollectionRun> {
  if (source.access === "desactivee") {
    throw conflict(
      "source_disabled",
      "Cette source est désactivée : réactivez-la avant de lancer une collecte.",
    );
  }
  const run = await runSource(ctx, await loadState(ctx), source);
  if (run.status === "bloque_quota") {
    throw budgetExhausted(
      "Budget API atteint : la collecte est suspendue jusqu'au mois prochain ou à une hausse du plafond.",
    );
  }
  return run;
}

/** Collecte de toutes les sources actives ; au plafond budgétaire, les suivantes sont « bloque_quota ». */
export async function collectAll(
  ctx: Pick<Ctx, "repo" | "user" | "now">,
): Promise<CollectionRun[]> {
  const state = await loadState(ctx);
  const sources = (await ctx.repo.sources.list()).filter((s) => s.access !== "desactivee");
  const runs: CollectionRun[] = [];
  let blocked = false;
  for (const source of sources) {
    const run = blocked
      ? await recordRun(
          ctx,
          blockedRun(
            {
              id: ctx.repo.nextId("run"),
              sourceId: source.id,
              companyId: source.companyId,
              startedAt: ctx.now.toISOString(),
            },
            ctx.now,
          ),
        )
      : await runSource(ctx, state, source);
    if (run.status === "bloque_quota") blocked = true;
    runs.push(run);
  }
  return runs;
}
