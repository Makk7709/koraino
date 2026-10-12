import { Ban, CircleCheck, Eye, ListChecks, RotateCcw } from "lucide-react";
import { useState } from "react";
import { formatRelative } from "@/components/kora/labels";
import { GhostButton, KoraCard, StatusPill } from "@/components/kora/primitives";
import type { SignalDetail, SignalStatus } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { useSignalActions } from "./hooks";
import { ReasonDialog } from "./ReasonDialog";

/** Décision éditoriale : Surveiller, À traiter, Traité, Rejeter (motif), Restaurer. */
export function StatusActions({ signal, className }: { signal: SignalDetail; className?: string }) {
  const actions = useSignalActions();
  const [rejectOpen, setRejectOpen] = useState(false);
  const set = (status: SignalStatus) => actions.setStatus.mutate({ signalId: signal.id, status });
  const busy = actions.setStatus.isPending;
  const btn = "h-8 px-3 text-[12px]";
  const rejected = signal.status === "rejete";

  return (
    <KoraCard
      title="Décision éditoriale"
      badge={<StatusPill status={signal.status} className="min-w-0 py-0.5 text-[11px]" />}
      action={
        <span className="text-[11px] text-muted-foreground">
          Mis à jour {formatRelative(signal.updatedAt)}
        </span>
      }
      className={cn(className)}
    >
      {signal.statusReason && (
        <p className="mb-2.5 rounded-lg bg-muted px-2.5 py-1.5 text-[12px] text-kora-ink-soft">
          <span className="font-semibold text-kora-ink">Motif : </span>
          {signal.statusReason}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {rejected ? (
          <GhostButton className={btn} disabled={busy} onClick={() => set("a_traiter")}>
            <RotateCcw className="size-3.5" />
            Restaurer
          </GhostButton>
        ) : (
          <>
            <GhostButton
              className={btn}
              disabled={busy || signal.status === "surveille"}
              onClick={() => set("surveille")}
            >
              <Eye className="size-3.5" />
              Surveiller
            </GhostButton>
            <GhostButton
              className={btn}
              disabled={busy || signal.status === "a_traiter"}
              onClick={() => set("a_traiter")}
            >
              <ListChecks className="size-3.5" />À traiter
            </GhostButton>
            <GhostButton
              className={btn}
              disabled={busy || signal.status === "traite"}
              onClick={() => set("traite")}
            >
              <CircleCheck className="size-3.5" />
              Traité
            </GhostButton>
            <GhostButton
              className={`${btn} hover:border-kora-rose/40 hover:bg-kora-rose-bg hover:text-kora-rose`}
              onClick={() => setRejectOpen(true)}
            >
              <Ban className="size-3.5" />
              Rejeter
            </GhostButton>
          </>
        )}
      </div>
      <ReasonDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="Rejeter ce signal"
        description="Le motif est obligatoire et conservé dans le journal des décisions. Le signal reste restaurable."
        confirmLabel="Rejeter"
        pending={actions.reject.isPending}
        onConfirm={(reason) =>
          actions.reject.mutate(
            { signalId: signal.id, reason },
            { onSuccess: () => setRejectOpen(false) },
          )
        }
      />
    </KoraCard>
  );
}
