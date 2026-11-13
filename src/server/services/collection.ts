import type { CollectionBatch, CollectionRun } from "@/lib/api/types";
import { adapters } from "../adapters";
import {
  FRESHNESS_DAYS,
  type CollectResult,
  type CollectWarning,
  type RawItem,
} from "../adapters/collector";
import { googleNewsArticleId, type LinkResolver } from "../adapters/google-news";
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
import { checkPublishedAt } from "./publisher-page";
import { activeGrid, rebuildSignal, saveRebuilt } from "./signals";
import { paidCall, type UsageLine } from "./usage";

/** Nombre maximal d'essais par exécution (§6 : tentatives bornées), sur erreur transitoire seulement. */
export const MAX_ATTEMPTS = 3;
/** Nombre maximal de nouvelles publications retenues par source et par exécution. */
export const MAX_ITEMS = 5;
/**
 * Articles Google News dont on vérifie la date originale, par source.
 * Distinct de `MAX_ITEMS` : plusieurs archives peuvent être écartées avant
 * qu'un article récent trouve une place. Au-delà, le reste du flux n'est pas
 * ingéré — la date Google News ne sert pas de date de publication.
 */
export const MAX_GOOGLE_NEWS_CHECKS = 15;
/**
 * Temps mur maximal, par source, pour la résolution des redirections et la
 * lecture des pages. Dépassé, on n'entame plus de candidat. Le délai d'une
 * invocation Cloudflare peut être plus court que cette minute : ce budget
 * est celui de l'application, pas une promesse de l'hébergeur.
 */
export const GOOGLE_NEWS_DATE_BUDGET_MS = 60_000;
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
  repo: Pick<Ctx, "repo">["repo"],
  pending: CollectState["pendingSummaries"],
): Promise<void> {
  const ai = adapters().ai;
  if (!ai || pending.length === 0) return;
  await parallel(pending, CONCURRENCY, async (p) => {
    const summary = await ai.enhanceSummary({ title: p.title, text: p.text }, p.base);
    if (summary === p.base) return;
    const current = await repo.signals.get(p.signalId);
    if (current) await repo.signals.update({ ...current, summary });
  });
}

async function recordRun(ctx: Pick<Ctx, "repo">, run: CollectionRun): Promise<CollectionRun> {
  await ctx.repo.runs.insert(run);
  return run;
}

const DATE_BUDGET_EXPIRED = Symbol("date-budget-expired");

/** Avertissement : des articles Google News ont été écartés faute de date confirmée. */
export const DATE_REJECTED = "DATE_REJECTED";
/** Avertissement : aucun article écarté, mais la vérification s'est arrêtée avant d'en avoir assez. */
export const DATE_UNCHECKED = "DATE_UNCHECKED";

/** Bilan de la vérification de la date des articles Google News d'une source. */
interface DateChecks {
  /** Date originale confirmée, dans la fenêtre de fraîcheur : article gardé. */
  confirmed: number;
  /** Page d'éditeur refusée, injoignable, en erreur, redirigée, non HTML ou trop lourde. */
  inaccessible: number;
  /** Page lue, mais date de publication absente, illisible ou contradictoire. */
  sansDate: number;
  /** Date lue, mais hors de la fenêtre de fraîcheur. */
  horsFenetre: number;
  /** Redirection Google News qui ne mène à aucune adresse d'éditeur acceptable. */
  lienNonResolu: number;
  /** Non examiné : au-delà de `MAX_GOOGLE_NEWS_CHECKS` ou de `GOOGLE_NEWS_DATE_BUDGET_MS`. */
  nonExamine: number;
}

/**
 * Vérifie la date originale de chaque article Google News encore inconnu, qu'il
 * arrive par une redirection ou déjà par l'URL de l'éditeur. Une URL d'éditeur
 * n'est pas soumise au décodeur de redirection.
 *
 * `MAX_ITEMS` borne l'ingestion. `MAX_GOOGLE_NEWS_CHECKS` et
 * `GOOGLE_NEWS_DATE_BUDGET_MS` bornent ces lectures. Les candidats non examinés
 * sont exclus : la date du flux n'est pas retenue. Les flux officiels et
 * Perplexity (`via` autre que `google_news`) ne passent pas ici. Une adresse
 * déjà connue, ou refusée, n'est pas lue.
 *
 * Chaque article écarté ou non examiné est compté : la collecte le rapporte dans
 * son avertissement, pour qu'une source ne se vide pas sans explication.
 */
async function resolveGoogleNewsItems(
  state: CollectState,
  items: RawItem[],
  now: Date,
): Promise<{ items: RawItem[]; checks: DateChecks }> {
  const { links } = adapters();
  const started = Date.now();
  let examined = 0;
  let stop = false;
  const out: RawItem[] = [];
  const checks: DateChecks = {
    confirmed: 0,
    inaccessible: 0,
    sansDate: 0,
    horsFenetre: 0,
    lienNonResolu: 0,
    nonExamine: 0,
  };
  const expired = () => Date.now() - started >= GOOGLE_NEWS_DATE_BUDGET_MS;
  for (const item of items) {
    if (item.via !== "google_news") {
      out.push(item);
      continue;
    }
    if (isKnown(state, item)) {
      out.push(item);
      continue;
    }
    if (stop || examined >= MAX_GOOGLE_NEWS_CHECKS || expired()) {
      checks.nonExamine += 1;
      continue;
    }
    examined += 1;
    const url = await publisherUrl(
      item.url,
      links,
      GOOGLE_NEWS_DATE_BUDGET_MS - (Date.now() - started),
    );
    if (url === DATE_BUDGET_EXPIRED) {
      stop = true;
      checks.nonExamine += 1;
      continue;
    }
    if (!url) {
      checks.lienNonResolu += 1;
      continue;
    }
    const next: RawItem = { ...item, url };
    if (isKnown(state, next)) {
      out.push(next);
      continue;
    }
    if (expired()) {
      stop = true;
      checks.nonExamine += 1;
      continue;
    }
    const check = await checkPublishedAt(
      next.url,
      now,
      GOOGLE_NEWS_DATE_BUDGET_MS - (Date.now() - started),
    );
    if (check.ok) {
      checks.confirmed += 1;
      out.push({ ...next, publishedAt: check.publishedAt });
    } else if (check.reason === "inaccessible") checks.inaccessible += 1;
    else if (check.reason === "sans_date") checks.sansDate += 1;
    else checks.horsFenetre += 1;
  }
  return { items: out, checks };
}

/**
 * Avertissement lisible dans l'historique : combien d'articles écartés, et pourquoi.
 *
 * Les articles non examinés ne sont pas des refus : ils sont cités à côté des refus, ou
 * seuls (`DATE_UNCHECKED`) quand la vérification s'est arrêtée sans avoir confirmé de quoi
 * remplir la collecte. Une source dont `MAX_ITEMS` articles sont confirmés et aucun écarté
 * ne porte pas d'avertissement : le surplus attend la collecte suivante, comme pour un flux.
 */
function dateWarning(checks: DateChecks): CollectWarning | undefined {
  const reasons: string[] = [];
  const add = (count: number, one: string, many: string) => {
    if (count > 0) reasons.push(count === 1 ? `1 ${one}` : `${count} ${many}`);
  };
  add(checks.inaccessible, "page d'éditeur inaccessible", "pages d'éditeur inaccessibles");
  add(checks.sansDate, "sans date de publication lisible", "sans date de publication lisible");
  const window = `hors de la fenêtre de ${FRESHNESS_DAYS} jours`;
  add(checks.horsFenetre, window, window);
  add(checks.lienNonResolu, "lien non résolu", "liens non résolus");
  const rejected =
    checks.inaccessible + checks.sansDate + checks.horsFenetre + checks.lienNonResolu;
  const starved = checks.nonExamine > 0 && checks.confirmed < MAX_ITEMS;
  if (rejected === 0 && !starved) return undefined;

  const sentences: string[] = [];
  if (rejected > 0) {
    const subject = rejected === 1 ? "1 publication écartée" : `${rejected} publications écartées`;
    sentences.push(`${subject} par la vérification de la date (${reasons.join(", ")})`);
  }
  if (checks.nonExamine > 0) {
    const limit = `limite de ${MAX_GOOGLE_NEWS_CHECKS} vérifications ou de ${GOOGLE_NEWS_DATE_BUDGET_MS / 1000} s par source`;
    const noun = rejected > 0 ? "" : checks.nonExamine === 1 ? " publication" : " publications";
    const unchecked = checks.nonExamine === 1 ? "non examinée" : "non examinées";
    sentences.push(`${checks.nonExamine}${noun} ${unchecked} (${limit})`);
  }
  return {
    code: rejected > 0 ? DATE_REJECTED : DATE_UNCHECKED,
    reason: `Google News : ${sentences.join(" ; ")}.`,
  };
}

async function publisherUrl(
  url: string,
  links: LinkResolver,
  remainingMs: number,
): Promise<string | null | typeof DATE_BUDGET_EXPIRED> {
  if (googleNewsArticleId(url) === null) {
    const check = validateSourceUrl(url);
    if (!check.ok || check.url.hostname === "news.google.com") return null;
    return check.url.toString();
  }
  if (remainingMs <= 0) return DATE_BUDGET_EXPIRED;
  const resolved = await withinBudget((signal) => links.resolve(url, signal), remainingMs);
  if (resolved === DATE_BUDGET_EXPIRED) return DATE_BUDGET_EXPIRED;
  if (!resolved || googleNewsArticleId(resolved) !== null) return null;
  const check = validateSourceUrl(resolved);
  if (!check.ok || check.url.hostname === "news.google.com") return null;
  return check.url.toString();
}

/**
 * Attend `start` au plus `remainingMs`. À l'échéance, `abort()` est appelé sur le
 * signal passé à `start` : une course seule laisserait la requête vivre. La
 * connexion n'est fermée que si `fetch` honore ce signal. Un résultat qui arrive
 * après l'annulation n'est pas utilisé.
 */
async function withinBudget<T>(
  start: (signal: AbortSignal) => Promise<T>,
  remainingMs: number,
): Promise<T | typeof DATE_BUDGET_EXPIRED> {
  if (remainingMs <= 0) return DATE_BUDGET_EXPIRED;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof DATE_BUDGET_EXPIRED>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(DATE_BUDGET_EXPIRED);
    }, remainingMs);
  });
  const work = start(controller.signal);
  void work.catch(() => undefined);
  try {
    const winner = await Promise.race([
      work.then((value) => ({ expired: false as const, value })),
      timeout.then(() => ({ expired: true as const })),
    ]);
    if (winner.expired || controller.signal.aborted) return DATE_BUDGET_EXPIRED;
    return winner.value;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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
    const assessment = await ai.classify({ title, text, companyName: company?.name ?? null });
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
    const checked = await resolveGoogleNewsItems(state, result.items, ctx.now);
    const items = await assessItems(state, checked.items, company);
    // L'avertissement du collecteur (Google News relayé par Perplexity) garde la priorité :
    // dans ce cas aucun article Google News n'a été lu, donc aucun n'a été écarté.
    const warning = result.warning ?? dateWarning(checked.checks);
    result = { ...result, items, ...(warning ? { warning } : {}) };
  }
  return { result, attempts: attempt };
}

/** Coût réel d'une source : une requête, les nouvelles publications retenues, les lectures par le modèle. */
function usageLines(state: CollectState, source: SourceRecord, outcome: Outcome): UsageLine[] {
  const items = outcome.result.ok ? outcome.result.items : [];
  const units = Math.min(items.filter((i) => !isKnown(state, i)).length, MAX_ITEMS);
  const assessed = items.filter((i) => i.assessment).length;
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
    ...(assessed
      ? [
          {
            kind: "classification" as const,
            costEur: assessed * COSTS.classification,
            units: assessed,
            label: `Lecture par le modèle ${source.label}`,
          },
        ]
      : []),
  ];
}

/** Coût estimé d'une source, réservé avant l'appel : requête, publications, lectures par le modèle. */
function estimatePerSource(): number {
  const perItem = COSTS.observation + (adapters().ai ? COSTS.classification : 0);
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
  await enhanceSummaries(repo, state.pendingSummaries.splice(0));
  return runs;
}

const COLLECT_LOCK = "collecte";
/**
 * Couvre un lot. Les lectures de dates sont bornées par `GOOGLE_NEWS_DATE_BUDGET_MS`
 * par source ; le verrou reste de 5 minutes. Le délai d'invocation Cloudflare peut
 * couper plus tôt : l'application n'allonge pas l'attente au-delà de son budget.
 */
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
