import type { Ctx } from "../context";
import { analyzeCorrections, collectCorrections } from "../domain/dna";
import type { RuleProposalRecord } from "../store/records";

/**
 * WF6 : relance l'analyse des corrections humaines et met à jour les propositions.
 * Une proposition déjà décidée (acceptée ou refusée) n'est jamais reproposée.
 */
export async function refreshProposals(
  ctx: Pick<Ctx, "repo" | "now">,
): Promise<RuleProposalRecord[]> {
  const [articles, rules, existing] = await Promise.all([
    ctx.repo.articles.list(),
    ctx.repo.rules.list(),
    ctx.repo.ruleProposals.list(),
  ]);
  const created: RuleProposalRecord[] = [];
  for (const c of analyzeCorrections(collectCorrections(articles), rules)) {
    const same = existing.find((p) => p.signature === c.signature);
    if (same) {
      if (same.status === "proposee" && same.basedOnCorrections !== c.basedOnCorrections) {
        await ctx.repo.ruleProposals.update({
          ...same,
          basedOnCorrections: c.basedOnCorrections,
          proposedText: c.proposedText,
          rationale: c.rationale,
        });
      }
      continue;
    }
    const rec: RuleProposalRecord = {
      id: ctx.repo.nextId("rp"),
      kind: c.kind,
      proposedText: c.proposedText,
      ruleId: c.ruleId,
      basedOnCorrections: c.basedOnCorrections,
      rationale: c.rationale,
      status: "proposee",
      createdAt: ctx.now.toISOString(),
      decidedBy: null,
      signature: c.signature,
    };
    await ctx.repo.ruleProposals.insert(rec);
    created.push(rec);
  }
  return created;
}
