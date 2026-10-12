import {
  ArrowRight,
  Check,
  FilePlus2,
  FileText,
  Lightbulb,
  Plus,
  ShieldCheck,
  Undo2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  GhostButton,
  IconTile,
  Pill,
  PrimaryButton,
  UnderlineTabs,
} from "@/components/kora/primitives";
import { formatDateTime } from "@/components/kora/labels";
import { api } from "@/lib/api/client";
import { qk, useKoraMutation } from "@/lib/api/hooks";
import type { HumanImport, ImportProposal } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { DiffLegend, DiffParts } from "../DiffText";
import { diffWords } from "../diff";
import { formatBytes } from "../format";
import { Banner, Segmented } from "../ui";
import { useSetArticle } from "../workflow";
import { useUpsertImport } from "./cache";
import { fileKind, PROPOSAL_DECISION, PROPOSAL_KIND } from "./labels";

type Tab = "propositions" | "extrait" | "original";

function ProposalCard({
  proposal,
  locked,
  pending,
  onDecide,
}: {
  proposal: ImportProposal;
  locked: boolean;
  pending: boolean;
  onDecide: (d: ImportProposal["decision"]) => void;
}) {
  const kind = PROPOSAL_KIND[proposal.kind];
  const decision = PROPOSAL_DECISION[proposal.decision];
  const parts = useMemo(
    () => diffWords(proposal.before, proposal.after),
    [proposal.before, proposal.after],
  );
  return (
    <li
      className={cn(
        "rounded-xl border bg-white p-3.5 transition",
        proposal.decision === "acceptee" && "border-kora-green/25",
        proposal.decision === "refusee" && "border-border opacity-80",
        proposal.decision === "en_attente" && "border-kora-amber/30",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={kind.tone} size="sm" className="font-semibold">
          {kind.label}
        </Pill>
        <Pill tone={decision.tone} size="sm">
          {decision.label}
        </Pill>
        <span className="ml-auto">
          <DiffLegend parts={parts} />
        </span>
      </div>
      <div className="mt-2.5 rounded-lg border border-border/80 bg-muted/40 px-3 py-2.5">
        <DiffParts parts={parts} />
      </div>
      <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-snug text-kora-ink-soft">
        <Lightbulb className="mt-px size-3.5 shrink-0 text-kora-blue" />
        <span>
          <span className="font-semibold text-kora-ink">Justification : </span>
          {proposal.rationale}
        </span>
      </p>
      {!locked && (
        <div className="mt-3 flex flex-wrap gap-2">
          <GhostButton
            className={cn(
              "h-8 text-xs",
              proposal.decision === "acceptee" &&
                "border-kora-green/40 bg-kora-green-bg text-kora-green hover:bg-kora-green-bg",
            )}
            disabled={pending || proposal.decision === "acceptee"}
            onClick={() => onDecide("acceptee")}
          >
            <Check className="size-3.5" strokeWidth={2.6} /> Accepter
          </GhostButton>
          <GhostButton
            className={cn(
              "h-8 text-xs",
              proposal.decision === "refusee" &&
                "border-kora-rose/30 bg-kora-rose-bg text-kora-rose hover:bg-kora-rose-bg",
            )}
            disabled={pending || proposal.decision === "refusee"}
            onClick={() => onDecide("refusee")}
          >
            <X className="size-3.5" strokeWidth={2.6} /> Refuser
          </GhostButton>
          {proposal.decision !== "en_attente" && (
            <button
              type="button"
              disabled={pending}
              onClick={() => onDecide("en_attente")}
              className="inline-flex items-center gap-1 px-1 text-[11.5px] font-medium text-kora-ink-soft hover:text-kora-ink disabled:opacity-50"
            >
              <Undo2 className="size-3.5" /> Remettre en attente
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function TextPanel({ text }: { text: string }) {
  return (
    <div className="kora-scrollbar max-h-[560px] overflow-y-auto rounded-xl border border-border bg-white px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap text-kora-ink-soft">
      {text || <span className="text-muted-foreground">Texte vide.</span>}
    </div>
  );
}

/** Vue d'un import : original, texte extrait et propositions à valider une à une. */
export function ImportView({
  imp,
  canWrite,
  onNew,
  onOpenArticle,
}: {
  imp: HumanImport;
  canWrite: boolean;
  onNew: () => void;
  onOpenArticle: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("propositions");
  const [extractView, setExtractView] = useState<"texte" | "diff">("texte");
  const upsert = useUpsertImport();
  const decide = useKoraMutation(
    (v: { proposalId: string; decision: ImportProposal["decision"] }) =>
      api.decideImportProposal(imp.id, v.proposalId, v.decision),
    { invalidate: qk.imports, onSuccess: upsert },
  );
  const setArticle = useSetArticle();
  const convert = useKoraMutation(() => api.convertImport(imp.id), {
    success: (a) => `Article créé — auteur « ${a.author ?? imp.author} » conservé`,
    onSuccess: (a) => {
      setArticle(a);
      onOpenArticle(a.id);
    },
  });
  const extractDiff = useMemo(
    () => diffWords(imp.originalText, imp.extractedText),
    [imp.originalText, imp.extractedText],
  );
  const counts = {
    acceptee: imp.proposals.filter((p) => p.decision === "acceptee").length,
    refusee: imp.proposals.filter((p) => p.decision === "refusee").length,
    en_attente: imp.proposals.filter((p) => p.decision === "en_attente").length,
  };
  const converted = imp.articleId !== null;
  const locked = converted || !canWrite;

  return (
    <div className="flex flex-col gap-4">
      <section className="kora-card p-4">
        <div className="flex flex-wrap items-start gap-3.5">
          <IconTile icon={FileText} tone="blue" className="size-12 rounded-xl [&>svg]:size-6" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-bold text-kora-ink">{imp.filename}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Pill tone="blue">{fileKind(imp.filename)}</Pill>
              <Pill tone="gray">{formatBytes(imp.sizeBytes)}</Pill>
              <Pill tone="purple">Auteur : {imp.author}</Pill>
              {converted && <Pill tone="green">Article créé</Pill>}
            </div>
            <p className="mt-1.5 text-[12px] text-kora-ink-soft">
              Importé par {imp.createdBy} le {formatDateTime(imp.createdAt)} · l&apos;auteur nommé
              ne sera jamais remplacé.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <GhostButton onClick={onNew}>
              <Plus className="size-4" /> Nouvel import
            </GhostButton>
            {converted ? (
              <PrimaryButton onClick={() => imp.articleId && onOpenArticle(imp.articleId)}>
                Ouvrir l&apos;article <ArrowRight className="size-4" />
              </PrimaryButton>
            ) : (
              <PrimaryButton
                disabled={!canWrite || convert.isPending}
                onClick={() => convert.mutate(undefined)}
              >
                <FilePlus2 className="size-4" />
                {convert.isPending ? "Création…" : "Créer l'article"}
              </PrimaryButton>
            )}
          </div>
        </div>

        <Banner
          tone="info"
          icon={ShieldCheck}
          className="mt-3.5"
          title="Aucune substitution silencieuse"
        >
          Seules les propositions acceptées seront appliquées au texte extrait ; les propositions
          refusées ou en attente sont ignorées.
          {!converted && counts.en_attente > 0 && (
            <span className="font-semibold text-kora-ink">
              {" "}
              {counts.en_attente} proposition{counts.en_attente > 1 ? "s" : ""} encore en attente.
            </span>
          )}
        </Banner>
      </section>

      <section className="kora-card px-4 pt-3 pb-4">
        <UnderlineTabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "propositions", label: "Propositions", count: imp.proposals.length },
            { value: "extrait", label: "Texte extrait" },
            { value: "original", label: "Original" },
          ]}
        />
        <div className="pt-4">
          {tab === "propositions" &&
            (imp.proposals.length === 0 ? (
              <p className="rounded-xl border border-dashed bg-white/60 px-4 py-6 text-center text-[12.5px] text-muted-foreground">
                Aucune proposition : le texte extrait sera repris tel quel.
              </p>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  <Pill tone="green" size="sm">
                    {counts.acceptee} acceptée{counts.acceptee > 1 ? "s" : ""}
                  </Pill>
                  <Pill tone="rose" size="sm">
                    {counts.refusee} refusée{counts.refusee > 1 ? "s" : ""}
                  </Pill>
                  <Pill tone="amber" size="sm">
                    {counts.en_attente} en attente
                  </Pill>
                </div>
                <ul className="flex flex-col gap-2.5">
                  {imp.proposals.map((p) => (
                    <ProposalCard
                      key={p.id}
                      proposal={p}
                      locked={locked}
                      pending={decide.isPending && decide.variables?.proposalId === p.id}
                      onDecide={(decision) => decide.mutate({ proposalId: p.id, decision })}
                    />
                  ))}
                </ul>
              </>
            ))}
          {tab === "extrait" && (
            <div className="flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Segmented
                  value={extractView}
                  onChange={setExtractView}
                  options={[
                    { value: "texte", label: "Texte extrait" },
                    { value: "diff", label: "Différences avec l'original" },
                  ]}
                />
                {extractView === "diff" && <DiffLegend parts={extractDiff} />}
              </div>
              {extractView === "texte" ? (
                <TextPanel text={imp.extractedText} />
              ) : (
                <div className="kora-scrollbar max-h-[560px] overflow-y-auto rounded-xl border border-border bg-white px-4 py-3">
                  <DiffParts parts={extractDiff} />
                </div>
              )}
            </div>
          )}
          {tab === "original" && (
            <div className="flex flex-col gap-2.5">
              <p className="text-[11.5px] text-muted-foreground">
                Original conservé tel que déposé ({imp.mime || fileKind(imp.filename)}), en lecture
                seule.
              </p>
              <TextPanel text={imp.originalText} />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
