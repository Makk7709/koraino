import type { QuotaMeter, UsageSnapshot } from "@/lib/api/types";
import { HttpError, unprocessable } from "../http";
import type { QuotaKey, Settings, UsageEntry, UsageKind } from "../store/records";
import { monthKey } from "./dates";

/** Quotas mensuels de l'offre (§12). */
export const DEFAULT_LIMITS: Record<QuotaKey, number> = {
  api_budget_eur: 150,
  search_queries: 3000,
  observations: 6000,
  articles: 25,
  linkedin_posts: 25,
  newsletters: 5,
  companies: 150,
  sources: 300,
  storage_gb: 10,
};

/** Coûts estimés réservés avant chaque appel payant (€ HT). */
export const COSTS = {
  article: 0.45,
  linkedin: 0.08,
  summary: 0.02,
  /** Lecture d'une publication par le modèle (catégorie, importance) à la collecte. */
  classification: 0.005,
  search: 0.012,
  observation: 0.021,
} as const;

const METERS: { key: QuotaKey; label: string; unit: string }[] = [
  { key: "api_budget_eur", label: "Budget API", unit: "€ HT" },
  { key: "search_queries", label: "Recherches web", unit: "requêtes" },
  { key: "observations", label: "Nouvelles observations", unit: "observations" },
  { key: "articles", label: "Dossiers et articles", unit: "articles" },
  { key: "linkedin_posts", label: "Posts LinkedIn", unit: "posts" },
  { key: "newsletters", label: "Éditions newsletter", unit: "éditions" },
  { key: "companies", label: "Entreprises suivies", unit: "entreprises" },
  { key: "sources", label: "Sources configurées", unit: "sources" },
  { key: "storage_gb", label: "Stockage", unit: "Go" },
];

const KIND_TO_METER: Partial<Record<UsageKind, QuotaKey>> = {
  generation_article: "articles",
  generation_linkedin: "linkedin_posts",
  search_query: "search_queries",
  observation: "observations",
};

export interface UsageTotals {
  costEur: number;
  units: Record<QuotaKey, number>;
}

/** Totaux du mois calculés à partir du journal de consommation. */
export function monthTotals(entries: UsageEntry[], month: string): UsageTotals {
  const units = Object.fromEntries(METERS.map((m) => [m.key, 0])) as Record<QuotaKey, number>;
  let cents = 0;
  for (const e of entries) {
    if (monthKey(new Date(e.at)) !== month) continue;
    cents += Math.round(e.costEur * 10000);
    const meter = KIND_TO_METER[e.kind];
    if (meter) units[meter] += e.units;
  }
  return { costEur: Math.round(cents / 100) / 100, units };
}

export function alertLevel(ratio: number): QuotaMeter["alert"] {
  if (ratio >= 1) return "atteint";
  if (ratio >= 0.8) return "seuil_80";
  return "ok";
}

export function buildSnapshot(input: {
  entries: UsageEntry[];
  settings: Settings;
  now: Date;
  newslettersThisMonth: number;
  companies: number;
  sources: number;
  storageGb: number;
}): UsageSnapshot {
  const month = monthKey(input.now);
  const totals = monthTotals(input.entries, month);
  const used: Record<QuotaKey, number> = {
    ...totals.units,
    api_budget_eur: totals.costEur,
    newsletters: input.newslettersThisMonth,
    companies: input.companies,
    sources: input.sources,
    storage_gb: Math.round(input.storageGb * 100) / 100,
  };
  const meters: QuotaMeter[] = METERS.map((m) => {
    const limit = input.settings.quotaLimits[m.key];
    const ratio = limit > 0 ? Math.min(1, used[m.key] / limit) : 1;
    return {
      key: m.key,
      label: m.label,
      used: used[m.key],
      limit,
      unit: m.unit,
      ratio: Math.round(ratio * 1000) / 1000,
      alert: alertLevel(ratio),
    };
  });
  const budget = meters.find((m) => m.key === "api_budget_eur")!;
  const suspended =
    budget.alert === "atteint" ||
    (input.settings.paidCallsSuspended && input.settings.suspendedMonth === month);
  return { month, meters, paidCallsSuspended: suspended };
}

export function budgetExhausted(message: string): HttpError {
  return new HttpError(402, "budget_exhausted", message);
}

/**
 * Décision de réservation : le coût estimé est réservé AVANT l'appel ; si le plafond serait
 * dépassé, l'appel est refusé et les appels payants sont suspendus pour le mois.
 */
export function decideReservation(input: {
  settings: Settings;
  spentEur: number;
  estimateEur: number;
  month: string;
}): { ok: true } | { ok: false; reason: string } {
  const { settings, spentEur, estimateEur, month } = input;
  const limit = settings.quotaLimits.api_budget_eur;
  if (settings.paidCallsSuspended && settings.suspendedMonth === month) {
    return {
      ok: false,
      reason: "Les appels payants sont suspendus : plafond budgétaire API du mois atteint.",
    };
  }
  if (spentEur + settings.reservedEur + estimateEur > limit + 1e-9) {
    return {
      ok: false,
      reason: `Plafond budgétaire API atteint (${spentEur.toFixed(2)} € consommés sur ${limit} €) : les appels payants sont suspendus. Consultation et exports restent disponibles.`,
    };
  }
  return { ok: true };
}

export function quotaExceeded(label: string, limit: number): HttpError {
  return unprocessable("quota_exceeded", `Quota mensuel atteint : ${label} (${limit} maximum).`, {
    limit,
  });
}

export function meterLabel(key: QuotaKey): string {
  return METERS.find((m) => m.key === key)?.label ?? key;
}
