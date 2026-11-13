import type { CollectionRun, CollectionRunStatus } from "@/lib/api/types";

const DAY_MS = 86_400_000;
const dayLabel = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

export function isFailedRun(status: CollectionRunStatus): boolean {
  return status === "echec" || status === "bloque_quota";
}

/**
 * Message porté par une collecte. Le serveur range au même endroit (`errorCode`, `errorMessage`)
 * l'erreur d'une collecte en échec ou bloquée et l'avertissement d'une collecte réussie :
 * c'est le statut qui les distingue.
 */
export interface RunNotice {
  kind: "erreur" | "avertissement";
  /** Code technique, tel que le serveur l'enregistre. */
  code: string;
  /** Texte de la pastille : le code pour une erreur, un libellé en français pour un avertissement. */
  label: string;
  message: string | null;
}

const WARNING_LABELS: Record<string, string> = {
  DATE_REJECTED: "Articles écartés",
  DATE_UNCHECKED: "Vérification incomplète",
};

/**
 * Libellé d'un avertissement. Hors vérification des dates, le seul avertissement est la panne
 * de Google News relayée par Perplexity : il porte le code de la panne (`HTTP_503`, `TIMEOUT`…).
 */
function warningLabel(code: string, message: string | null): string {
  const known = WARNING_LABELS[code];
  if (known) return known;
  return message?.startsWith("Google News") ? "Google News indisponible" : "Avertissement";
}

/** Erreur ou avertissement d'une collecte ; `null` si elle n'en porte pas. */
export function runNotice(run: CollectionRun): RunNotice | null {
  const code = run.errorCode;
  if (!code) return null;
  const message = run.errorMessage;
  if (isFailedRun(run.status)) return { kind: "erreur", code, label: code, message };
  return { kind: "avertissement", code, label: warningLabel(code, message), message };
}

export interface NoticeCount {
  code: string;
  label: string;
  count: number;
}

/** Erreurs et avertissements les plus fréquents, comptés à part, du plus au moins fréquent. */
export function topNotices(runs: CollectionRun[], limit = 4) {
  const errors = new Map<string, NoticeCount>();
  const warnings = new Map<string, NoticeCount>();
  for (const run of runs) {
    const notice = runNotice(run);
    if (!notice) continue;
    const counts = notice.kind === "erreur" ? errors : warnings;
    // Les avertissements sont regroupés par libellé : une panne de Google News garde le même
    // libellé quel que soit son code.
    const key = notice.kind === "erreur" ? notice.code : notice.label;
    const entry = counts.get(key) ?? { code: notice.code, label: notice.label, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  const top = (counts: Map<string, NoticeCount>) =>
    [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit);
  return { errors: top(errors), warnings: top(warnings) };
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
  let warnings = 0;
  for (const r of runs) {
    if (r.status === "echec") failed++;
    if (r.status === "bloque_quota") blocked++;
    if (runNotice(r)?.kind === "avertissement") warnings++;
    observations += r.newObservations;
  }
  const ok = runs.length - failed - blocked;
  return {
    total: runs.length,
    ok,
    failed,
    blocked,
    /** Collectes réussies qui portent un avertissement ; elles restent comptées dans `ok`. */
    warnings,
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
