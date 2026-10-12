import { ArrowRight, Eye, FileText, Mail } from "lucide-react";
import type { ReactNode } from "react";
import { LinkedInIcon } from "@/components/layout/Artwork";
import { UserAvatar } from "@/components/layout/AppHeader";
import {
  ARTICLE_STATUS,
  LINKEDIN_STATUS,
  NEWSLETTER_STATUS,
  ROLE,
  formatRelative,
  type Tone,
} from "@/components/kora/labels";
import { EmptyState, KoraCard, Pill } from "@/components/kora/primitives";
import { HrefLink } from "@/components/signals/links";
import { Skeleton } from "@/components/ui/skeleton";
import { useArticles, useLinkedInPosts, useMe, useNewsletters } from "@/lib/api/hooks";
import type { Role } from "@/lib/api/types";

interface WorkItem {
  key: string;
  icon: ReactNode;
  title: string;
  meta: string;
  status: { label: string; tone: Tone };
  href: string;
}

const ROLE_TONE: Record<Role, Tone> = {
  admin: "purple",
  redacteur: "teal",
  validateur: "blue",
  lecteur: "gray",
};

const ICON = {
  article: <FileText className="size-4 text-kora-blue" />,
  linkedin: (
    <span className="inline-flex size-4 items-center justify-center rounded-[3px] bg-kora-linkedin text-white">
      <LinkedInIcon className="size-2.5" />
    </span>
  ),
  newsletter: <Mail className="size-4 text-kora-teal" />,
};

/** Onglet « Mon espace » : brouillons et validations en attente selon mes rôles. */
export function MySpaceView() {
  const me = useMe();
  const articles = useArticles();
  const posts = useLinkedInPosts();
  const editions = useNewsletters();
  const user = me.data;
  const roles = user?.roles ?? [];
  const canWrite = roles.some((r) => r === "admin" || r === "redacteur");
  const canValidate = roles.some((r) => r === "admin" || r === "validateur");
  const loading = me.isPending || articles.isPending || posts.isPending || editions.isPending;

  const drafts: WorkItem[] = [
    ...(articles.data ?? [])
      .filter((a) => a.status === "brouillon" && (a.author === null || a.author === user?.name))
      .map((a) => ({
        key: `a-${a.id}`,
        icon: ICON.article,
        title: a.title,
        meta: `Article · v${a.currentVersion} · modifié ${formatRelative(a.updatedAt)}`,
        status: ARTICLE_STATUS[a.status],
        href: `/articles?id=${encodeURIComponent(a.id)}`,
      })),
    ...(posts.data ?? [])
      .filter((p) => p.status === "brouillon")
      .map((p) => ({
        key: `l-${p.id}`,
        icon: ICON.linkedin,
        title: p.title,
        meta: `Post LinkedIn · v${p.version} · modifié ${formatRelative(p.updatedAt)}`,
        status: LINKEDIN_STATUS[p.status],
        href: `/linkedin?id=${encodeURIComponent(p.id)}`,
      })),
  ];

  const toValidate: WorkItem[] = [
    ...(articles.data ?? [])
      .filter((a) => a.status === "en_revue")
      .map((a) => ({
        key: `a-${a.id}`,
        icon: ICON.article,
        title: a.title,
        meta: `Article · version ${a.currentVersion} soumise ${formatRelative(a.updatedAt)}`,
        status: ARTICLE_STATUS[a.status],
        href: `/articles?id=${encodeURIComponent(a.id)}`,
      })),
    ...(posts.data ?? [])
      .filter((p) => p.status === "a_valider")
      .map((p) => ({
        key: `l-${p.id}`,
        icon: ICON.linkedin,
        title: p.title,
        meta: `Post LinkedIn · version ${p.version} · ${formatRelative(p.updatedAt)}`,
        status: LINKEDIN_STATUS[p.status],
        href: `/linkedin?id=${encodeURIComponent(p.id)}`,
      })),
    ...(editions.data ?? [])
      .filter((n) => n.status === "composition" && n.items.length > 0)
      .map((n) => ({
        key: `n-${n.id}`,
        icon: ICON.newsletter,
        title: n.title,
        meta: `Newsletter · ${n.items.length} sujet${n.items.length > 1 ? "s" : ""} · version ${n.version}`,
        status: NEWSLETTER_STATUS[n.status],
        href: "/newsletter",
      })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <section className="kora-card flex flex-wrap items-center gap-4 px-4 py-3.5">
        {user ? (
          <UserAvatar user={user} className="size-12 text-sm" />
        ) : (
          <Skeleton className="size-12 rounded-full" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-bold text-kora-ink">{user?.name ?? "…"}</p>
          <p className="text-[12.5px] text-kora-ink-soft">{user?.team ?? ""}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {roles.map((r) => (
            <Pill key={r} tone={ROLE_TONE[r]}>
              {ROLE[r]}
            </Pill>
          ))}
        </div>
      </section>

      {user && !canWrite && !canValidate ? (
        <KoraCard>
          <div className="flex items-start gap-3">
            <Eye className="mt-0.5 size-5 text-kora-ink-soft" />
            <div>
              <p className="text-[14px] font-bold text-kora-ink">
                Profil lecteur : consultation seule
              </p>
              <p className="mt-1 text-[12.5px] text-kora-ink-soft">
                Vous pouvez consulter les signaux, articles, posts et éditions. La rédaction, la
                validation et les envois sont réservés aux rédacteurs, validateurs et
                administrateurs.
              </p>
            </div>
          </div>
        </KoraCard>
      ) : (
        <div className="grid gap-4 @min-[900px]:grid-cols-2">
          {(canWrite || loading) && (
            <WorkList
              title="Mes brouillons"
              items={drafts}
              loading={loading}
              empty="Aucun brouillon en cours."
            />
          )}
          {(canValidate || loading) && (
            <WorkList
              title="Validations en attente"
              items={toValidate}
              loading={loading}
              empty="Rien à valider pour le moment."
            />
          )}
        </div>
      )}
    </div>
  );
}

function WorkList({
  title,
  items,
  loading,
  empty,
}: {
  title: string;
  items: WorkItem[];
  loading: boolean;
  empty: string;
}) {
  return (
    <KoraCard
      title={title}
      badge={
        !loading ? (
          <span className="rounded-full bg-kora-teal-bg px-2 py-0.5 text-[11px] font-semibold text-kora-teal-dark tabular-nums">
            {items.length}
          </span>
        ) : null
      }
    >
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it.key}>
              <HrefLink
                href={it.href}
                className="group flex items-center gap-3 rounded-xl border border-border bg-white px-3 py-2.5 transition hover:border-kora-teal-light"
              >
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                  {it.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-kora-ink">
                    {it.title}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">
                    {it.meta}
                  </span>
                </span>
                <Pill tone={it.status.tone} className="py-0.5 text-[11px]">
                  {it.status.label}
                </Pill>
                <ArrowRight className="size-3.5 text-muted-foreground group-hover:text-kora-ink" />
              </HrefLink>
            </li>
          ))}
        </ul>
      )}
    </KoraCard>
  );
}
