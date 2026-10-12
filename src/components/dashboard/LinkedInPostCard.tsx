import { ArrowRight } from "lucide-react";
import { LinkedInIcon } from "@/components/layout/Artwork";
import { LINKEDIN_STATUS, formatRelative } from "@/components/kora/labels";
import { Pill } from "@/components/kora/primitives";
import { HrefLink } from "@/components/signals/links";
import type { Dashboard } from "@/lib/api/types";
import { BottomCardShell, BottomCardSkeletonBody } from "./BottomCardShell";
import { QuantumThumb } from "./Thumbs";

export function LinkedInPostCard({
  post,
  loading,
}: {
  post: Dashboard["latestLinkedInPost"] | undefined;
  loading: boolean;
}) {
  const href = post ? `/linkedin?id=${encodeURIComponent(post.postId)}` : "/linkedin";
  const status = post ? LINKEDIN_STATUS[post.status] : null;
  return (
    <BottomCardShell
      icon={
        <span className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-[5px] bg-kora-linkedin text-white">
          <LinkedInIcon className="size-3.5" />
        </span>
      }
      title="Post LinkedIn à valider"
      right={
        status ? (
          <Pill tone={status.tone} className="py-0.5 text-[11px]">
            {status.label}
          </Pill>
        ) : null
      }
    >
      {post ? (
        <HrefLink href={href} className="group flex gap-3">
          <QuantumThumb className="h-[46px] w-[66px] shrink-0 overflow-hidden rounded-md" />
          <span className="min-w-0">
            <span className="line-clamp-2 text-[12px] leading-snug text-kora-ink-soft group-hover:text-kora-ink">
              <LinkedInExcerpt text={post.excerpt} />
            </span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              Modifié {formatRelative(post.updatedAt)}
            </span>
          </span>
        </HrefLink>
      ) : loading ? (
        <BottomCardSkeletonBody />
      ) : (
        <p className="text-[12px] text-muted-foreground">Aucun post en attente de validation.</p>
      )}
      <HrefLink
        href={href}
        className="mt-2.5 inline-flex h-7 w-fit items-center gap-1.5 rounded-md border border-border bg-white px-2.5 text-[11.5px] font-medium text-kora-ink transition hover:border-kora-teal-light hover:bg-kora-teal-bg"
      >
        {post ? "Relire le post" : "Ouvrir LinkedIn"}
        <ArrowRight className="size-3" />
      </HrefLink>
    </BottomCardShell>
  );
}

/** Met en gras l'accroche (jusqu'au premier « ! » ou « : »), comme sur la maquette. */
function LinkedInExcerpt({ text }: { text: string }) {
  const m = /^(.{4,60}?[!:])(\s.*)$/s.exec(text);
  if (!m) return <>{text}</>;
  return (
    <>
      <span className="font-bold text-kora-ink">{m[1]}</span>
      {m[2]}
    </>
  );
}
