import type {
  Article,
  ArticleDetail,
  Company,
  EditorialRule,
  HumanImport,
  LinkedInPost,
  NewsletterEdition,
  PublicationAttempt,
  RuleProposal,
  Signal,
  SignalDetail,
  Source,
} from "@/lib/api/types";
import { computeEvidence } from "../domain/evidence";
import type {
  ArticleRecord,
  CompanyRecord,
  ImportRecord,
  LinkedInPostRecord,
  NewsletterRecord,
  ObservationRecord,
  RuleProposalRecord,
  RuleRecord,
  SignalRecord,
  SourceRecord,
} from "../store/records";
import type { Repository } from "../store/repository";

/* ------------------------------------------------------------------ */
/* Newsletter courante                                                 */
/* ------------------------------------------------------------------ */

/** Édition « prochaine » : la plus récente non exportée (composition ou approuvée). */
export async function currentEdition(repo: Repository): Promise<NewsletterRecord | undefined> {
  const list = await repo.newsletters.list();
  return list
    .filter((n) => n.status !== "exportee")
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}

/* ------------------------------------------------------------------ */
/* Signaux                                                             */
/* ------------------------------------------------------------------ */

export interface SignalView {
  companies: Map<string, CompanyRecord>;
  obsBySignal: Map<string, ObservationRecord[]>;
  newsletterSignals: Set<string>;
  now: Date;
}

export async function loadSignalView(repo: Repository, now: Date): Promise<SignalView> {
  const [companies, observations, edition] = await Promise.all([
    repo.companies.list(),
    repo.observations.list(),
    currentEdition(repo),
  ]);
  const obsBySignal = new Map<string, ObservationRecord[]>();
  for (const o of observations) {
    if (!o.signalId) continue;
    const list = obsBySignal.get(o.signalId) ?? [];
    list.push(o);
    obsBySignal.set(o.signalId, list);
  }
  return {
    companies: new Map(companies.map((c) => [c.id, c])),
    obsBySignal,
    newsletterSignals: new Set(
      (edition?.items ?? []).map((i) => i.signalId).filter((id): id is string => !!id),
    ),
    now,
  };
}

export function signalObservations(rec: SignalRecord, view: SignalView): ObservationRecord[] {
  const list = view.obsBySignal.get(rec.id) ?? [];
  const order = new Map(rec.observationIds.map((id, i) => [id, i]));
  return [...list].sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
}

export function toSignal(rec: SignalRecord, view: SignalView): Signal {
  const company = rec.companyId ? (view.companies.get(rec.companyId) ?? null) : null;
  const observations = signalObservations(rec, view);
  return {
    ...rec,
    observationIds: observations.map((o) => o.id),
    evidence: computeEvidence(observations, company, view.now),
    inNewsletter: view.newsletterSignals.has(rec.id),
  };
}

/* ------------------------------------------------------------------ */
/* Registre                                                            */
/* ------------------------------------------------------------------ */

export function toSource(rec: SourceRecord): Source {
  const { createdAt: _c, runCount: _r, simulation: _s, ...dto } = rec;
  return dto;
}

export interface CompanyCounters {
  sources: Map<string, number>;
  failing: Map<string, number>;
  signals: Map<string, number>;
}

export async function loadCompanyCounters(repo: Repository): Promise<CompanyCounters> {
  const [sources, signals] = await Promise.all([repo.sources.list(), repo.signals.list()]);
  const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const counters: CompanyCounters = { sources: new Map(), failing: new Map(), signals: new Map() };
  for (const s of sources) {
    inc(counters.sources, s.companyId);
    if (s.access === "erreur") inc(counters.failing, s.companyId);
  }
  for (const s of signals) if (s.companyId) inc(counters.signals, s.companyId);
  return counters;
}

export function toCompany(rec: CompanyRecord, counters: CompanyCounters): Company {
  const { fictional: _f, ...dto } = rec;
  return {
    ...dto,
    sourceCount: counters.sources.get(rec.id) ?? 0,
    failingSourceCount: counters.failing.get(rec.id) ?? 0,
    signalCount: counters.signals.get(rec.id) ?? 0,
  };
}

export async function companyDto(repo: Repository, rec: CompanyRecord): Promise<Company> {
  return toCompany(rec, await loadCompanyCounters(repo));
}

export async function signalDetail(
  repo: Repository,
  rec: SignalRecord,
  now: Date,
): Promise<SignalDetail> {
  const view = await loadSignalView(repo, now);
  const company = rec.companyId ? view.companies.get(rec.companyId) : undefined;
  const observations = signalObservations(rec, view).sort(
    (a, b) =>
      Date.parse(b.publishedAt ?? b.collectedAt) - Date.parse(a.publishedAt ?? a.collectedAt),
  );
  return {
    ...toSignal(rec, view),
    company: company ? await companyDto(repo, company) : null,
    observations,
  };
}

/* ------------------------------------------------------------------ */
/* Studio                                                              */
/* ------------------------------------------------------------------ */

export function toArticle(rec: ArticleRecord): Article {
  const { versions: _v, publishedAt: _p, createdBy: _c, ...dto } = rec;
  return dto;
}

export async function articleDetail(
  repo: Repository,
  rec: ArticleRecord,
  now: Date,
): Promise<ArticleDetail> {
  const [signal, observations, publications] = await Promise.all([
    rec.signalId ? repo.signals.get(rec.signalId) : Promise.resolve(undefined),
    repo.observations.list(),
    repo.publications.list(),
  ]);
  const wanted = new Set(rec.factChecks.flatMap((f) => f.observationIds));
  if (signal) for (const id of signal.observationIds) wanted.add(id);
  const view = signal ? await loadSignalView(repo, now) : null;
  return {
    ...toArticle(rec),
    versions: [...rec.versions].sort((a, b) => a.n - b.n),
    signal: signal && view ? toSignal(signal, view) : null,
    observations: observations.filter((o) => wanted.has(o.id)),
    publications: publications
      .filter((p) => p.articleId === rec.id)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
  };
}

export function toImport(rec: ImportRecord): HumanImport {
  const { bytes: _b, proposals, ...dto } = rec;
  return {
    ...dto,
    proposals: proposals.map(({ start: _s, end: _e, ...p }) => p),
  };
}

/* ------------------------------------------------------------------ */
/* Diffusion & référentiel                                             */
/* ------------------------------------------------------------------ */

export function toLinkedIn(rec: LinkedInPostRecord): LinkedInPost {
  const { createdBy: _c, ...dto } = rec;
  return dto;
}

export function toNewsletter(rec: NewsletterRecord): NewsletterEdition {
  const { createdBy: _c, ...dto } = rec;
  return { ...dto, items: [...dto.items].sort((a, b) => a.order - b.order) };
}

export function toRule(rec: RuleRecord): EditorialRule {
  const { history: _h, ...dto } = rec;
  return dto;
}

export function toProposal(rec: RuleProposalRecord): RuleProposal {
  const { signature: _s, ...dto } = rec;
  return dto;
}

export function toPublication(rec: PublicationAttempt): PublicationAttempt {
  return { ...rec, newsletterId: rec.newsletterId ?? null };
}
