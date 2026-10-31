import { budgetExhausted } from "../domain/budget";

/** Optional OpenAI fallback requires its own reservation, never just the primary estimate. */
export function estimatedTextAiCost(baseEstimateEur: number): number {
  const fallbackConfigured =
    process.env["KORA_AI_FALLBACK_ENABLED"] === "true" &&
    Boolean(process.env["ANTHROPIC_API_KEY"]?.trim()) &&
    Boolean(process.env["AI_API_KEY"]?.trim());
  if (!fallbackConfigured) return baseEstimateEur;
  const raw = process.env["KORA_AI_FALLBACK_RESERVE_EUR_PER_CALL"];
  const extra = raw?.trim() ? Number(raw) : Number.NaN;
  if (!Number.isFinite(extra) || extra <= 0) {
    throw budgetExhausted("Réserve de secours OpenAI absente ou invalide.");
  }
  // Both amounts are indicative caps for KORA, not guaranteed invoice limits.
  return baseEstimateEur + extra;
}
