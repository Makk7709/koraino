import type { Signal } from "@/lib/api/types";
import { adapters } from "../adapters";
import { DAY, daysBetween, parseDate } from "../domain/dates";
import { markSyndication } from "../domain/evidence";
import { applyGrid, assess } from "../domain/scoring";
import { wordCount } from "../domain/text";
import type { CompanyRecord, GridRecord, ObservationRecord, SignalRecord } from "../store/records";
import type { Repository } from "../store/repository";

export async function activeGrid(repo: Repository): Promise<GridRecord> {
  const grids = await repo.grids.list();
  const active = grids.find((g) => g.active) ?? [...grids].sort((a, b) => b.version - a.version)[0];
  if (!active) throw new Error("Aucune grille de score configurée");
  return active;
}

function obsTime(o: ObservationRecord): number {
  return Date.parse(o.publishedAt ?? o.collectedAt);
}

export interface RebuildInput {
  signal: SignalRecord;
  observations: ObservationRecord[];
  company: CompanyRecord | null;
  grid: GridRecord;
  /** Autres signaux (pour la nouveauté : même entreprise, même catégorie sur 90 jours). */
  others: SignalRecord[];
  now: Date;
}

/**
 * Recalcule les champs dérivés d'un signal à partir de ses observations (reprises, source
 * principale, dates), puis réévalue sous-notes et score avec la grille fournie.
 * Les dates inconnues restent `null`.
 */
export function rebuildSignal(input: RebuildInput): {
  signal: SignalRecord;
  observations: ObservationRecord[];
} {
  const { signal, company, grid, now } = input;
  const marked = markSyndication(
    [...input.observations]
      .map((o) => ({ ...o, signalId: signal.id }))
      .sort((a, b) => obsTime(a) - obsTime(b) || a.id.localeCompare(b.id)),
  );
  const primary =
    marked.find((o) => !o.isSyndicated && (!company || o.outlet.domain !== company.domain)) ??
    marked[0];
  const published = marked
    .map((o) => o.publishedAt)
    .filter((d): d is string => !!d)
    .sort();
  const events = marked
    .map((o) => o.eventDate)
    .filter((d): d is string => !!d)
    .sort();
  const collected = marked.map((o) => o.collectedAt).sort();
  const eventDate = events[0] ?? null;
  const reference = parseDate(eventDate ?? published[0] ?? null);
  const created = new Date(signal.createdAt);

  const priorSameCategory =
    !!signal.companyId &&
    input.others.some(
      (s) =>
        s.id !== signal.id &&
        s.companyId === signal.companyId &&
        s.category === signal.category &&
        Date.parse(s.createdAt) < created.getTime() &&
        created.getTime() - Date.parse(s.createdAt) <= 90 * DAY,
    );
  const base = assess({
    category: signal.category,
    title: signal.title,
    text: `${signal.summary} ${marked.map((o) => o.excerpt).join(" ")}`,
    company,
    observations: marked,
    priorSameCategory,
    eventLagDays: reference ? Math.max(0, daysBetween(reference, created)) : null,
    content: signal.assessment ?? null,
  });
  const score = applyGrid(base, grid);
  const notes = adapters().textModel.editorialNotes({
    category: signal.category,
    companyName: company?.name ?? null,
    score,
  });
  const words = wordCount(`${signal.summary} ${marked.map((o) => o.excerpt).join(" ")}`);
  const next: SignalRecord = {
    ...signal,
    observationIds: marked.map((o) => o.id),
    primaryOutlet: primary?.outlet ?? signal.primaryOutlet,
    primaryUrl: primary?.url ?? signal.primaryUrl,
    collectedAt: collected[0] ?? signal.collectedAt,
    publishedAt: published[0] ?? null,
    eventDate,
    score,
    whyInteresting: notes.whyInteresting,
    suggestedAngle: notes.suggestedAngle,
    readingMinutes: Math.max(1, Math.min(6, Math.round(words / 120))),
    updatedAt: now.toISOString(),
  };
  return { signal: next, observations: marked };
}

/** Persiste un signal reconstruit et ses observations. */
export async function saveRebuilt(
  repo: Repository,
  rebuilt: { signal: SignalRecord; observations: ObservationRecord[] },
): Promise<void> {
  await repo.signals.update(rebuilt.signal);
  for (const o of rebuilt.observations) await repo.observations.update(o);
}

export async function rebuildAndSave(
  repo: Repository,
  signal: SignalRecord,
  now: Date,
  grid?: GridRecord,
): Promise<SignalRecord> {
  const [observations, company, others, g] = await Promise.all([
    repo.observations.list(),
    signal.companyId ? repo.companies.get(signal.companyId) : Promise.resolve(undefined),
    repo.signals.list(),
    grid ? Promise.resolve(grid) : activeGrid(repo),
  ]);
  const ids = new Set(signal.observationIds);
  const rebuilt = rebuildSignal({
    signal,
    observations: observations.filter((o) => ids.has(o.id)),
    company: company ?? null,
    grid: g,
    others,
    now,
  });
  await saveRebuilt(repo, rebuilt);
  return rebuilt.signal;
}

export const STATUS_LABEL: Record<Signal["status"], string> = {
  nouveau: "Nouveau",
  a_traiter: "À traiter",
  en_revue: "En revue",
  surveille: "Surveillé",
  traite: "Traité",
  rejete: "Rejeté",
};
