import { InovalleeAvatar } from "@/components/linkedin/InovalleeAvatar";
import { weekLabel } from "./format";

export interface PreviewItem {
  id: string;
  title: string;
  summary: string;
}

/** Rendu fidèle à l'export HTML : bandeau teal Inovallée, introduction, sujets numérotés. */
export function NewsletterPreview({
  title,
  intro,
  weekOf,
  items,
  version,
  approved,
}: {
  title: string;
  intro: string;
  weekOf: string;
  items: PreviewItem[];
  version: number;
  approved: boolean;
}) {
  return (
    <div className="rounded-xl bg-muted/70 p-3">
      <div className="mx-auto max-w-[640px] overflow-hidden rounded-xl bg-white shadow-[0_2px_10px_-4px_oklch(0.289_0.062_263.9/18%)]">
        {!approved && (
          <p className="bg-kora-amber-bg px-6 py-2 text-[11.5px] font-medium text-kora-amber">
            Aperçu — version {version} non approuvée.
          </p>
        )}
        <header className="bg-linear-to-br from-kora-teal to-kora-teal-dark px-6 py-5">
          <div className="flex items-center gap-3">
            <InovalleeAvatar className="size-9" />
            <p className="text-[11px] font-semibold tracking-[0.06em] text-white/85 uppercase">
              Inovallée · {weekLabel(weekOf)}
            </p>
          </div>
          <h2 className="mt-3 text-[21px] leading-tight font-bold text-white">
            {title || "Sans titre"}
          </h2>
        </header>
        {intro && (
          <p className="px-6 pt-5 pb-4 text-[13.5px] leading-relaxed whitespace-pre-line text-kora-ink-soft">
            {intro}
          </p>
        )}
        {items.length === 0 ? (
          <p className="mx-6 my-4 rounded-lg border border-dashed px-4 py-6 text-center text-[12.5px] text-muted-foreground">
            Aucun sujet sélectionné.
          </p>
        ) : (
          <ol>
            {items.map((it, i) => (
              <li key={it.id} className="border-t border-border/80 px-6 py-4">
                <h3 className="text-[15px] leading-snug font-bold text-kora-ink">
                  <span className="text-kora-teal">{i + 1}.</span> {it.title}
                </h3>
                {it.summary && (
                  <p className="mt-1 text-[13px] leading-relaxed text-kora-ink-soft">
                    {it.summary}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
        <footer className="bg-muted/70 px-6 py-3 text-[11px] text-muted-foreground">
          Inovallée — édition {version}. Export préparé avec KORA Newsroom ; aucun envoi
          automatique.
        </footer>
      </div>
    </div>
  );
}
