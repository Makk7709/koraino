import { ArrowRight } from "lucide-react";
import { formatRelative } from "@/components/kora/labels";
import { Pill } from "@/components/kora/primitives";
import { HrefLink } from "@/components/signals/links";
import type { Dashboard } from "@/lib/api/types";
import { BottomCardShell, BottomCardSkeletonBody, WordPressIcon } from "./BottomCardShell";
import { ArchitectureThumb } from "./Thumbs";

export function WordpressDraftCard({
  draft,
  loading,
}: {
  draft: Dashboard["latestWordpressDraft"] | undefined;
  loading: boolean;
}) {
  const href = draft ? `/articles?id=${encodeURIComponent(draft.articleId)}` : "/articles";
  return (
    <BottomCardShell
      icon={<WordPressIcon className="size-[22px] shrink-0" />}
      title="Brouillon WordPress"
      right={
        draft ? (
          <Pill tone={draft.ready ? "green" : "amber"} className="py-0.5 text-[11px]">
            {draft.ready ? "Prêt à publier" : "En préparation"}
          </Pill>
        ) : null
      }
    >
      {draft ? (
        <HrefLink href={href} className="group flex gap-3">
          <ArchitectureThumb className="h-[46px] w-[66px] shrink-0 overflow-hidden rounded-md" />
          <span className="min-w-0">
            <span className="line-clamp-2 text-[12.5px] leading-snug font-bold text-kora-ink group-hover:text-kora-teal-dark">
              {draft.title}
            </span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              Modifié {formatRelative(draft.updatedAt)}
            </span>
          </span>
        </HrefLink>
      ) : loading ? (
        <BottomCardSkeletonBody />
      ) : (
        <p className="text-[12px] text-muted-foreground">Aucun brouillon en cours.</p>
      )}
      <HrefLink
        href={href}
        className="mt-2.5 inline-flex h-7 w-fit items-center gap-1.5 rounded-md border border-border bg-white px-2.5 text-[11.5px] font-medium text-kora-ink transition hover:border-kora-teal-light hover:bg-kora-teal-bg"
      >
        {draft ? "Voir le brouillon" : "Ouvrir les articles"}
        <ArrowRight className="size-3" />
      </HrefLink>
    </BottomCardShell>
  );
}
