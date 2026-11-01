import { budgetExhausted } from "../domain/budget";
import { isFourDecimalMoney } from "../store/paid-attempts";

/** Optional OpenAI fallback requires its own reservation, never just the primary estimate. */
export function estimatedTextAiCost(baseEstimateEur: number): number {
  const fallbackConfigured =
    process.env["KORA_AI_FALLBACK_ENABLED"] === "true" &&
    Boolean(process.env["ANTHROPIC_API_KEY"]?.trim()) &&
    Boolean(process.env["AI_API_KEY"]?.trim());
  if (!isFourDecimalMoney(baseEstimateEur)) {
    throw budgetExhausted("Estimation principale invalide : précision de quatre décimales requise.");
  }
  if (!fallbackConfigured) return baseEstimateEur;
  const raw = process.env["KORA_AI_FALLBACK_RESERVE_EUR_PER_CALL"];
  const extra = raw?.trim() ? Number(raw) : Number.NaN;
  if (!isFourDecimalMoney(extra)) {
    throw budgetExhausted("Réserve de secours OpenAI invalide : quatre décimales maximum.");
  }
  // Add integer ten-thousandths: no silently truncated reserve or floating-point drift.
  const total = (Math.round(baseEstimateEur * 10_000) + Math.round(extra * 10_000)) / 10_000;
  if (!isFourDecimalMoney(total)) {
    throw budgetExhausted("Réserve totale invalide.");
  }
  return total;
}
