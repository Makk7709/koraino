import { useQueryClient } from "@tanstack/react-query";
import { Ban, Check, ClipboardList, History, Send, ShieldCheck, Waypoints } from "lucide-react";
import { Fragment } from "react";
import { GhostButton, Pill, PrimaryButton } from "@/components/kora/primitives";
import { formatDateTime } from "@/components/kora/labels";
import { api } from "@/lib/api/client";
import { qk, useAudit, useKoraMutation, useWordPressStatus } from "@/lib/api/hooks";
import type {
  ArticleDetail,
  ArticleStatus,
  Channel,
  PublicationAttempt,
  WordPressStatus,
} from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { ChannelMark } from "./channel";
import { CHANNEL_INFO, CHANNELS, PUBLICATION_STATUS } from "./format";
import { ApprovalItem, AttemptHistory, AttemptResult, RefusalResult } from "./publication";
import { Banner, SectionTitle } from "./ui";
import { wordpressActionLabel, wordpressSendState } from "./wordpress";
import {
  WordPressModeNote,
  WordPressPendingNote,
  WordPressRefusal,
  WordPressRemoteState,
} from "./WordPressChannel";
import { validApprovalFor, type ArticleWorkflow } from "./workflow";

const STEPS = ["Brouillon", "En revue", "Approuvé", "Brouillon distant / export"] as const;

function stepIndex(status: ArticleStatus, delivered: boolean): number {
  if (status === "publie" || delivered) return 3;
  if (status === "approuve" || status === "programme") return 2;
  if (status === "en_revue") return 1;
  return 0;
}

function WorkflowSteps({ article }: { article: ArticleDetail }) {
  const delivered = article.publications.some((p) => p.status === "succes");
  const current = stepIndex(article.status, delivered);
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((label, i) => {
        const done = i < current || (i === current && i === 3);
        const active = i === current && !done;
        const rejected = article.status === "rejete" && i === 0;
        return (
          <Fragment key={label}>
            {i > 0 && (
              <li
                aria-hidden
                className={cn("h-px flex-1", i <= current ? "bg-kora-teal-light" : "bg-border")}
              />
            )}
            <li className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex size-6 items-center justify-center rounded-full text-[11px] font-bold",
                  done && "bg-kora-teal text-white",
                  active && !rejected && "bg-white text-kora-teal ring-2 ring-kora-teal",
                  rejected && "bg-kora-rose-bg text-kora-rose ring-2 ring-kora-rose/50",
                  !done && !active && "bg-muted text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span
                className={cn(
                  "text-[12px] whitespace-nowrap",
                  active || done ? "font-semibold text-kora-ink" : "text-muted-foreground",
                )}
              >
                {rejected ? "Rejeté — à réviser" : label}
              </span>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

function latestAttempt(attempts: PublicationAttempt[], channel: Channel) {
  return (
    attempts.filter((a) => a.channel === channel).sort((a, b) => b.at.localeCompare(a.at))[0] ??
    null
  );
}

function ChannelRow({
  article,
  channel,
  workflow,
  wordpress,
}: {
  article: ArticleDetail;
  channel: Channel;
  workflow: ArticleWorkflow;
  wordpress?: WordPressStatus | undefined;
}) {
  const qc = useQueryClient();
  const info = CHANNEL_INFO[channel];
  const isWordPress = channel === "wordpress";
  const approval = validApprovalFor(article, channel);
  const publish = useKoraMutation(() => api.publishArticle(article.id, { channel }), {
    success: (r) =>
      r.status === "succes"
        ? r.mode === "brouillon_distant"
          ? `Brouillon ${info.label} envoyé`
          : `Export ${info.label} prêt`
        : "",
  });
  const last = publish.data ?? latestAttempt(article.publications, channel);
  const channelReason = !approval
    ? `Approbation valide requise pour la version ${article.currentVersion} sur ce canal.`
    : !workflow.canPublish
      ? !workflow.perms.canValidate
        ? "La diffusion vers un canal est réservée aux validateurs."
        : workflow.dirtyHint
      : null;
  const send = isWordPress
    ? wordpressSendState(wordpress, channelReason)
    : { disabledReason: channelReason, notConfigured: false, demo: false };
  const disabledReason = send.disabledReason;
  // Un refus peut avoir enregistré une tentative ou réglé l'état distant (409 publié).
  const onPublishError = () => void qc.invalidateQueries({ queryKey: qk.article(article.id) });

  return (
    <div className="rounded-xl border border-border bg-white p-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <ChannelMark channel={channel} className="size-8 text-[14px]" />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-bold text-kora-ink">{info.label}</p>
          <p className="text-[11.5px] text-muted-foreground">{info.detail}</p>
        </div>
        {approval ? (
          <Pill tone="green" size="sm">
            <Check className="size-3" strokeWidth={3} /> Approuvé · v{approval.version}
          </Pill>
        ) : (
          <Pill tone="gray" size="sm">
            Non approuvé
          </Pill>
        )}
        <PrimaryButton
          disabled={!!disabledReason || publish.isPending}
          title={disabledReason ?? undefined}
          onClick={() => publish.mutate(undefined, { onError: onPublishError })}
        >
          <Send className="size-4" />
          {publish.isPending
            ? "Envoi…"
            : isWordPress
              ? wordpressActionLabel(article.wordpress)
              : info.action}
        </PrimaryButton>
      </div>
      {isWordPress && (
        <>
          <WordPressRemoteState
            article={article}
            canRefresh={workflow.perms.canValidate}
            refreshBlockedReason={send.notConfigured ? send.disabledReason : null}
          />
          <WordPressModeNote notConfigured={send.notConfigured} demo={send.demo} />
        </>
      )}
      {channelReason && !approval && (
        <p className="mt-2 text-[11.5px] text-muted-foreground">{channelReason}</p>
      )}
      {(publish.isError || last) && (
        <div className="mt-2.5">
          {publish.isError ? (
            isWordPress ? (
              <WordPressRefusal error={publish.error} editUrl={article.wordpress.editUrl ?? null} />
            ) : (
              <RefusalResult error={publish.error} />
            )
          ) : last ? (
            <>
              <AttemptResult attempt={last} />
              {isWordPress && last.status === "verification_requise" && <WordPressPendingNote />}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ArticleJournal({ articleId }: { articleId: string }) {
  const audit = useAudit({ entity: "article", entityId: articleId, limit: 30 });
  const events = audit.data ?? [];
  if (audit.isPending)
    return <p className="text-[12px] text-muted-foreground">Chargement du journal…</p>;
  if (audit.isError || !events.length)
    return (
      <p className="text-[12px] text-muted-foreground">
        {audit.isError ? "Journal indisponible pour le moment." : "Aucun événement consigné."}
      </p>
    );
  return (
    <ul className="flex flex-col divide-y divide-border/70 rounded-xl border border-border bg-white">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3 px-3.5 py-2 text-[12px]">
          <span className="w-[112px] shrink-0 text-muted-foreground tabular-nums">
            {formatDateTime(e.at)}
          </span>
          <span className="min-w-0 flex-1 text-kora-ink-soft">
            <span className="font-semibold text-kora-ink">{e.actor}</span> · {e.action}
            {e.details && (
              <span className="block text-[11.5px] text-muted-foreground">{e.details}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Circuit d'approbation, diffusion par canal et traçabilité des envois. */
export function ApprovalPanel({
  article,
  workflow,
  onApprove,
  onReject,
  onShowDossier,
}: {
  article: ArticleDetail;
  workflow: ArticleWorkflow;
  onApprove: () => void;
  onReject: () => void;
  onShowDossier: () => void;
}) {
  const wordpress = useWordPressStatus();
  const approvals = [...article.approvals].sort((a, b) => b.approvedAt.localeCompare(a.approvedAt));
  const blocked = article.factChecks.filter((f) => f.status === "contradictoire").length;
  const s = article.status;
  const hint =
    s === "brouillon" || s === "rejete"
      ? (workflow.submitHint ?? "Soumettez la version courante en revue pour la faire approuver.")
      : !workflow.canApprove
        ? workflow.approveHint
        : null;
  const lastStatus = article.publications.length
    ? PUBLICATION_STATUS[
        [...article.publications].sort((a, b) => b.at.localeCompare(a.at))[0]!.status
      ]
    : null;

  return (
    <div className="flex flex-col gap-5">
      <Banner
        tone="info"
        title="Pilote : WordPress en brouillon distant uniquement — aucune publication publique"
      >
        LinkedIn et newsletter sont exportés manuellement. L&apos;API revérifie droits et état juste
        avant chaque envoi ; une clé d&apos;idempotence (contenu + version + canal) empêche tout
        doublon lors d&apos;une reprise.
      </Banner>

      <section className="rounded-xl border border-border bg-white/80 p-3.5">
        <WorkflowSteps article={article} />
        <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
          <p className="mr-auto text-[12px] text-kora-ink-soft">
            Version courante :{" "}
            <span className="font-semibold text-kora-ink">{article.currentVersion}</span>
            {lastStatus && (
              <>
                {" "}
                · dernière tentative :{" "}
                <Pill tone={lastStatus.tone} size="sm">
                  {lastStatus.label}
                </Pill>
              </>
            )}
          </p>
          <GhostButton
            disabled={!workflow.canSubmit || workflow.submit.isPending}
            title={workflow.submitHint ?? undefined}
            onClick={() => workflow.submit.mutate(undefined)}
          >
            <Send className="size-4" /> Soumettre en revue
          </GhostButton>
          <PrimaryButton
            disabled={!workflow.canApprove}
            title={workflow.approveHint ?? undefined}
            onClick={onApprove}
          >
            <ShieldCheck className="size-4" /> Approuver…
          </PrimaryButton>
          <GhostButton
            disabled={!workflow.canReject}
            title={workflow.rejectHint ?? undefined}
            onClick={onReject}
          >
            <Ban className="size-4" /> Rejeter…
          </GhostButton>
        </div>
        {hint && <p className="mt-2 text-[11.5px] text-muted-foreground">{hint}</p>}
      </section>

      {blocked > 0 && (
        <Banner
          tone="danger"
          title={`${blocked} contradiction${blocked > 1 ? "s" : ""} non résolue${blocked > 1 ? "s" : ""}`}
          action={
            <GhostButton className="h-8 text-xs" onClick={onShowDossier}>
              Arbitrer dans le dossier
            </GhostButton>
          }
        >
          Tant qu&apos;une contradiction du dossier factuel n&apos;est pas levée, l&apos;approbation
          et l&apos;envoi restent bloqués.
        </Banner>
      )}

      <section>
        <SectionTitle icon={ClipboardList}>Approbations ({approvals.length})</SectionTitle>
        {approvals.length ? (
          <div className="flex flex-col gap-2">
            {approvals.map((a) => (
              <ApprovalItem key={a.id} approval={a} />
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed bg-white/60 px-4 py-5 text-center text-[12.5px] text-muted-foreground">
            Aucune approbation enregistrée.
          </p>
        )}
      </section>

      <section>
        <SectionTitle icon={Waypoints}>Diffusion par canal</SectionTitle>
        <div className="flex flex-col gap-2">
          {CHANNELS.map((c) => (
            <ChannelRow
              key={c}
              article={article}
              channel={c}
              workflow={workflow}
              wordpress={wordpress.data}
            />
          ))}
        </div>
      </section>

      <section>
        <SectionTitle icon={History}>
          Historique des tentatives ({article.publications.length})
        </SectionTitle>
        <AttemptHistory attempts={article.publications} />
      </section>

      <section>
        <SectionTitle icon={ClipboardList}>Journal de l&apos;article</SectionTitle>
        <ArticleJournal articleId={article.id} />
      </section>
    </div>
  );
}
