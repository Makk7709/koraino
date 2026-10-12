import { BookOpen } from "lucide-react";
import { BlockSkeleton, ErrorPanel, Notice } from "@/components/veille/kit";
import { useEditorialDna } from "@/lib/api/hooks";
import { ExamplesCard } from "./dna/ExamplesCard";
import { ProposalsCard } from "./dna/ProposalsCard";
import { RulesCard } from "./dna/RulesCard";

/** Editorial DNA (§4.1, WF6) : règles, corpus et propositions à valider. */
export function EditorialDnaTab({ readOnly }: { readOnly: boolean }) {
  const dna = useEditorialDna();

  if (dna.error) {
    return (
      <ErrorPanel
        title="Le référentiel éditorial n'a pas pu être chargé"
        error={dna.error}
        onRetry={() => void dna.refetch()}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Notice tone="teal" icon={BookOpen} title="Référentiel éditorial Inovallée">
        Le corpus historique établit les règles de ton, longueur, structure et vocabulaire
        appliquées par l&apos;Editorial Studio. Les corrections des rédacteurs donnent lieu à une
        revue explicite des règles et exemples : elles ne modifient jamais automatiquement un modèle
        ni une règle.
      </Notice>
      {!dna.data ? (
        <div className="grid grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] gap-4">
          <BlockSkeleton className="h-[520px]" />
          <BlockSkeleton className="h-[520px]" />
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] items-start gap-4">
          <RulesCard rules={dna.data.rules} readOnly={readOnly} />
          <div className="flex flex-col gap-4">
            <ProposalsCard
              proposals={dna.data.proposals}
              rules={dna.data.rules}
              readOnly={readOnly}
            />
            <ExamplesCard examples={dna.data.examples} />
          </div>
        </div>
      )}
    </div>
  );
}
