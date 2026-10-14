import { useNavigate } from "@tanstack/react-router";
import {
  Ban,
  CalendarDays,
  Check,
  Clock,
  ExternalLink,
  FileText,
  Mail,
  Send,
  ShieldCheck,
  UserPen,
} from "lucide-react";
import { BrandMark } from "@/components/kora/BrandMark";
import { GhostButton, IconTile, Pill, PrimaryButton } from "@/components/kora/primitives";
import {
  ARTICLE_STATUS,
  WORDPRESS_STATUS,
  formatDate,
  formatRelative,
} from "@/components/kora/labels";
import type { ArticleDetail, Company } from "@/lib/api/types";
import { LinkedInMark } from "./channel";
import {
  useAddToNewsletter,
  useComposingEdition,
  useGenerateLinkedInPost,
  useLinkedInPostFor,
} from "./hooks";
import { currentVersionOf } from "./draft";
import { HrefLink, Meta, MetaRow, ScoreBox } from "./ui";
import type { ArticleWorkflow } from "./workflow";

function VersionBox({ n }: { n: number }) {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center rounded-xl border border-kora-teal/20 bg-kora-teal-bg px-4 py-2">
      <p className="leading-none font-bold text-kora-teal tabular-nums">
        <span className="text-[15px]">v</span>
        <span className="text-[26px]">{n}</span>
      </p>
      <p className="mt-1 text-[11px] text-kora-ink-soft">Version courante</p>
    </div>
  );
}

/** En-tête de l'article, calqué sur le panneau détail du signal de la maquette. */
export function ArticleHeader({
  article,
  company,
  workflow,
  onApprove,
  onReject,
  onShowDiffusion,
}: {
  article: ArticleDetail;
  company: Company | undefined;
  workflow: ArticleWorkflow;
  onApprove: () => void;
  onReject: () => void;
  onShowDiffusion: () => void;
}) {
  const navigate = useNavigate();
  const status = ARTICLE_STATUS[article.status];
  const wpStatus =
    article.wordpress.status !== "aucun" ? WORDPRESS_STATUS[article.wordpress.status] : null;
  const version = currentVersionOf(article);
  const edition = useComposingEdition();
  const inEdition = !!edition?.items.some((i) => i.articleId === article.id);
  const addToNewsletter = useAddToNewsletter();
  const existingPost = useLinkedInPostFor(article.id);
  const generatePost = useGenerateLinkedInPost();
  const { perms } = workflow;
  const isImport = article.origin === "import_humain";

  const primary = (() => {
    const s = article.status;
    if (s === "brouillon" || s === "rejete")
      return (
        <PrimaryButton
          className="flex-1"
          disabled={!workflow.canSubmit || workflow.submit.isPending}
          title={workflow.submitHint ?? undefined}
          onClick={() => workflow.submit.mutate(undefined)}
        >
          <Send className="size-4" /> Soumettre en revue
        </PrimaryButton>
      );
    if (s === "en_revue")
      return (
        <PrimaryButton
          className="flex-1"
          disabled={!workflow.canApprove}
          title={workflow.approveHint ?? undefined}
          onClick={onApprove}
        >
          <ShieldCheck className="size-4" /> Approuver la version {article.currentVersion}
        </PrimaryButton>
      );
    return (
      <PrimaryButton className="flex-1" onClick={onShowDiffusion}>
        <Send className="size-4" /> {s === "publie" ? "Voir la diffusion" : "Diffuser"}
      </PrimaryButton>
    );
  })();

  return (
    <section className="kora-card p-4">
      <div className="flex items-start gap-3.5">
        {company ? (
          <BrandMark name={company.name} brand={company.brand} size="lg" />
        ) : (
          <IconTile
            icon={isImport ? UserPen : FileText}
            tone={isImport ? "purple" : "blue"}
            className="size-14 rounded-xl [&>svg]:size-6"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-bold text-kora-ink">
            {company?.name ?? (isImport ? "Article importé" : "Article KORA")}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Pill tone={status.tone}>{status.label}</Pill>
            {wpStatus && <Pill tone={wpStatus.tone}>{wpStatus.label}</Pill>}
            <Pill tone={isImport ? "purple" : "teal"}>{isImport ? "Import humain" : "KORA"}</Pill>
            {(version?.categories ?? []).slice(0, 3).map((c) => (
              <Pill key={c} tone="blue">
                {c}
              </Pill>
            ))}
          </div>
        </div>
        {article.signal ? (
          <ScoreBox total={article.signal.score.total} />
        ) : (
          <VersionBox n={article.currentVersion} />
        )}
      </div>

      <h2 className="mt-3 text-[18px] leading-snug font-bold text-kora-ink">
        {article.title || "Sans titre"}
      </h2>

      <MetaRow className="mt-2">
        <Meta icon={CalendarDays}>Créé le {formatDate(article.createdAt)}</Meta>
        <Meta icon={Clock}>Modifié {formatRelative(article.updatedAt)}</Meta>
        <Meta icon={UserPen}>
          {isImport ? (
            <>
              Auteur : <span className="font-semibold text-kora-ink">{article.author ?? "—"}</span>
              <span className="text-muted-foreground"> (conservé)</span>
            </>
          ) : (
            <>
              Brouillon KORA
              {version ? (
                <>
                  {" "}
                  · v{version.n} par{" "}
                  <span className="font-medium text-kora-ink">{version.createdBy}</span>
                </>
              ) : null}
            </>
          )}
        </Meta>
        {article.signal && (
          <span className="inline-flex items-center gap-1.5">
            <BrandMark
              name={article.signal.primaryOutlet.name}
              brand={article.signal.primaryOutlet.brand}
              size="xs"
            />
            {article.signal.primaryOutlet.name}
          </span>
        )}
        {article.signal && (
          <HrefLink href={`/signaux?id=${encodeURIComponent(article.signal.id)}`}>
            <ExternalLink className="size-3.5" /> Voir le signal
          </HrefLink>
        )}
      </MetaRow>

      {article.excerpt && (
        <p className="mt-2.5 line-clamp-2 text-[13px] leading-relaxed text-kora-ink-soft">
          {article.excerpt}
        </p>
      )}

      <div className="mt-3.5 flex flex-wrap gap-2">
        {primary}
        <GhostButton
          className="flex-1"
          disabled={inEdition || !perms.canWrite || addToNewsletter.isPending}
          title={inEdition && edition ? `Déjà dans « ${edition.title} »` : undefined}
          onClick={() => addToNewsletter.mutate({ articleId: article.id })}
        >
          {inEdition ? (
            <>
              <Check className="size-4 text-kora-green" /> Dans la newsletter
            </>
          ) : (
            <>
              <Mail className="size-4" /> Ajouter à la newsletter
            </>
          )}
        </GhostButton>
        <GhostButton
          className="flex-1"
          disabled={!existingPost && (!perms.canWrite || generatePost.isPending)}
          onClick={() =>
            existingPost
              ? void navigate({ to: "/linkedin", search: { id: existingPost.id } })
              : generatePost.mutate(article.id)
          }
        >
          <LinkedInMark className="size-[18px] text-[10px]" />
          {existingPost ? "Voir le post LinkedIn" : "Générer le post LinkedIn"}
        </GhostButton>
        <GhostButton
          className="flex-1"
          disabled={!workflow.canReject}
          title={workflow.rejectHint ?? undefined}
          onClick={onReject}
        >
          <Ban className="size-4" /> Rejeter
        </GhostButton>
      </div>
    </section>
  );
}
