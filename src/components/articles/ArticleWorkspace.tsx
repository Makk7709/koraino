import { Eye } from "lucide-react";
import { useState } from "react";
import { UnderlineTabs } from "@/components/kora/primitives";
import { useArticle } from "@/lib/api/hooks";
import type { ArticleDetail, Company } from "@/lib/api/types";
import { ApprovalPanel } from "./ApprovalPanel";
import { ApproveDialog, RejectDialog } from "./ArticleDialogs";
import { ArticleEditor } from "./ArticleEditor";
import { ArticleHeader } from "./ArticleHeader";
import { useArticleDraft } from "./draft";
import { EvidencePack } from "./EvidencePack";
import { Banner, DetailSkeleton, LoadError } from "./ui";
import { VersionsPanel } from "./VersionsPanel";
import { useArticleWorkflow } from "./workflow";

type Section = "redaction" | "dossier" | "versions" | "diffusion";

function LoadedWorkspace({
  article,
  company,
}: {
  article: ArticleDetail;
  company: Company | undefined;
}) {
  const [section, setSection] = useState<Section>("redaction");
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const draft = useArticleDraft(article);
  const workflow = useArticleWorkflow(article, draft.dirty);
  const validApprovals = article.approvals.filter((a) => a.valid).length;

  return (
    <div className="flex flex-col gap-4">
      <ArticleHeader
        article={article}
        company={company}
        workflow={workflow}
        onApprove={() => setApproveOpen(true)}
        onReject={() => setRejectOpen(true)}
        onShowDiffusion={() => setSection("diffusion")}
      />

      {workflow.perms.readOnly && (
        <Banner tone="info" icon={Eye} title="Profil lecteur : consultation seule">
          Les actions d&apos;écriture, d&apos;approbation et de diffusion sont désactivées.
        </Banner>
      )}

      <section className="kora-card px-4 pt-3 pb-4">
        <UnderlineTabs<Section>
          value={section}
          onChange={setSection}
          tabs={[
            { value: "redaction", label: draft.dirty ? "Rédaction •" : "Rédaction" },
            { value: "dossier", label: "Dossier factuel", count: article.factChecks.length },
            { value: "versions", label: "Versions", count: article.versions.length },
            { value: "diffusion", label: "Approbation & diffusion", count: validApprovals },
          ]}
        />
        <div className="pt-4">
          {section === "redaction" && (
            <ArticleEditor article={article} state={draft} canWrite={workflow.perms.canWrite} />
          )}
          {section === "dossier" && <EvidencePack article={article} body={draft.draft.body} />}
          {section === "versions" && (
            <VersionsPanel
              article={article}
              canWrite={workflow.perms.canWrite}
              dirty={draft.dirty}
            />
          )}
          {section === "diffusion" && (
            <ApprovalPanel
              article={article}
              workflow={workflow}
              onApprove={() => setApproveOpen(true)}
              onReject={() => setRejectOpen(true)}
              onShowDossier={() => setSection("dossier")}
            />
          )}
        </div>
      </section>

      <ApproveDialog article={article} open={approveOpen} onOpenChange={setApproveOpen} />
      <RejectDialog article={article} open={rejectOpen} onOpenChange={setRejectOpen} />
    </div>
  );
}

/** Zone principale : article sélectionné (éditeur, dossier, versions, diffusion). */
export function ArticleWorkspace({
  articleId,
  companies,
}: {
  articleId: string;
  companies: Map<string, Company>;
}) {
  const article = useArticle(articleId);
  if (article.isPending) return <DetailSkeleton />;
  if (article.isError)
    return (
      <LoadError
        title="Article introuvable ou indisponible"
        error={article.error}
        onRetry={() => void article.refetch()}
      />
    );
  const a = article.data;
  return (
    <LoadedWorkspace article={a} company={a.companyId ? companies.get(a.companyId) : undefined} />
  );
}
