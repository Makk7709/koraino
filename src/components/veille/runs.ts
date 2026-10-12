import type { CollectionRun, CollectionRunStatus } from "@/lib/api/types";

const DAY_MS = 86_400_000;
const dayLabel = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

export function isFailedRun(status: CollectionRunStatus): boolean {
  return status === "echec" || status === "bloque_quota";
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export interface RunDay {
  key: string;
  label: string;
  /** Succès avec au moins une nouvelle observation. */
  success: number;
  /** Succès confirmé sans nouvelle actualité (source joignable). */
  empty: number;
  /** Échec d'accès ou collecte bloquée par quota. */
  failed: number;
  observations: number;
}

/** Collectes agrégées par jour sur les `days` derniers jours (jour courant inclus). */
export function runsByDay(runs: CollectionRun[], days: number, now = new Date()): RunDay[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const buckets: RunDay[] = [];
  const index = new Map<string, RunDay>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS);
    const bucket: RunDay = {
      key: dayKey(d),
      label: dayLabel.format(d),
      success: 0,
      empty: 0,
      failed: 0,
      observations: 0,
    };
    buckets.push(bucket);
    index.set(bucket.key, bucket);
  }
  for (const run of runs) {
    const bucket = index.get(dayKey(new Date(run.startedAt)));
    if (!bucket) continue;
    if (isFailedRun(run.status)) bucket.failed++;
    else if (run.status === "succes_sans_actualite") bucket.empty++;
    else bucket.success++;
    bucket.observations += run.newObservations;
  }
  return buckets;
}

export function runsSince(runs: CollectionRun[], hours: number, now = Date.now()) {
  const from = now - hours * 3_600_000;
  return runs.filter((r) => new Date(r.startedAt).getTime() >= from);
}

export function summarizeRuns(runs: CollectionRun[]) {
  let failed = 0;
  let blocked = 0;
  let observations = 0;
  for (const r of runs) {
    if (r.status === "echec") failed++;
    if (r.status === "bloque_quota") blocked++;
    observations += r.newObservations;
  }
  const ok = runs.length - failed - blocked;
  return {
    total: runs.length,
    ok,
    failed,
    blocked,
    observations,
    successRate: runs.length ? ok / runs.length : null,
  };
}

/** Durée lisible d'une collecte (« 2,4 s »), ou « en cours ». */
export function runDuration(run: CollectionRun): string {
  if (!run.finishedAt) return "en cours";
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  if (ms < 1000) return `${Math.max(0, ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
  return `${Math.round(ms / 60_000)} min`;
}

/** URL sans protocole ni slash final, pour l'affichage compact. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}
