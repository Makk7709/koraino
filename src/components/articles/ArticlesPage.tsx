import { FileUp, Sparkles } from "lucide-react";
import { useState } from "react";
import {
  EmptyState,
  GhostButton,
  PageTitle,
  PrimaryButton,
  UnderlineTabs,
} from "@/components/kora/primitives";
import { useArticles, useImports } from "@/lib/api/hooks";
import { ArticleList } from "./ArticleList";
import { ArticleWorkspace } from "./ArticleWorkspace";
import { useCompanyMap, usePermissions } from "./hooks";
import { ImportList } from "./imports/ImportList";
import { ImportWorkspace } from "./imports/ImportWorkspace";
import { NewArticleDialog } from "./NewArticleDialog";
import {
  ARTICLE_TAB_LABEL,
  ARTICLE_TABS,
  matchesTab,
  type ArticlesSearch,
  type ArticlesTab,
} from "./search";
import { DetailSkeleton } from "./ui";

export function ArticlesPage({
  search,
  onSearch,
}: {
  search: ArticlesSearch;
  onSearch: (patch: ArticlesSearch) => void;
}) {
  const tab: ArticlesTab = search.tab ?? "tous";
  const articles = useArticles();
  const imports = useImports();
  const companies = useCompanyMap();
  const { canWrite } = usePermissions();
  const [newOpen, setNewOpen] = useState(false);

  const all = [...(articles.data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const filtered = all.filter((a) => matchesTab(a, tab));
  const selectedId = search.id ?? filtered[0]?.id;
  const openArticle = (id: string) => onSearch({ tab: "tous", id, importId: undefined });

  const tabs = ARTICLE_TABS.map((t) => ({
    value: t,
    label: ARTICLE_TAB_LABEL[t],
    count:
      t === "imports" ? (imports.data?.length ?? 0) : all.filter((a) => matchesTab(a, t)).length,
  }));

  return (
    <div>
      <PageTitle
        title="Articles"
        subtitle="Editorial Studio : dossiers factuels, brouillons et approbations"
        actions={
          <>
            <PrimaryButton disabled={!canWrite} onClick={() => setNewOpen(true)}>
              <Sparkles className="size-4" /> Nouvel article depuis un signal
            </PrimaryButton>
            <GhostButton
              disabled={!canWrite}
              onClick={() => onSearch({ tab: "imports", importId: undefined })}
            >
              <FileUp className="size-4" /> Importer un article humain
            </GhostButton>
          </>
        }
      />

      <UnderlineTabs<ArticlesTab>
        value={tab}
        onChange={(t) => onSearch({ tab: t, id: undefined, importId: undefined })}
        tabs={tabs}
      />

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[330px_minmax(0,1fr)] 2xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-4">
          {tab === "imports" ? (
            <ImportList
              selectedId={search.importId}
              onSelect={(id) => onSearch({ importId: id })}
              onNew={() => onSearch({ importId: undefined })}
            />
          ) : (
            <ArticleList
              title={ARTICLE_TAB_LABEL[tab] === "Tous" ? "Articles" : ARTICLE_TAB_LABEL[tab]}
              query={articles}
              articles={filtered}
              companies={companies}
              selectedId={selectedId}
              onSelect={(id) => onSearch({ id })}
            />
          )}
        </aside>

        <div className="min-w-0">
          {tab === "imports" ? (
            <ImportWorkspace
              importId={search.importId}
              onSelectImport={(id) => onSearch({ importId: id })}
              onOpenArticle={openArticle}
            />
          ) : selectedId ? (
            <ArticleWorkspace key={selectedId} articleId={selectedId} companies={companies} />
          ) : articles.isPending ? (
            <DetailSkeleton />
          ) : (
            <EmptyState title="Aucun article sélectionné">
              Créez un article depuis un signal prioritaire ou importez un article rédigé par
              l&apos;équipe.
            </EmptyState>
          )}
        </div>
      </div>

      <NewArticleDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        companies={companies}
        onCreated={openArticle}
      />
    </div>
  );
}
