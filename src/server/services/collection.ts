import type { CollectionBatch, CollectionRun } from "@/lib/api/types";
import { adapters } from "../adapters";
import type { CollectResult, RawItem } from "../adapters/collector";
import { now as clock } from "../clock";
import type { Ctx } from "../context";
import { budgetExhausted, COSTS } from "../domain/budget";
import {
  CLUSTER_WINDOW_DAYS,
  canonicalUrl,
  classifyCategory,
  clusterReference,
  decideCluster,
  MATCH_THRESHOLD,
  matchCompany,
} from "../domain/clustering";
import { PRIORITY_SCORE } from "../domain/dashboard";
import { DAY } from "../domain/dates";
import { isDecided } from "../domain/scoring";
import { sanitizeText, validateSourceUrl } from "../domain/security";
import { HttpError, conflict } from "../http";
import { CATEGORY_LABEL, THEME_TAGS } from "../store/catalog";
import type {
  CompanyRecord,
  GridRecord,
  ObservationRecord,
  SignalRecord,
  SourceRecord,
} from "../store/records";
import { notify } from "./journal";
import { withLock } from "./locks";
import { activeGrid, rebuildSignal, saveRebuilt } from "./signals";
import { improveSummary } from "./summary-ai";
import { paidCall, type UsageLine } from "./usage";

/** Nombre maximal d'essais par exécution (§6 : tentatives bornées), sur erreur transitoire seulement. */
export const MAX_ATTEMPTS = 3;
/** Nombre maximal de nouvelles publications retenues par source et par exécution. */
export const MAX_ITEMS = 5;
/** Sources traitées par appel de collecte globale (`POST /collect`), à défaut de `limit`. */
export const BATCH_SIZE = 8;
/** Borne haute de `limit` : un lot reste court pour tenir dans une requête de l'hébergeur. */
export const MAX_BATCH_SIZE = 25;
/**
 * Lectures réseau simultanées dans un lot. Cloudflare Workers n'ouvre que 6 connexions
 * sortantes à la fois par invocation ; chaque source peut en tenir deux (flux et Perplexity).
 */
const CONCURRENCY = 3;

/** État chargé une fois par lot de collecte. */
interface CollectState {
  companies: CompanyRecord[];
  observations: ObservationRecord[];
  knownUrls: Set<string>;
  signals: SignalRecord[];
  grid: GridRecord;
  /** Nouveaux signaux dont le résumé reste à améliorer par l'IA, après l'ingestion. */
  pendingSummaries: { signalId: string; title: string; text: string; base: string }[];
}

interface Outcome {
  result: CollectResult;
  attempts: number;
}

type RunBase = Pick<CollectionRun, "id" | "sourceId" | "companyId" | "startedAt">;

async function loadState(ctx: Pick<Ctx, "repo">): Promise<CollectState> {
  const [companies, observations, signals, grid] = await Promise.all([
    ctx.repo.companies.list(),
    ctx.repo.observations.list(),
    ctx.repo.signals.list(),
    activeGrid(ctx.repo),
  ]);
  return {
    companies,
    observations,
    signals,
    grid,
    knownUrls: new Set(observations.map((o) => canonicalUrl(o.url))),
    pendingSummaries: [],
  };
}

/** Exécute `fn` sur chaque élément, `limit` à la fois au plus, en conservant l'ordre des résultats. */
export async function parallel<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Publication déjà connue (ou URL refusée) : elle n'occupe pas de place dans la limite par exécution. */
function isKnown(state: CollectState, item: RawItem): boolean {
  const check = validateSourceUrl(item.url);
  return !check.ok || state.knownUrls.has(canonicalUrl(check.url.toString()));
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
  const category = item.assessment?.category ?? classifyCategory(`${title} ${excerpt}`);
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
    ...(item.via ? { via: item.via } : {}),
  };
  state.knownUrls.add(key);

  // Candidats : signaux de l'entreprise dont l'événement (sinon la publication la plus ancienne)
  // est à moins de 7 jours de la publication, qu'ils aient été créés hier ou il y a trois semaines.
  const obsTime = Date.parse(obs.publishedAt ?? obs.collectedAt);
  const candidates = state.signals
    .filter(
      (s) =>
        companyId &&
        s.companyId === companyId &&
        Math.abs(obsTime - clusterReference(s)) <= (CLUSTER_WINDOW_DAYS + 1) * DAY,
    )
    .map((s) => ({
      signal: s,
      observations: state.observations.filter((o) => o.signalId === s.id),
    }));
  const decision = decideCluster(
    obs,
    category,
    candidates,
    company ? [company.name, ...company.aliases] : [],
  );
  const { grid } = state;

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
  // Résumé par gabarit à la création ; l'amélioration par l'IA est faite après le lot, en parallèle.
  const summary = adapters().textModel.summarize({ title, text: excerpt });
  const draft: SignalRecord = {
    id: signalId,
    companyId,
    title,
    summary,
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
    assessment: item.assessment ?? null,
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
  state.pendingSummaries.push({ signalId, title, text: excerpt, base: summary });
  if (rebuilt.signal.score.total >= PRIORITY_SCORE) {
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

/**
 * Résumés améliorés par l'IA pour les signaux créés dans le lot, en parallèle et hors du chemin
 * critique de l'ingestion. Sans clé IA, rien n'est appelé ni réécrit.
 */
async function enhanceSummaries(
  ctx: Pick<Ctx, "repo" | "user" | "now">,
  pending: CollectState["pendingSummaries"],
): Promise<void> {
  if (!adapters().ai || pending.length === 0) return;
  await parallel(pending, CONCURRENCY, async (p) => {
    const summary = await improveSummary(ctx, { title: p.title, text: p.text }, p.base);
    if (summary === p.base) return;
    // Failure to persist an optional improvement must not invalidate ingested signals.
    try {
      const current = await ctx.repo.signals.get(p.signalId);
      if (current) await ctx.repo.signals.update({ ...current, summary });
    } catch {
      console.warn(JSON.stringify({ event: "kora.summary.persist_failed" }));
    }
  });
}

async function recordRun(ctx: Pick<Ctx, "repo">, run: CollectionRun): Promise<CollectionRun> {
  await ctx.repo.runs.insert(run);
  return run;
}

/**
 * Remplace les redirections Google News par l'adresse de l'article, pour les publications encore
 * inconnues qui seront ingérées (au plus `MAX_ITEMS` résolutions par source). Une résolution qui
 * échoue laisse la redirection ; une adresse résolue déjà connue sera écartée à l'ingestion.
 */
async function resolveLinks(state: CollectState, items: RawItem[]): Promise<RawItem[]> {
  const { links } = adapters();
  let budget = MAX_ITEMS;
  const out: RawItem[] = [];
  for (const item of items) {
    if (budget > 0 && item.via === "google_news" && !isKnown(state, item)) {
      budget -= 1;
      const resolved = await links.resolve(item.url);
      out.push(resolved ? { ...item, url: resolved } : item);
    } else {
      out.push(item);
    }
  }
  return out;
}

/**
 * Lecture des publications par le modèle (catégorie, importance), pour les publications encore
 * inconnues qui seront ingérées, au plus `MAX_ITEMS` par source. Sans clé IA, ou si le modèle ne
 * répond pas, la publication est ingérée sans évaluation (indices lexicaux, importance par
 * catégorie). Le texte est nettoyé avant d'être soumis : donnée, jamais instruction.
 */
async function assessItems(
  state: CollectState,
  items: RawItem[],
  company: CompanyRecord | null,
): Promise<RawItem[]> {
  const { ai } = adapters();
  if (!ai) return items;
  const picked = new Set<RawItem>();
  for (const item of items) {
    if (picked.size >= MAX_ITEMS) break;
    if (!isKnown(state, item)) picked.add(item);
  }
  const assessed = await parallel([...picked], CONCURRENCY, async (item) => {
    const title = sanitizeText(item.title, 300);
    const text = sanitizeText(item.html, 1200);
    if (!title || !text) return item;
    const input = { title, text, companyName: company?.name ?? null };
    if (ai.classifyWithUsage) {
      const measured = await ai.classifyWithUsage(input);
      return {
        ...item,
        ...(measured.assessment ? { assessment: measured.assessment } : {}),
        classificationUsage: {
          primaryCalls: measured.primaryCalls,
          fallbackCalls: measured.fallbackCalls,
        },
      };
    }
    // Compatibilité avec les adaptateurs simulés ne disposant pas de compteur.
    const assessment = await ai.classify(input);
    return assessment ? { ...item, assessment } : item;
  });
  const byOriginal = new Map([...picked].map((item, i) => [item, assessed[i]!]));
  return items.map((item) => byOriginal.get(item) ?? item);
}

/** Appel du collecteur, réessayé sur erreur transitoire seulement (§6 : tentatives bornées). */
async function fetchOutcome(
  ctx: Pick<Ctx, "now">,
  state: CollectState,
  source: SourceRecord,
  company: CompanyRecord | null,
): Promise<Outcome> {
  const collector = adapters().collector;
  let attempt = 1;
  const input = () => ({
    source,
    company,
    attempt,
    now: ctx.now,
    knownEvents: knownEvents(state, source.companyId),
  });
  let result = await collector.collect(input());
  while (!result.ok && result.transient && attempt < MAX_ATTEMPTS) {
    attempt += 1;
    result = await collector.collect(input());
  }
  if (result.ok) {
    const items = await assessItems(state, await resolveLinks(state, result.items), company);
    result = { ...result, items };
  }
  return { result, attempts: attempt };
}

/** Estimation forfaitaire retenue dans le budget global pour un appel de secours. */
function fallbackCostEstimate(): number {
  const raw = process.env["KORA_AI_FALLBACK_RESERVE_EUR_PER_CALL"];
  const value = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value) || value <= 0) {
    throw budgetExhausted("Réserve de repli IA absente ou invalide.");
  }
  return value;
}

/**
 * Consommation estimée du budget API KORA, distincte de toute facturation client.
 * Un appel peut être compté même si la classification n'a pas abouti.
 */
function usageLines(state: CollectState, source: SourceRecord, outcome: Outcome): UsageLine[] {
  const items = outcome.result.ok ? outcome.result.items : [];
  const candidates = items.filter((item) => !isKnown(state, item)).slice(0, MAX_ITEMS);
  const units = candidates.length;
  const primaryCalls = candidates.reduce(
    (sum, item) => sum + (item.classificationUsage?.primaryCalls ?? (item.assessment ? 1 : 0)),
    0,
  );
  const fallbackCalls = candidates.reduce(
    (sum, item) => sum + (item.classificationUsage?.fallbackCalls ?? 0),
    0,
  );

  return [
    { kind: "search_query", costEur: COSTS.search, units: 1, label: `Collecte ${source.label}` },
    ...(units
      ? [
          {
            kind: "observation" as const,
            costEur: units * COSTS.observation,
            units,
            label: `Observations ${source.label}`,
          },
        ]
      : []),
    ...(primaryCalls
      ? [
          {
            kind: "classification" as const,
            costEur: primaryCalls * COSTS.classification,
            units: primaryCalls,
            label: `Classification IA principale ${source.label}`,
          },
        ]
      : []),
    ...(fallbackCalls
      ? [
          {
            kind: "classification" as const,
            costEur: fallbackCalls * fallbackCostEstimate(),
            units: fallbackCalls,
            label: `Classification IA de secours ${source.label}`,
          },
        ]
      : []),
  ];
}

/** Coût estimé d'une source, réservé avant l'appel : requête, publications, lectures par le modèle. */
function estimatePerSource(): number {
  const aiEnabled = Boolean(adapters().ai);
  let fallbackReserve = 0;

  const fallbackConfigured =
    aiEnabled &&
    process.env["KORA_AI_FALLBACK_ENABLED"] === "true" &&
    Boolean(process.env["ANTHROPIC_API_KEY"]?.trim()) &&
    Boolean(process.env["AI_API_KEY"]?.trim());

  if (fallbackConfigured) {
    const raw = process.env["KORA_AI_FALLBACK_RESERVE_EUR_PER_CALL"];
    const reserve = Number(raw);

    if (!raw || !Number.isFinite(reserve) || reserve <= 0) {
      throw budgetExhausted("Repli IA bloqué : réserve budgétaire OpenAI absente ou invalide.");
    }

    fallbackReserve = reserve;
  }

  const perItem = COSTS.observation + (aiEnabled ? COSTS.classification : 0) + fallbackReserve;

  return COSTS.search + MAX_ITEMS * perItem;
}

/** Suite d'une exécution après l'appel réseau : état de la source, ingestion, exécution consignée. */
async function settle(
  ctx: Pick<Ctx, "repo" | "now">,
  state: CollectState,
  source: SourceRecord,
  outcome: Outcome,
  base: RunBase,
): Promise<CollectionRun> {
  const { repo, now } = ctx;
  const { result, attempts } = outcome;
  const company = state.companies.find((c) => c.id === source.companyId) ?? null;
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
      finishedAt: clock().toISOString(),
      status: "echec",
      newObservations: 0,
      errorCode: result.code,
      errorMessage: result.reason,
    });
  }

  let created = 0;
  let fromEnrichment = 0;
  for (const item of result.items) {
    if (created >= MAX_ITEMS) break;
    if (await ingest(ctx, state, current, item)) {
      created += 1;
      if (item.via === "perplexity") fromEnrichment += 1;
    }
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
    finishedAt: clock().toISOString(),
    status: created > 0 ? "succes" : "succes_sans_actualite",
    newObservations: created,
    errorCode: result.warning?.code ?? null,
    errorMessage: result.warning?.reason ?? null,
    ...(result.enrichment ? { enrichment: { ...result.enrichment, added: fromEnrichment } } : {}),
  });
}

function blockedRun(base: RunBase, now: Date): CollectionRun {
  return {
    ...base,
    finishedAt: now.toISOString(),
    status: "bloque_quota",
    newObservations: 0,
    errorCode: "budget_exhausted",
    errorMessage: "Budget API atteint : collecte suspendue",
  };
}

/**
 * Collecte d'un lot de sources (WF1). Le coût estimé du lot est réservé en une fois avant les
 * appels : budget épuisé, toutes les exécutions du lot sont consignées `bloque_quota` ; verrou
 * `budget` occupé, elles sont consignées `echec` (`budget_busy`) et les sources restent dans leur
 * état. Les lectures réseau se font en parallèle (`CONCURRENCY`), l'ingestion en série pour que
 * le dédoublonnage reste sûr.
 */
async function runBatch(
  ctx: Pick<Ctx, "repo" | "user" | "now">,
  state: CollectState,
  sources: SourceRecord[],
): Promise<CollectionRun[]> {
  if (sources.length === 0) return [];
  const { repo, now } = ctx;
  const bases = new Map<string, RunBase>(
    sources.map((s) => [
      s.id,
      {
        id: repo.nextId("run"),
        sourceId: s.id,
        companyId: s.companyId,
        startedAt: now.toISOString(),
      },
    ]),
  );
  const companyOf = (s: SourceRecord) => state.companies.find((c) => c.id === s.companyId) ?? null;

  let outcomes: Outcome[];
  try {
    outcomes = await paidCall(
      ctx,
      {
        kind: "search_query",
        estimate: sources.length * estimatePerSource(),
        units: sources.length,
        label:
          sources.length === 1
            ? `Collecte ${sources[0]!.label}`
            : `Collecte de ${sources.length} sources`,
      },
      () => parallel(sources, CONCURRENCY, (s) => fetchOutcome(ctx, state, s, companyOf(s))),
      (outs) => outs.flatMap((o, i) => usageLines(state, sources[i]!, o)),
    );
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    const runs: CollectionRun[] = [];
    if (e.status === 402) {
      for (const s of sources) runs.push(await recordRun(ctx, blockedRun(bases.get(s.id)!, now)));
      return runs;
    }
    if (e.code !== "budget_busy") throw e;
    for (const s of sources) {
      // Datée comme tentée : la collecte globale ne la représente pas dans ce passage.
      const current = (await repo.sources.get(s.id)) ?? s;
      await repo.sources.update({ ...current, lastRunAt: now.toISOString() });
      runs.push(
        await recordRun(ctx, {
          ...bases.get(s.id)!,
          finishedAt: clock().toISOString(),
          status: "echec",
          newObservations: 0,
          errorCode: e.code,
          errorMessage: e.message,
        }),
      );
    }
    return runs;
  }

  const runs: CollectionRun[] = [];
  for (const [i, source] of sources.entries()) {
    runs.push(await settle(ctx, state, source, outcomes[i]!, bases.get(source.id)!));
  }
  await enhanceSummaries(ctx, state.pendingSummaries.splice(0));
  return runs;
}

const COLLECT_LOCK = "collecte";
/** Couvre un lot (`MAX_BATCH_SIZE` sources, chacune bornée à ~35 s par essai, par vagues de `CONCURRENCY`). */
const COLLECT_LOCK_TTL_MS = 5 * 60_000;

/**
 * Une seule collecte à la fois : deux collectes simultanées (deux onglets, deux personnes)
 * partiraient du même état et enregistreraient deux fois les mêmes publications.
 */
function exclusive<T>(ctx: Pick<Ctx, "repo">, fn: () => Promise<T>): Promise<T> {
  return withLock(
    ctx.repo,
    COLLECT_LOCK,
    {
      ttlMs: COLLECT_LOCK_TTL_MS,
      busy: () =>
        conflict(
          "collection_in_progress",
          "Une collecte est déjà en cours : réessayez dans quelques minutes.",
        ),
    },
    fn,
  );
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
  const [run] = await exclusive(ctx, async () => runBatch(ctx, await loadState(ctx), [source]));
  if (run!.status === "bloque_quota") {
    throw budgetExhausted(
      "Budget API atteint : la collecte est suspendue jusqu'au mois prochain ou à une hausse du plafond.",
    );
  }
  return run!;
}

export interface CollectAllOptions {
  /** Début de la collecte globale (renvoyé par le premier lot) ; absent : nouvelle collecte. */
  since?: string | undefined;
  /** Sources traitées dans ce lot (`BATCH_SIZE` par défaut, `MAX_BATCH_SIZE` au plus). */
  limit?: number | undefined;
}

/** Sources jamais collectées d'abord, puis de la plus ancienne collecte à la plus récente. */
function oldestFirst(a: SourceRecord, b: SourceRecord): number {
  if (a.lastRunAt === b.lastRunAt) return a.id.localeCompare(b.id);
  if (!a.lastRunAt) return -1;
  if (!b.lastRunAt) return 1;
  return a.lastRunAt.localeCompare(b.lastRunAt);
}

/**
 * Collecte globale par lots : chaque appel traite les sources actives non encore collectées
 * depuis `since` (date du premier appel), `limit` au plus, et renvoie le nombre de sources
 * restantes. Le client enchaîne les appels jusqu'à `remaining: 0`. Au plafond budgétaire, les
 * sources restantes sont consignées `bloque_quota` et la collecte s'arrête.
 */
export async function collectAll(
  ctx: Pick<Ctx, "repo" | "user" | "now">,
  opts: CollectAllOptions = {},
): Promise<CollectionBatch> {
  return exclusive(ctx, async () => {
    const since = opts.since ?? ctx.now.toISOString();
    const limit = Math.max(1, Math.min(opts.limit ?? BATCH_SIZE, MAX_BATCH_SIZE));
    const active = (await ctx.repo.sources.list()).filter((s) => s.access !== "desactivee");
    const pending = active.filter((s) => !s.lastRunAt || s.lastRunAt < since).sort(oldestFirst);
    const batch = pending.slice(0, limit);
    const runs = await runBatch(ctx, await loadState(ctx), batch);
    let rest = pending.slice(batch.length);
    if (runs.some((r) => r.status === "bloque_quota")) {
      for (const source of rest) {
        runs.push(
          await recordRun(
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
          ),
        );
      }
      rest = [];
    }
    return { since, total: active.length, runs, remaining: rest.length };
  });
}
