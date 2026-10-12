import { ArrowDown, ArrowUp, FileText, Lightbulb, Trash2 } from "lucide-react";
import { EmptyState, Pill } from "@/components/kora/primitives";
import { Textarea } from "@/components/ui/textarea";
import type { NewsletterItem } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { IconButton, inputClass } from "@/components/articles/ui";

/** Sujets de l'édition, dans l'ordre d'envoi, avec résumé éditable. */
export function ItemsList({
  items,
  summaries,
  onSummary,
  onMove,
  onRemove,
  busy,
  readOnly,
}: {
  items: NewsletterItem[];
  summaries: Record<string, string>;
  onSummary: (id: string, summary: string) => void;
  onMove: (index: number, delta: -1 | 1) => void;
  onRemove: (id: string) => void;
  busy: boolean;
  readOnly: boolean;
}) {
  if (!items.length)
    return (
      <EmptyState title="Aucun sujet sélectionné">
        Ajoutez des signaux ou des articles depuis le panneau « Ajouter des sujets ».
      </EmptyState>
    );
  return (
    <ol className="flex flex-col gap-2">
      {items.map((it, i) => {
        const value = summaries[it.id] ?? it.summary;
        const edited = value !== it.summary;
        return (
          <li
            key={it.id}
            className={cn(
              "flex gap-3 rounded-xl border bg-white p-3",
              edited ? "border-kora-amber/40" : "border-border",
            )}
          >
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-kora-teal-bg text-[12px] font-bold text-kora-teal tabular-nums">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 text-[13px] leading-snug font-semibold text-kora-ink">
                  {it.title}
                </p>
                <Pill tone={it.articleId ? "blue" : "purple"} size="sm">
                  {it.articleId ? (
                    <>
                      <FileText className="size-3" /> Article
                    </>
                  ) : (
                    <>
                      <Lightbulb className="size-3" /> Signal
                    </>
                  )}
                </Pill>
              </div>
              <Textarea
                value={value}
                onChange={(e) => onSummary(it.id, e.target.value)}
                readOnly={readOnly}
                rows={3}
                aria-label={`Résumé du sujet ${i + 1}`}
                className={cn(inputClass, "mt-2 min-h-[64px] leading-relaxed")}
              />
              {edited && (
                <p className="mt-1 text-[11px] font-medium text-kora-amber">Résumé modifié</p>
              )}
            </div>
            <div className="flex shrink-0 flex-col gap-1">
              <IconButton
                label="Monter"
                icon={ArrowUp}
                disabled={busy || readOnly || i === 0}
                onClick={() => onMove(i, -1)}
              />
              <IconButton
                label="Descendre"
                icon={ArrowDown}
                disabled={busy || readOnly || i === items.length - 1}
                onClick={() => onMove(i, 1)}
              />
              <IconButton
                label="Retirer de l'édition"
                icon={Trash2}
                tone="danger"
                disabled={busy || readOnly}
                onClick={() => onRemove(it.id)}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
