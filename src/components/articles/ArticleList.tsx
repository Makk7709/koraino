import { FileText, Search, UserPen } from "lucide-react";
import { useState } from "react";
import { BrandMark } from "@/components/kora/BrandMark";
import { EmptyState, IconTile, Pill, SolidBadge } from "@/components/kora/primitives";
import { ARTICLE_STATUS, formatRelative } from "@/components/kora/labels";
import type { Article, Company } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { ListSkeleton, LoadError } from "./ui";

function originLabel(a: Pick<Article, "origin" | "author">): string {
  return a.origin === "import_humain"
    ? `Import humain · ${a.author ?? "auteur non renseigné"}`
    : "KORA";
}

function ArticleCard({
  article,
  company,
  selected,
  onSelect,
}: {
  article: Article;
  company: Company | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const status = ARTICLE_STATUS[article.status];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "w-full rounded-xl border p-3 text-left transition",
        selected
          ? "border-kora-blue/35 bg-kora-blue-bg/70 shadow-[0_0_0_1px_oklch(0.592_0.157_253.3/12%)]"
          : "border-border bg-white/80 hover:border-kora-teal-light hover:bg-white",
      )}
    >
      <div className="flex items-center gap-2.5">
        {company ? (
          <BrandMark name={company.name} brand={company.brand} domain={company.domain} size="sm" />
        ) : (
          <IconTile icon={article.origin === "import_humain" ? UserPen : FileText} tone="blue" />
        )}
        <p className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-kora-ink">
          {company?.name ?? (article.origin === "import_humain" ? "Article importé" : "Article")}
        </p>
        <Pill tone={status.tone} size="sm">
          {status.label}
        </Pill>
      </div>
      <p className="mt-2 line-clamp-2 text-[13px] leading-snug font-semibold text-kora-ink">
        {article.title || "Sans titre"}
      </p>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
        <span
          className={cn(
            "font-medium",
            article.origin === "import_humain" ? "text-kora-purple" : "text-kora-teal-dark",
          )}
        >
          {originLabel(article)}
        </span>
        <span>·</span>
        <span className="tabular-nums">v{article.currentVersion}</span>
        <span>·</span>
        <span>Modifié {formatRelative(article.updatedAt)}</span>
      </p>
    </button>
  );
}

export function ArticleList({
  query,
  articles,
  companies,
  selectedId,
  onSelect,
  title,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  articles: Article[];
  companies: Map<string, Company>;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  title: string;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const visible = needle
    ? articles.filter((a) =>
        [a.title, a.author ?? "", companies.get(a.companyId ?? "")?.name ?? ""].some((s) =>
          s.toLowerCase().includes(needle),
        ),
      )
    : articles;

  return (
    <section className="kora-card flex flex-col lg:max-h-[calc(100vh-2rem)]">
      <header className="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
        <h2 className="text-[15px] font-bold text-kora-ink">{title}</h2>
        <SolidBadge value={articles.length} tone="teal" />
      </header>
      <div className="px-4 pb-2.5">
        <label className="flex h-8 items-center gap-2 rounded-lg border border-border bg-white px-2.5 text-[12.5px] text-muted-foreground focus-within:border-kora-teal-light">
          <Search className="size-3.5 text-kora-ink-soft" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filtrer par titre, entreprise, auteur…"
            className="min-w-0 flex-1 bg-transparent text-kora-ink outline-none placeholder:text-muted-foreground/80"
          />
        </label>
      </div>
      <div className="kora-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {query.isPending ? (
          <ListSkeleton />
        ) : query.isError ? (
          <LoadError error={query.error} onRetry={() => void query.refetch()} />
        ) : visible.length === 0 ? (
          <EmptyState title="Aucun article">
            {needle ? "Aucun résultat pour ce filtre." : "Aucun article dans cette catégorie."}
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((a) => (
              <li key={a.id}>
                <ArticleCard
                  article={a}
                  company={a.companyId ? companies.get(a.companyId) : undefined}
                  selected={a.id === selectedId}
                  onSelect={() => onSelect(a.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
