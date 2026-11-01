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
import type { QuotaKey, UsageKind, UsageEntry } from "../store/records";
import { conflict } from "../http";
import type { Repository } from "../store/repository";
import { validateEstimatedUsageLines } from "../store/paid-attempts";
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
  billingUncertain?: (result: T) => boolean,
): Promise<T> {
  const { repo, now } = ctx;
  const month = monthKey(now);
  // Unique attempt per invocation. Persisted before any potentially paid work.
  const id = repo.nextId("pat");
  const reservation = await withBudgetLock(repo, () =>
    repo.paidAttempts.reserve({
      id,
      workspaceId: repo.workspaceId,
      month,
      kind: call.kind,
      estimateEur: call.estimate,
      units: call.units,
      label: call.label,
      createdAt: now.toISOString(),
    }),
  );
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

  // A failed acknowledgement is ambiguous: the database may have committed start().
  // The provider callback has NOT run. Resolve only from a confirmed durable state.
  try {
    await repo.paidAttempts.start(id);
  } catch (error: unknown) {
    let disposition = "unresolved";
    try {
      const attempt = await repo.paidAttempts.get(id);
      if (attempt?.status === "reserved") {
        // DB confirms the attempt never entered in_flight; no provider work was started.
        await repo.paidAttempts.finish(id, [], "not_sent");
        disposition = "not_sent";
      } else if (attempt?.status === "in_flight") {
        // The write committed but its acknowledgement was lost. Preserve exposure.
        await repo.paidAttempts.unknown(id, "persist_error");
        disposition = "unknown";
      } else if (attempt?.status === "unknown") {
        disposition = "unknown";
      }
    } catch (recoveryError: unknown) {
      console.error(
        JSON.stringify({
          event: "kora.paid_attempt.start_recovery_failed",
          attemptId: id,
          errorType: recoveryError instanceof Error ? recoveryError.name : "unknown",
        }),
      );
    }
    console.error(
      JSON.stringify({
        event: "kora.paid_attempt.start_failed",
        attemptId: id,
        disposition,
        errorType: error instanceof Error ? error.name : "unknown",
      }),
    );
    throw error;
  }
  let result: T;
  try {
    result = await fn();
  } catch (error: unknown) {
    // Even if callback rejects, a supplier might already have billed the request.
    await repo.paidAttempts
      .unknown(id, "provider_or_callback_error")
      .catch((stateError: unknown) => {
        console.error(
          JSON.stringify({
            event: "kora.paid_attempt.unknown_persist_failed",
            attemptId: id,
            errorType: stateError instanceof Error ? stateError.name : "unknown",
          }),
        );
      });
    throw error;
  }

  // A usable fallback result does not prove that an earlier timeout was free.
  // Retain the full reservation for administrator reconciliation.
  let hasBillingUncertainty = false;
  try {
    hasBillingUncertainty = billingUncertain?.(result) ?? false;
  } catch (error: unknown) {
    await repo.paidAttempts
      .unknown(id, "provider_or_callback_error")
      .catch((stateError: unknown) => {
        console.error(
          JSON.stringify({
            event: "kora.paid_attempt.billing_uncertainty_persist_failed",
            attemptId: id,
            errorType: stateError instanceof Error ? stateError.name : "unknown",
          }),
        );
      });
    throw error;
  }
  if (hasBillingUncertainty) {
    await repo.paidAttempts.unknown(id, "provider_or_callback_error");
    console.warn(JSON.stringify({ event: "kora.paid_attempt.billing_uncertain", attemptId: id }));
    return result;
  }

  try {
    const usage = actual
      ? actual(result)
      : [{ kind: call.kind, costEur: call.estimate, units: call.units, label: call.label }];
    const lines: UsageEntry[] = [];
    for (const line of usage) {
      if (line.costEur <= 0 && line.units <= 0) continue;
      if (
        !Number.isFinite(line.costEur) ||
        !Number.isFinite(line.units) ||
        line.costEur < 0 ||
        line.units < 0
      ) {
        throw new Error("Invalid usage line");
      }
      const cost = line.costEur;
      const costUnits = cost * 10000;
      if (
        !Number.isSafeInteger(Math.round(costUnits)) ||
        Math.abs(costUnits - Math.round(costUnits)) > 1e-7
      ) {
        throw new Error("Invalid usage cost precision");
      }
      lines.push({
        id: `${id}:line:${lines.length}`,
        at: now.toISOString(),
        kind: line.kind,
        units: line.units,
        costEur: Math.round(cost * 10000) / 10000,
        label: line.label,
      });
    }
    const total = validateEstimatedUsageLines(lines, id);
    if (total > call.estimate + 1e-9) {
      await repo.paidAttempts.overrun(id, lines);
      console.warn(
        JSON.stringify({
          event: "kora.paid_attempt.estimated_overrun",
          attemptId: id,
          reservedEur: call.estimate,
          estimatedCostEur: total,
          overrunEur: Math.round((total - call.estimate) * 10000) / 10000,
        }),
      );
      return result;
    }
    // Atomic journal insertion + reservation release, idempotent in PostgreSQL.
    // The budget lock also protects legacy settings writes during A3 transition.
    await withBudgetLock(repo, () => repo.paidAttempts.finish(id, lines, "settled"));
  } catch (error: unknown) {
    // Keep the reservation; transaction may have committed despite a lost response.
    let persistedStatus: string | undefined;
    try {
      persistedStatus = (await repo.paidAttempts.get(id))?.status;
    } catch (readError: unknown) {
      console.error(
        JSON.stringify({
          event: "kora.paid_attempt.settlement_state_read_failed",
          attemptId: id,
          errorType: readError instanceof Error ? readError.name : "unknown",
        }),
      );
    }
    if (!persistedStatus || persistedStatus === "in_flight") {
      await repo.paidAttempts.unknown(id, "persist_error").catch((stateError: unknown) => {
        console.error(
          JSON.stringify({
            event: "kora.paid_attempt.settlement_uncertain",
            attemptId: id,
            errorType: stateError instanceof Error ? stateError.name : "unknown",
          }),
        );
      });
    }
    // Never overwrite an already durable estimated_overrun with a generic persistence code.
    throw error;
  }
  await checkAlerts(repo, now).catch((e: unknown) => {
    console.error(
      JSON.stringify({
        event: "kora.budget.alert_check_failed",
        errorType: e instanceof Error ? e.name : "unknown",
      }),
    );
  });
  return result;
}

/** Les appels payants sont-ils suspendus ce mois-ci ? */
export async function paidCallsSuspended(repo: Repository, now: Date): Promise<boolean> {
  return (await usageSnapshot(repo, now)).paidCallsSuspended;
}
