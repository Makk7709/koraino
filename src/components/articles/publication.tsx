import { BadgeCheck, CalendarClock, Check, CircleSlash, KeyRound, RotateCcw } from "lucide-react";
import { Pill } from "@/components/kora/primitives";
import { formatDateTime } from "@/components/kora/labels";
import { ApiError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/hooks";
import type { Approval, PublicationAttempt } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { ChannelMark } from "./channel";
import { CHANNEL_INFO, PUBLICATION_STATUS } from "./format";
import { Banner } from "./ui";

const PUBLICATION_MODE: Record<PublicationAttempt["mode"], string> = {
  brouillon_distant: "Brouillon distant",
  export: "Export",
  publication: "Publication",
};

function shortKey(key: string): string {
  return key.length > 14 ? `${key.slice(0, 12)}…` : key;
}

function attemptTitle(a: PublicationAttempt): string {
  const ch = CHANNEL_INFO[a.channel].label;
  if (a.status === "succes")
    return a.mode === "brouillon_distant"
      ? `Brouillon ${ch} envoyé (version ${a.version})`
      : `${PUBLICATION_MODE[a.mode]} ${ch} réussi (version ${a.version})`;
  if (a.status === "bloque") return `Envoi ${ch} bloqué`;
  if (a.status === "verification_requise") return `Vérification requise avant reprise (${ch})`;
  return `Échec de l'envoi ${ch}`;
}

/** Résultat d'une tentative de diffusion (succès / bloqué / vérification requise). */
export function AttemptResult({ attempt }: { attempt: PublicationAttempt }) {
  const s = PUBLICATION_STATUS[attempt.status];
  return (
    <Banner tone={s.banner} title={attemptTitle(attempt)}>
      <p>{attempt.message}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {attempt.code && (
          <span className="rounded bg-white/70 px-1.5 py-px font-mono text-[10.5px] text-kora-ink">
            {attempt.code}
          </span>
        )}
        <span>{PUBLICATION_MODE[attempt.mode]}</span>
        {attempt.remoteId && (
          <span>
            ID distant <span className="font-mono text-kora-ink">{attempt.remoteId}</span>
          </span>
        )}
        <span title={attempt.idempotencyKey} className="inline-flex items-center gap-1">
          <KeyRound className="size-3" />
          <span className="font-mono">{shortKey(attempt.idempotencyKey)}</span>
        </span>
        <span>
          {attempt.attempts} essai{attempt.attempts > 1 ? "s" : ""} · {formatDateTime(attempt.at)}
        </span>
      </p>
    </Banner>
  );
}

/** Refus renvoyé par l'API (droits, approbation absente, contradiction non résolue…). */
export function RefusalResult({ error }: { error: unknown }) {
  const code = error instanceof ApiError ? error.code : null;
  return (
    <Banner tone="danger" title="Envoi bloqué par l'API">
      <p>{errorMessage(error)}</p>
      {code && (
        <p className="mt-1">
          <span className="rounded bg-white/70 px-1.5 py-px font-mono text-[10.5px] text-kora-ink">
            {code}
          </span>
        </p>
      )}
    </Banner>
  );
}

/** Historique des tentatives (clé d'idempotence tronquée, mode, statut, id distant). */
export function AttemptHistory({ attempts }: { attempts: PublicationAttempt[] }) {
  if (!attempts.length)
    return (
      <p className="rounded-xl border border-dashed bg-white/60 px-4 py-5 text-center text-[12.5px] text-muted-foreground">
        Aucune tentative de diffusion pour l&apos;instant.
      </p>
    );
  const rows = [...attempts].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white">
      <div className="kora-scrollbar overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[12px]">
          <thead className="bg-muted/80 text-[11px] text-kora-ink-soft">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Canal</th>
              <th className="px-3 py-2 font-medium">Version</th>
              <th className="px-3 py-2 font-medium">Mode</th>
              <th className="px-3 py-2 font-medium">Statut</th>
              <th className="px-3 py-2 font-medium">Clé d&apos;idempotence</th>
              <th className="px-3 py-2 font-medium">ID distant</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70 text-kora-ink-soft">
            {rows.map((a) => (
              <tr key={a.id} className="align-top">
                <td className="px-3 py-2 whitespace-nowrap">
                  {formatDateTime(a.at)}
                  <span className="block text-[10.5px] text-muted-foreground">{a.by}</span>
                </td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1.5 font-medium text-kora-ink">
                    <ChannelMark channel={a.channel} className="size-4 text-[8px]" />
                    {CHANNEL_INFO[a.channel].label}
                  </span>
                </td>
                <td className="px-3 py-2 tabular-nums">v{a.version}</td>
                <td className="px-3 py-2">{PUBLICATION_MODE[a.mode]}</td>
                <td className="px-3 py-2">
                  <Pill tone={PUBLICATION_STATUS[a.status].tone} size="sm">
                    {PUBLICATION_STATUS[a.status].label}
                  </Pill>
                  {a.code && (
                    <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                      {a.code}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span title={a.idempotencyKey} className="font-mono text-[11px] text-kora-ink">
                    {shortKey(a.idempotencyKey)}
                  </span>
                  {a.attempts > 1 && (
                    <span className="block text-[10.5px] text-muted-foreground">
                      {a.attempts} essais
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-[11px]">{a.remoteId ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Ligne d'approbation : valide ✓ verte, ou invalidée avec motif et date. */
export function ApprovalItem({
  approval,
  showChannel = true,
}: {
  approval: Approval;
  showChannel?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border px-3.5 py-2.5",
        approval.valid
          ? "border-kora-green/20 bg-kora-green-bg/40"
          : "border-border bg-white/70 opacity-90",
      )}
    >
      {showChannel ? (
        <ChannelMark channel={approval.channel} className="mt-0.5" />
      ) : (
        <BadgeCheck
          className={cn(
            "mt-0.5 size-5",
            approval.valid ? "text-kora-green" : "text-muted-foreground",
          )}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] font-semibold text-kora-ink">
            {showChannel ? `${CHANNEL_INFO[approval.channel].label} · ` : ""}Version{" "}
            {approval.version}
          </p>
          {approval.valid ? (
            <Pill tone="green" size="sm">
              <Check className="size-3" strokeWidth={3} /> Valide
            </Pill>
          ) : (
            <Pill tone="rose" size="sm">
              <CircleSlash className="size-3" /> Invalidée
            </Pill>
          )}
        </div>
        <p className="mt-0.5 text-[11.5px] text-kora-ink-soft">
          Approuvée par <span className="font-medium text-kora-ink">{approval.approvedBy}</span> le{" "}
          {formatDateTime(approval.approvedAt)}
        </p>
        {approval.scheduledAt && (
          <p className="mt-0.5 inline-flex items-center gap-1 text-[11.5px] text-kora-teal-dark">
            <CalendarClock className="size-3.5" /> Programmée le{" "}
            {formatDateTime(approval.scheduledAt)}
          </p>
        )}
        {!approval.valid && (
          <p className="mt-1 inline-flex items-start gap-1 text-[11.5px] text-kora-rose">
            <RotateCcw className="mt-0.5 size-3 shrink-0" />
            <span>
              Invalidée
              {approval.invalidatedAt ? ` le ${formatDateTime(approval.invalidatedAt)}` : ""}
              {approval.invalidatedReason ? ` — ${approval.invalidatedReason}` : ""}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
