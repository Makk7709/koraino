import type { UsageSnapshot } from "@/lib/api/types";
import type { Ctx } from "../context";
import {
  budgetExhausted,
  buildSnapshot,
  decideReservation,
  meterLabel,
  monthTotals,
  quotaExceeded,
} from "../domain/budget";
import { monthKey } from "../domain/dates";
import type { QuotaKey, UsageKind } from "../store/records";
import { conflict } from "../http";
import type { Repository } from "../store/repository";
import { audit, notify } from "./journal";
import { withLock } from "./locks";

export async function usageSnapshot(repo: Repository, now: Date): Promise<UsageSnapshot> {
  const [entries, settings, companies, sources, newsletters, imports] = await Promise.all([
    repo.usage.list(),
    repo.getSettings(),
    repo.companies.list(),
    repo.sources.list(),
    repo.newsletters.list(),
    repo.imports.list(),
  ]);
  const month = monthKey(now);
  return buildSnapshot({
    entries,
    settings,
    now,
    newslettersThisMonth: newsletters.filter((n) => monthKey(new Date(n.createdAt)) === month)
      .length,
    companies: companies.length,
    sources: sources.length,
    storageGb: settings.storageBaseGb + imports.reduce((s, i) => s + i.sizeBytes, 0) / 1e9,
  });
}

/** Refuse une action si elle dépasse un quota (422 `quota_exceeded`). */
export async function assertQuota(
  repo: Repository,
  now: Date,
  key: QuotaKey,
  increment = 1,
): Promise<void> {
  const snapshot = await usageSnapshot(repo, now);
  const meter = snapshot.meters.find((m) => m.key === key);
  if (meter && meter.used + increment > meter.limit)
    throw quotaExceeded(meterLabel(key), meter.limit);
}

const ALERT_METERS: QuotaKey[] = [
  "api_budget_eur",
  "search_queries",
  "observations",
  "articles",
  "linkedin_posts",
  "newsletters",
  "storage_gb",
];

const BUDGET_LOCK = "budget";
const BUDGET_LOCK_TTL_MS = 10_000;

/**
 * Les réglages (réservations, suspension, alertes) sont relus puis réécrits en entier : sans
 * verrou, deux appels payants simultanés dépasseraient le plafond ou laisseraient une
 * réservation fantôme qui ne serait jamais libérée.
 */
function withBudgetLock<T>(repo: Repository, fn: () => Promise<T>): Promise<T> {
  return withLock(
    repo,
    BUDGET_LOCK,
    {
      ttlMs: BUDGET_LOCK_TTL_MS,
      waitMs: 5_000,
      busy: () =>
        conflict(
          "budget_busy",
          "Le budget API est en cours de mise à jour : réessayez dans quelques secondes.",
        ),
    },
    fn,
  );
}

/** Alertes à 80 % puis 100 % (une notification par seuil et par mois). */
export async function checkAlerts(repo: Repository, now: Date): Promise<void> {
  const snapshot = await usageSnapshot(repo, now);
  const alertKey = (m: (typeof snapshot.meters)[number]) => `${snapshot.month}:${m.key}:${m.alert}`;
  const pending = (notified: string[]) =>
    snapshot.meters.filter(
      (m) => ALERT_METERS.includes(m.key) && m.alert !== "ok" && !notified.includes(alertKey(m)),
    );
  if (!pending((await repo.getSettings()).notifiedAlerts).length) return;
  const raised = await withBudgetLock(repo, async () => {
    const settings = await repo.getSettings();
    const fresh = pending(settings.notifiedAlerts);
    if (fresh.length) {
      settings.notifiedAlerts.push(...fresh.map(alertKey));
      await repo.saveSettings(settings);
    }
    return fresh;
  });
  for (const m of raised) {
    await notify(repo, now, {
      kind: "quota",
      title: m.alert === "atteint" ? `${m.label} : quota atteint` : `${m.label} : 80 % consommés`,
      body:
        m.key === "api_budget_eur" && m.alert === "atteint"
          ? "Plafond budgétaire atteint : les appels payants sont suspendus. Consultation et exports restent disponibles."
          : `${m.used} ${m.unit} utilisés sur ${m.limit}.`,
      link: "/parametres",
    });
  }
}

export interface PaidCall {
  kind: UsageKind;
  /** Coût maximal estimé, réservé avant l'appel. */
  estimate: number;
  units: number;
  label: string;
}

export interface UsageLine {
  kind: UsageKind;
  costEur: number;
  units: number;
  label: string;
}

/**
 * Appel payant : réserve le coût estimé AVANT l'appel. Si le plafond serait dépassé,
 * rien n'est appelé (402 `budget_exhausted`) et les appels payants sont suspendus.
 */
export async function paidCall<T>(
  ctx: Pick<Ctx, "repo" | "user" | "now">,
  call: PaidCall,
  fn: () => T | Promise<T>,
  actual?: (result: T) => UsageLine[],
): Promise<T> {
  const { repo, now } = ctx;
  const month = monthKey(now);
  const reservation = await withBudgetLock(repo, async () => {
    const settings = await repo.getSettings();
    const spent = monthTotals(await repo.usage.list(), month).costEur;
    const decision = decideReservation({
      settings,
      spentEur: spent,
      estimateEur: call.estimate,
      month,
    });
    if (!decision.ok) {
      const suspending = !settings.paidCallsSuspended || settings.suspendedMonth !== month;
      if (suspending) {
        settings.paidCallsSuspended = true;
        settings.suspendedMonth = month;
        await repo.saveSettings(settings);
      }
      return { ...decision, suspending };
    }
    settings.reservedEur += call.estimate;
    await repo.saveSettings(settings);
    return decision;
  });
  if (!reservation.ok) {
    if (reservation.suspending) {
      await audit(ctx, "quota.suspension", "quota", "api_budget_eur", reservation.reason, "KORA");
      await notify(repo, now, {
        kind: "quota",
        title: "Budget API : appels payants suspendus",
        body: "Le plafond mensuel est atteint. Consultation et exports restent disponibles.",
        link: "/parametres",
      });
    }
    throw budgetExhausted(reservation.reason);
  }

  let result: T;
  try {
    result = await fn();
    const lines = actual
      ? actual(result)
      : [{ kind: call.kind, costEur: call.estimate, units: call.units, label: call.label }];
    let remaining = call.estimate;
    for (const line of lines) {
      if (line.costEur <= 0 && line.units <= 0) continue;
      const cost = Math.max(0, Math.min(line.costEur, remaining));
      remaining -= cost;
      await repo.usage.insert({
        id: repo.nextId("use"),
        at: now.toISOString(),
        kind: line.kind,
        units: line.units,
        costEur: Math.round(cost * 10000) / 10000,
        label: line.label,
      });
    }
  } finally {
    await releaseReservation(repo, call.estimate);
  }
  await checkAlerts(repo, now).catch((e: unknown) => {
    console.error("[budget] alertes non vérifiées (revérifiées au prochain appel payant)", e);
  });
  return result;
}

/** Libérée après l'enregistrement du coût réel : à aucun moment l'appel n'échappe au plafond. */
async function releaseReservation(repo: Repository, amount: number): Promise<void> {
  const release = async () => {
    const s = await repo.getSettings();
    s.reservedEur = Math.max(0, s.reservedEur - amount);
    await repo.saveSettings(s);
  };
  await withBudgetLock(repo, release).catch(async (e: unknown) => {
    console.error("[budget] réservation libérée hors verrou", e);
    await release();
  });
}

/** Les appels payants sont-ils suspendus ce mois-ci ? */
export async function paidCallsSuspended(repo: Repository, now: Date): Promise<boolean> {
  return (await usageSnapshot(repo, now)).paidCallsSuspended;
}
