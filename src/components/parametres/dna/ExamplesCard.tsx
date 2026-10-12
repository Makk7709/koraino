import { ExternalLink, Newspaper } from "lucide-react";
import { CountBadge, EmptyState, IconTile, KoraCard } from "@/components/kora/primitives";
import { formatDate } from "@/components/kora/labels";
import { ExternalAnchor } from "@/components/veille/kit";
import type { EditorialExample } from "@/lib/api/types";

/** Corpus d'exemples historiques récupérés au moment de la rédaction. */
export function ExamplesCard({ examples }: { examples: EditorialExample[] }) {
  return (
    <KoraCard
      title="Corpus d'exemples historiques"
      badge={<CountBadge value={examples.length} tone="blue" />}
    >
      <p className="mb-3 text-[12px] text-kora-ink-soft">
        Publications fournies par Inovallée : elles servent de références de style et sont
        récupérées au moment de la rédaction. Aucun entraînement dédié ni fine-tuning.
      </p>
      {examples.length === 0 ? (
        <EmptyState title="Aucun exemple dans le corpus" />
      ) : (
        <ul className="divide-y divide-border/70">
          {examples.map((ex) => (
            <li key={ex.id} className="flex items-start gap-3 py-2.5">
              <IconTile icon={Newspaper} tone="blue" size="sm" className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-snug font-semibold text-kora-ink">{ex.title}</p>
                <p className="mt-0.5 line-clamp-2 text-[12px] text-kora-ink-soft">{ex.excerpt}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {formatDate(ex.publishedAt)}
                </p>
              </div>
              {ex.url && (
                <ExternalAnchor href={ex.url} className="mt-0.5 shrink-0">
                  <ExternalLink className="size-3.5" aria-label="Ouvrir la publication" />
                </ExternalAnchor>
              )}
            </li>
          ))}
        </ul>
      )}
    </KoraCard>
  );
}
