import { Ban, CalendarClock, Check, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { GhostButton, PrimaryButton } from "@/components/kora/primitives";
import { formatDateTime } from "@/components/kora/labels";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api/client";
import { useKoraMutation } from "@/lib/api/hooks";
import type { ApproveInput, ArticleDetail, Channel } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { ChannelMark } from "./channel";
import { CHANNEL_INFO, CHANNELS } from "./format";
import { currentVersionOf } from "./draft";
import { DialogBody, DialogFooterBar, KoraDialog } from "./KoraDialog";
import { Banner, Field, inputClass, SkyPanel } from "./ui";
import { useSetArticle, validApprovalFor } from "./workflow";

function ApproveForm({ article, onDone }: { article: ArticleDetail; onDone: () => void }) {
  const firstFree = CHANNELS.find((c) => !validApprovalFor(article, c)) ?? "wordpress";
  const [channel, setChannel] = useState<Channel>(firstFree);
  const [schedule, setSchedule] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const setArticle = useSetArticle();
  const approve = useKoraMutation((input: ApproveInput) => api.approveArticle(article.id, input), {
    success: (a) => `Version ${a.currentVersion} approuvée pour ${CHANNEL_INFO[channel].label}`,
    onSuccess: (a) => {
      setArticle(a);
      onDone();
    },
  });
  const version = currentVersionOf(article);
  const at = schedule && date ? new Date(`${date}T${time || "09:00"}`) : null;
  const scheduleError = schedule
    ? !date
      ? "Choisissez une date de programmation."
      : at && at.getTime() <= Date.now()
        ? "La programmation doit être dans le futur."
        : null
    : null;
  const already = validApprovalFor(article, channel);

  return (
    <>
      <DialogBody className="flex flex-col gap-4">
        <SkyPanel title={`Version relue : ${article.currentVersion}`} icon={ShieldCheck}>
          <p className="text-[13px] leading-snug font-semibold text-kora-ink">
            « {version?.title ?? article.title} »
          </p>
          {version && (
            <p className="mt-1 text-[11.5px] text-kora-ink-soft">
              Enregistrée par {version.createdBy} le {formatDateTime(version.createdAt)}
              {version.note ? ` · « ${version.note} »` : ""}
            </p>
          )}
          <p className="mt-2 text-[11.5px] text-kora-ink-soft">
            L&apos;approbation enregistre votre identité, la date, la version et le canal. Toute
            modification ultérieure du contenu l&apos;invalidera.
          </p>
        </SkyPanel>

        <Field label="Canal de diffusion">
          <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
            {CHANNELS.map((c) => {
              const active = channel === c;
              const done = !!validApprovalFor(article, c);
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setChannel(c)}
                  className={cn(
                    "flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition",
                    active
                      ? "border-kora-teal-light bg-kora-teal-bg/70 ring-1 ring-kora-teal-light/60"
                      : "border-border bg-white hover:border-kora-teal-light",
                  )}
                >
                  <span className="flex w-full items-center gap-2">
                    <ChannelMark channel={c} />
                    <span className="flex-1 text-[13px] font-semibold text-kora-ink">
                      {CHANNEL_INFO[c].label}
                    </span>
                    {done && <Check className="size-4 text-kora-green" strokeWidth={3} />}
                  </span>
                  <span className="text-[11px] leading-snug text-muted-foreground">
                    {CHANNEL_INFO[c].mode}
                    {done ? " · déjà approuvé" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </Field>

        <div className="rounded-xl border border-border bg-white p-3">
          <label className="flex items-center gap-2.5">
            <Switch checked={schedule} onCheckedChange={setSchedule} />
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-kora-ink">
              <CalendarClock className="size-4 text-kora-teal" /> Programmer la diffusion
            </span>
            <span className="text-[11.5px] text-muted-foreground">(facultatif)</span>
          </label>
          {schedule && (
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <Field label="Date" htmlFor="approve-date">
                <Input
                  id="approve-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Heure" htmlFor="approve-time">
                <Input
                  id="approve-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className={inputClass}
                />
              </Field>
              {scheduleError && (
                <p className="col-span-2 text-[11.5px] font-medium text-kora-rose">
                  {scheduleError}
                </p>
              )}
            </div>
          )}
        </div>

        {already && (
          <Banner tone="success">
            Une approbation valide existe déjà pour {CHANNEL_INFO[channel].label} sur la version{" "}
            {already.version} ({already.approvedBy}).
          </Banner>
        )}
      </DialogBody>
      <DialogFooterBar
        note={
          <>Pilote : WordPress en brouillon distant uniquement, LinkedIn et newsletter en export.</>
        }
      >
        <GhostButton onClick={onDone}>Annuler</GhostButton>
        <PrimaryButton
          disabled={approve.isPending || !!scheduleError}
          onClick={() =>
            approve.mutate({
              channel,
              version: article.currentVersion,
              scheduledAt: at ? at.toISOString() : null,
            })
          }
        >
          <ShieldCheck className="size-4" /> Approuver la version {article.currentVersion}
        </PrimaryButton>
      </DialogFooterBar>
    </>
  );
}

export function ApproveDialog({
  article,
  open,
  onOpenChange,
}: {
  article: ArticleDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <KoraDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Approuver pour diffusion"
      description="Approbation explicite d'une version précise, pour un canal."
      icon={
        <span className="mt-0.5 inline-flex size-8 items-center justify-center rounded-lg bg-kora-green-bg text-kora-green">
          <ShieldCheck className="size-4" />
        </span>
      }
    >
      <ApproveForm article={article} onDone={() => onOpenChange(false)} />
    </KoraDialog>
  );
}

function RejectForm({ article, onDone }: { article: ArticleDetail; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const setArticle = useSetArticle();
  const reject = useKoraMutation((r: string) => api.rejectArticle(article.id, r), {
    success: "Article rejeté — motif consigné au journal",
    onSuccess: (a) => {
      setArticle(a);
      onDone();
    },
  });
  const valid = reason.trim().length >= 5;
  return (
    <>
      <DialogBody className="flex flex-col gap-3">
        <p className="text-[13px] text-kora-ink-soft">
          Version {article.currentVersion} · « {article.title} »
        </p>
        <Field
          label="Motif du rejet (obligatoire)"
          htmlFor="reject-reason"
          hint="Le motif est conservé dans l'historique et exportable."
          aside={`${reason.trim().length} car.`}
        >
          <Textarea
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            autoFocus
            placeholder="Ex. Montant de la levée non corroboré par une source indépendante…"
            className={inputClass}
          />
        </Field>
        {article.approvals.some((a) => a.valid) && (
          <Banner tone="warning">Les approbations valides de cet article seront invalidées.</Banner>
        )}
      </DialogBody>
      <DialogFooterBar>
        <GhostButton onClick={onDone}>Annuler</GhostButton>
        <button
          type="button"
          disabled={!valid || reject.isPending}
          onClick={() => reject.mutate(reason.trim())}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-kora-rose px-4 text-[13px] font-semibold text-white shadow-[0_6px_16px_-8px_oklch(0.628_0.198_10/70%)] transition hover:brightness-105 disabled:pointer-events-none disabled:opacity-50"
        >
          <Ban className="size-4" /> Rejeter
        </button>
      </DialogFooterBar>
    </>
  );
}

export function RejectDialog({
  article,
  open,
  onOpenChange,
}: {
  article: ArticleDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <KoraDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Rejeter l'article"
      description="Le rédacteur verra le motif et pourra proposer une nouvelle version."
      icon={
        <span className="mt-0.5 inline-flex size-8 items-center justify-center rounded-lg bg-kora-rose-bg text-kora-rose">
          <Ban className="size-4" />
        </span>
      }
    >
      <RejectForm article={article} onDone={() => onOpenChange(false)} />
    </KoraDialog>
  );
}
