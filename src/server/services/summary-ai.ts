import { adapters } from "../adapters";
import type { Ctx } from "../context";
import { COSTS } from "../domain/budget";
import { HttpError } from "../http";
import { estimatedTextAiCost } from "./ai-estimate";
import { paidCall } from "./usage";

/** Bounded, optional summary refinement; always preserve the template on failure. */
export async function improveSummary(
  ctx: Pick<Ctx, "repo" | "user" | "now">,
  input: { title: string; text: string },
  base: string,
): Promise<string> {
  const ai = adapters().ai;
  if (!ai || !process.env["ANTHROPIC_API_KEY"]?.trim()) return base;
  try {
    return await paidCall(
      ctx,
      {
        kind: "generation_summary",
        estimate: estimatedTextAiCost(COSTS.summary),
        units: 1,
        label: "Amélioration du résumé Haiku / secours IA éventuel (estimation)",
      },
      () => ai.enhanceSummary(input, base),
    );
  } catch (error: unknown) {
    const code = error instanceof HttpError ? error.code : "summary_enhancement_failed";
    console.warn(JSON.stringify({ event: "kora.summary.skipped", code }));
    return base;
  }
}
