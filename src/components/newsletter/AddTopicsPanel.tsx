import { Check, FileText, Lightbulb, Plus, Search } from "lucide-react";
import { useState } from "react";
import { BrandMark } from "@/components/kora/BrandMark";
import { Pill, ScorePill } from "@/components/kora/primitives";
import { ARTICLE_STATUS, formatRelative } from "@/components/kora/labels";
import { useArticles, useSignals } from "@/lib/api/hooks";
import type { Article, Company, NewsletterEdition, Signal } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { ListSkeleton, LoadError, Segmented, SectionTitle } from "@/components/articles/ui";

type Source = "signaux" | "articles";

export interface TopicRef {
  signalId?: string;
  articleId?: string;
}

function AddButton({
  added,
  disabled,
  onClick,
}: {
  added: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return added ? (
    <span className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-kora-green-bg px-2 text-[11.5px] font-semibold text-kora-green">
      <Check className="size-3.5" strokeWidth={2.6} /> Ajouté
    </span>
  ) : (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-kora-teal-light bg-white px-2 text-[11.5px] font-semibold text-kora-teal-dark transition hover:bg-kora-teal-bg disabled:pointer-events-none disabled:opacity-45"
    >
      <Plus className="size-3.5" strokeWidth={2.6} /> Ajouter
    </button>
  );
}

const rowClass = "flex items-center gap-2.5 rounded-xl border border-border bg-white px-2.5 py-2";

/** Panneau « Ajouter des sujets » : signaux triés par score et articles récents. */
export function AddTopicsPanel({
  edition,
  companies,
  onAdd,
  pending,
  disabled,
}: {
  edition: NewsletterEdition;
  companies: Map<string, Company>;
  onAdd: (ref: TopicRef) => void;
  pending: boolean;
  disabled: boolean;
}) {
  const [source, setSource] = useState<Source>("signaux");
  const [q, setQ] = useState("");
  const signals = useSignals({ sort: "score", limit: 60 });
  const articles = useArticles();
  const needle = q.trim().toLowerCase();
  const match = (title: string) => !needle || title.toLowerCase().includes(needle);
  const inSignals = new Set(edition.items.flatMap((i) => (i.signalId ? [i.signalId] : [])));
  const inArticles = new Set(edition.items.flatMap((i) => (i.articleId ? [i.articleId] : [])));
  const signalAdded = (s: Signal) =>
    inSignals.has(s.id) || (!!s.articleId && inArticles.has(s.articleId));
  const articleAdded = (a: Article) =>
    inArticles.has(a.id) || (!!a.signalId && inSignals.has(a.signalId));

  const signalList = (signals.data?.items ?? [])
    .filter((s) => s.status !== "rejete" && match(s.title))
    .sort((a, b) => b.score.total - a.score.total);
  const articleList = [...(articles.data ?? [])]
    .filter((a) => a.status !== "rejete" && match(a.title))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const query = source === "signaux" ? signals : articles;

  return (
    <section className="kora-card flex flex-col p-4">
      <SectionTitle
        icon={Plus}
        action={
          <Segmented<Source>
            value={source}
            onChange={setSource}
            options={[
              { value: "signaux", label: "Signaux", icon: Lightbulb },
              { value: "articles", label: "Articles", icon: FileText },
            ]}
          />
        }
      >
        Ajouter des sujets
      </SectionTitle>
      <label className="relative mb-2.5 block">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={source === "signaux" ? "Filtrer les signaux…" : "Filtrer les articles…"}
          className="h-8 w-full rounded-lg border border-border bg-white pr-3 pl-8 text-[12.5px] text-kora-ink outline-none placeholder:text-muted-foreground/80 focus:border-kora-teal-light focus:ring-2 focus:ring-kora-teal-light/40"
        />
      </label>
      <div className="kora-scrollbar max-h-[440px] overflow-y-auto pr-1">
        {query.isPending ? (
          <ListSkeleton rows={4} />
        ) : query.isError ? (
          <LoadError error={query.error} onRetry={() => void query.refetch()} />
        ) : source === "signaux" ? (
          signalList.length === 0 ? (
            <p className="py-6 text-center text-[12.5px] text-muted-foreground">Aucun signal.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {signalList.map((s) => {
                const company = s.companyId ? companies.get(s.companyId) : undefined;
                const added = signalAdded(s);
                return (
                  <li key={s.id} className={cn(rowClass, added && "bg-muted/40")}>
                    {company ? (
                      <BrandMark name={company.name} brand={company.brand} size="sm" />
                    ) : (
                      <span className="size-8 shrink-0 rounded-lg bg-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-[12.5px] leading-snug font-semibold text-kora-ink">
                        {s.title}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        {company?.name ?? s.primaryOutlet.name}
                        {s.inNewsletter && !added && (
                          <Pill tone="teal" size="sm">
                            Dans l&apos;édition en cours
                          </Pill>
                        )}
                      </p>
                    </div>
                    <ScorePill total={s.score.total} />
                    <AddButton
                      added={added}
                      disabled={disabled || pending}
                      onClick={() => onAdd({ signalId: s.id })}
                    />
                  </li>
                );
              })}
            </ul>
          )
        ) : articleList.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] text-muted-foreground">Aucun article.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {articleList.map((a) => {
              const status = ARTICLE_STATUS[a.status];
              const added = articleAdded(a);
              return (
                <li key={a.id} className={cn(rowClass, added && "bg-muted/40")}>
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-kora-blue-bg text-kora-blue">
                    <FileText className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[12.5px] leading-snug font-semibold text-kora-ink">
                      {a.title}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Modifié {formatRelative(a.updatedAt)}
                    </p>
                  </div>
                  <Pill tone={status.tone} size="sm">
                    {status.label}
                  </Pill>
                  <AddButton
                    added={added}
                    disabled={disabled || pending}
                    onClick={() => onAdd({ articleId: a.id })}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
