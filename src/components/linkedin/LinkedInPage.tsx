import { useState } from "react";
import { EmptyState, PageTitle, PrimaryButton, UnderlineTabs } from "@/components/kora/primitives";
import { useLinkedInPosts } from "@/lib/api/hooks";
import { LinkedInMark } from "@/components/articles/channel";
import { useCompanyMap, usePermissions } from "@/components/articles/hooks";
import { DetailSkeleton } from "@/components/articles/ui";
import { ConnectionCard } from "./ConnectionCard";
import { NewPostDialog } from "./NewPostDialog";
import { PostDetail } from "./PostDetail";
import { PostList } from "./PostList";
import {
  LINKEDIN_TAB_LABEL,
  LINKEDIN_TABS,
  matchesLinkedInTab,
  type LinkedInSearch,
  type LinkedInTab,
} from "./search";

export function LinkedInPage({
  search,
  onSearch,
}: {
  search: LinkedInSearch;
  onSearch: (patch: LinkedInSearch) => void;
}) {
  const tab: LinkedInTab = search.tab ?? (search.id ? "tous" : "a_valider");
  const postsQuery = useLinkedInPosts();
  const companies = useCompanyMap();
  const { canWrite } = usePermissions();
  const [newOpen, setNewOpen] = useState(false);

  const all = [...(postsQuery.data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const filtered = all.filter((p) => matchesLinkedInTab(p, tab));
  const selectedId = search.id ?? filtered[0]?.id;
  const selected = all.find((p) => p.id === selectedId);

  return (
    <div>
      <PageTitle
        title="LinkedIn"
        subtitle="Posts et variantes préparés à partir d'articles approuvés"
        actions={
          <PrimaryButton disabled={!canWrite} onClick={() => setNewOpen(true)}>
            <LinkedInMark className="size-[18px] bg-white text-[10px] text-kora-linkedin" />
            Préparer un post
          </PrimaryButton>
        }
      />

      <ConnectionCard />

      <UnderlineTabs<LinkedInTab>
        value={tab}
        onChange={(t) => onSearch({ tab: t, id: undefined })}
        tabs={LINKEDIN_TABS.map((t) => ({
          value: t,
          label: LINKEDIN_TAB_LABEL[t],
          count: all.filter((p) => matchesLinkedInTab(p, t)).length,
        }))}
      />

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[330px_minmax(0,1fr)] 2xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-4">
          <PostList
            title={tab === "tous" ? "Posts" : LINKEDIN_TAB_LABEL[tab]}
            query={postsQuery}
            posts={filtered}
            companies={companies}
            selectedId={selectedId}
            onSelect={(id) => onSearch({ id })}
          />
        </aside>
        <div className="min-w-0">
          {selected ? (
            <PostDetail
              key={selected.id}
              post={selected}
              company={selected.companyId ? companies.get(selected.companyId) : undefined}
            />
          ) : postsQuery.isPending ? (
            <DetailSkeleton />
          ) : search.id && !postsQuery.isError ? (
            <EmptyState title="Post introuvable">
              Ce post n&apos;existe plus ou n&apos;est pas accessible.
            </EmptyState>
          ) : (
            <EmptyState title="Aucun post sélectionné">
              Préparez un post depuis un article approuvé.
            </EmptyState>
          )}
        </div>
      </div>

      <NewPostDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        posts={all}
        companies={companies}
        onCreated={(id) => onSearch({ id, tab: "tous" })}
      />
    </div>
  );
}
