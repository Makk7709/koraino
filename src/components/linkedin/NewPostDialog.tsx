import { useQueryClient } from "@tanstack/react-query";
import { Check, Sparkles } from "lucide-react";
import { useState } from "react";
import { BrandMark } from "@/components/kora/BrandMark";
import { EmptyState, GhostButton, Pill, PrimaryButton } from "@/components/kora/primitives";
import { ARTICLE_STATUS, formatRelative } from "@/components/kora/labels";
import { api } from "@/lib/api/client";
import { qk, useArticles, useKoraMutation } from "@/lib/api/hooks";
import type { Article, Company, LinkedInPost } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { LinkedInMark } from "@/components/articles/channel";
import { DialogBody, DialogFooterBar, KoraDialog } from "@/components/articles/KoraDialog";
import { ListSkeleton, LoadError } from "@/components/articles/ui";

const READY = new Set<Article["status"]>(["approuve", "programme", "publie"]);

function NewPostForm({
  posts,
  companies,
  onCreated,
  onCancel,
}: {
  posts: LinkedInPost[];
  companies: Map<string, Company>;
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const articles = useArticles();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const create = useKoraMutation((articleId: string) => api.createLinkedInPost({ articleId }), {
    success: "Post LinkedIn préparé : variantes à relire",
    onSuccess: (p) => {
      qc.setQueryData<LinkedInPost[]>(qk.linkedin, (old) => [
        p,
        ...(old ?? []).filter((x) => x.id !== p.id),
      ]);
      onCreated(p.id);
    },
  });
  const list = [...(articles.data ?? [])]
    .filter((a) => a.status !== "rejete")
    .sort(
      (a, b) =>
        Number(READY.has(b.status)) - Number(READY.has(a.status)) ||
        b.updatedAt.localeCompare(a.updatedAt),
    );

  return (
    <>
      <DialogBody>
        {articles.isPending ? (
          <ListSkeleton rows={4} />
        ) : articles.isError ? (
          <LoadError error={articles.error} onRetry={() => void articles.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState title="Aucun article disponible" />
        ) : (
          <div role="radiogroup" className="flex flex-col gap-1.5">
            {list.map((a) => {
              const existing = posts.find((p) => p.articleId === a.id);
              const company = a.companyId ? companies.get(a.companyId) : undefined;
              const selected = a.id === selectedId;
              const status = ARTICLE_STATUS[a.status];
              return (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!!existing}
                  onClick={() => setSelectedId(a.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-55",
                    selected
                      ? "border-kora-blue/35 bg-kora-blue-bg/70"
                      : "border-border bg-white hover:border-kora-teal-light",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-4 shrink-0 items-center justify-center rounded border",
                      selected ? "border-kora-blue bg-kora-blue text-white" : "border-input",
                    )}
                  >
                    {selected && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  {company ? (
                    <BrandMark name={company.name} brand={company.brand} domain={company.domain} size="sm" />
                  ) : (
                    <span className="size-8 shrink-0 rounded-lg bg-muted" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-[13px] font-semibold text-kora-ink">
                      {a.title}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {company?.name ?? "—"} · modifié {formatRelative(a.updatedAt)}
                    </p>
                  </div>
                  {existing && (
                    <Pill tone="gray" size="sm">
                      Post existant
                    </Pill>
                  )}
                  <Pill tone={status.tone} size="sm">
                    {status.label}
                  </Pill>
                </button>
              );
            })}
          </div>
        )}
      </DialogBody>
      <DialogFooterBar note="WF4 : le post est préparé à partir d'un article approuvé ; il reste à valider avant export.">
        <GhostButton onClick={onCancel}>Annuler</GhostButton>
        <PrimaryButton
          disabled={!selectedId || create.isPending}
          onClick={() => selectedId && create.mutate(selectedId)}
        >
          <Sparkles className="size-4" />
          {create.isPending ? "Préparation…" : "Préparer le post"}
        </PrimaryButton>
      </DialogFooterBar>
    </>
  );
}

export function NewPostDialog({
  open,
  onOpenChange,
  posts,
  companies,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  posts: LinkedInPost[];
  companies: Map<string, Company>;
  onCreated: (id: string) => void;
}) {
  return (
    <KoraDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Préparer un post LinkedIn"
      description="Choisissez l'article source ; KORA propose plusieurs variantes."
      icon={<LinkedInMark className="mt-0.5 size-8 rounded-lg text-[14px]" />}
    >
      <NewPostForm
        posts={posts}
        companies={companies}
        onCancel={() => onOpenChange(false)}
        onCreated={(id) => {
          onOpenChange(false);
          onCreated(id);
        }}
      />
    </KoraDialog>
  );
}
