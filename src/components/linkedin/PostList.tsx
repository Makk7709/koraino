import { BrandMark } from "@/components/kora/BrandMark";
import { EmptyState, Pill, SolidBadge } from "@/components/kora/primitives";
import { LINKEDIN_STATUS, formatRelative } from "@/components/kora/labels";
import { LandscapeThumb } from "@/components/layout/Artwork";
import type { Company, LinkedInPost } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { LinkedInMark } from "@/components/articles/channel";
import { ListSkeleton, LoadError } from "@/components/articles/ui";
import { postExcerpt } from "./text";

/** Carte de post, calquée sur la carte « Post LinkedIn à valider » de la maquette. */
function PostCard({
  post,
  company,
  selected,
  onSelect,
}: {
  post: LinkedInPost;
  company: Company | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const status = LINKEDIN_STATUS[post.status];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "w-full rounded-xl border p-3 text-left transition",
        selected
          ? "border-kora-blue/35 bg-kora-blue-bg/70"
          : "border-border bg-white/80 hover:border-kora-teal-light hover:bg-white",
      )}
    >
      <div className="flex items-center gap-2.5">
        <LinkedInMark />
        <p className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-kora-ink">
          {post.title}
        </p>
        <Pill tone={status.tone} size="sm">
          {status.label}
        </Pill>
      </div>
      <div className="mt-2 flex gap-2.5">
        {company ? (
          <BrandMark name={company.name} brand={company.brand} size="md" />
        ) : (
          <span className="size-10 shrink-0 overflow-hidden rounded-lg">
            <LandscapeThumb className="block size-full" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[12.5px] leading-snug text-kora-ink-soft">
            {postExcerpt(post)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Modifié {formatRelative(post.updatedAt)} · v{post.version}
          </p>
        </div>
      </div>
    </button>
  );
}

export function PostList({
  query,
  posts,
  companies,
  selectedId,
  onSelect,
  title,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  posts: LinkedInPost[];
  companies: Map<string, Company>;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  title: string;
}) {
  return (
    <section className="kora-card flex flex-col lg:max-h-[calc(100vh-2rem)]">
      <header className="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
        <h2 className="text-[15px] font-bold text-kora-ink">{title}</h2>
        <SolidBadge value={posts.length} tone="blue" />
      </header>
      <div className="kora-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {query.isPending ? (
          <ListSkeleton />
        ) : query.isError ? (
          <LoadError error={query.error} onRetry={() => void query.refetch()} />
        ) : posts.length === 0 ? (
          <EmptyState title="Aucun post">
            Générez un post depuis un article approuvé (page Articles).
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {posts.map((p) => (
              <li key={p.id}>
                <PostCard
                  post={p}
                  company={p.companyId ? companies.get(p.companyId) : undefined}
                  selected={p.id === selectedId}
                  onSelect={() => onSelect(p.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
