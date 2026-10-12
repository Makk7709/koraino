import { Check, Lock, X } from "lucide-react";
import {
  EmptyState,
  GhostButton,
  KoraCard,
  Pill,
  PrimaryButton,
  SolidBadge,
} from "@/components/kora/primitives";
import { formatRelative } from "@/components/kora/labels";
import { Notice } from "@/components/veille/kit";
import { api } from "@/lib/api/client";
import { useKoraMutation } from "@/lib/api/hooks";
import type { EditorialRule, RuleProposal } from "@/lib/api/types";
import { RULE_KIND } from "../labels";

const STATUS = {
  proposee: { label: "À décider", tone: "amber" },
  acceptee: { label: "Acceptée", tone: "green" },
  refusee: { label: "Refusée", tone: "gray" },
} as const;

function ProposalItem({
  proposal: p,
  rule,
  readOnly,
}: {
  proposal: RuleProposal;
  rule: EditorialRule | undefined;
  readOnly: boolean;
}) {
  const decide = useKoraMutation(
    (decision: "acceptee" | "refusee") => api.decideRuleProposal(p.id, decision),
    {
      success: (r) =>
        r.status === "acceptee"
          ? "Proposition acceptée : le référentiel éditorial est mis à jour"
          : "Proposition refusée : le référentiel reste inchangé",
    },
  );
  const kind = RULE_KIND[p.kind];
  const status = STATUS[p.status];
  const pending = p.status === "proposee";

  return (
    <li className="rounded-xl border border-border/80 bg-white p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={kind.tone} size="sm">
          {kind.label}
        </Pill>
        <span className="text-[11px] text-muted-foreground">
          {p.ruleId ? "Modification de règle" : "Nouvelle règle"} · issue de {p.basedOnCorrections}{" "}
          correction{p.basedOnCorrections > 1 ? "s" : ""} · {formatRelative(p.createdAt)}
        </span>
        <Pill tone={status.tone} size="sm" className="ml-auto">
          {status.label}
        </Pill>
      </div>
      {rule && (
        <p className="mt-2 rounded-md bg-secondary/60 px-2.5 py-1.5 text-[12px] text-muted-foreground">
          <span className="font-semibold text-kora-ink-soft">Règle actuelle :</span> « {rule.text} »
        </p>
      )}
      <p className="mt-2 text-[13px] leading-snug font-semibold text-kora-ink">
        « {p.proposedText} »
      </p>
      <p className="mt-1 text-[12px] text-kora-ink-soft">{p.rationale}</p>
      {pending ? (
        <div className="mt-3 flex justify-end gap-2">
          <GhostButton
            className="h-8 px-3 text-[12px]"
            disabled={readOnly || decide.isPending}
            onClick={() => decide.mutate("refusee")}
          >
            <X className="size-3.5" /> Refuser
          </GhostButton>
          <PrimaryButton
            className="h-8 px-3 text-[12px]"
            disabled={readOnly || decide.isPending}
            onClick={() => decide.mutate("acceptee")}
          >
            <Check className="size-3.5" /> Accepter
          </PrimaryButton>
        </div>
      ) : (
        p.decidedBy && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {status.label} par {p.decidedBy}
          </p>
        )
      )}
    </li>
  );
}

/** WF6 : propositions issues des corrections, soumises à décision humaine. */
export function ProposalsCard({
  proposals,
  rules,
  readOnly,
}: {
  proposals: RuleProposal[];
  rules: EditorialRule[];
  readOnly: boolean;
}) {
  const pendingCount = proposals.filter((p) => p.status === "proposee").length;
  const sorted = [...proposals].sort(
    (a, b) =>
      Number(b.status === "proposee") - Number(a.status === "proposee") ||
      b.createdAt.localeCompare(a.createdAt),
  );
  return (
    <KoraCard
      title="Propositions issues des corrections"
      badge={pendingCount > 0 ? <SolidBadge value={pendingCount} tone="orange" /> : undefined}
    >
      <Notice tone="amber" icon={Lock} className="mb-3">
        <span className="font-semibold text-kora-ink">
          Aucune règle n&apos;est modifiée automatiquement.
        </span>{" "}
        Les corrections des rédacteurs alimentent ces propositions ; chacune attend une décision
        explicite.
      </Notice>
      {sorted.length === 0 ? (
        <EmptyState title="Aucune proposition en attente">
          Les prochaines corrections de brouillons alimenteront cette revue.
        </EmptyState>
      ) : (
        <ul className="space-y-2.5">
          {sorted.map((p) => (
            <ProposalItem
              key={p.id}
              proposal={p}
              rule={p.ruleId ? rules.find((r) => r.id === p.ruleId) : undefined}
              readOnly={readOnly}
            />
          ))}
        </ul>
      )}
    </KoraCard>
  );
}
