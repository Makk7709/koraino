import { Merge } from "lucide-react";
import { useEffect, useState } from "react";
import { scoreOn10 } from "@/components/kora/labels";
import { GhostButton, PrimaryButton, StatusPill } from "@/components/kora/primitives";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Signal } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { useSignalActions } from "./hooks";

/** Fusion de signaux cochés : choix du signal principal puis `api.mergeSignals`. */
export function MergeDialog({
  open,
  onOpenChange,
  signals,
  onMerged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signals: Signal[];
  onMerged: (targetId: string) => void;
}) {
  const actions = useSignalActions();
  const best = signals.slice().sort((a, b) => b.score.total - a.score.total)[0];
  const [targetId, setTargetId] = useState<string | undefined>(best?.id);
  useEffect(() => {
    if (open) setTargetId(best?.id);
  }, [open, best?.id]);

  const others = signals.filter((s) => s.id !== targetId).map((s) => s.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-2xl border-border bg-white p-5">
        <DialogHeader>
          <DialogTitle className="text-[16px] font-bold text-kora-ink">
            Fusionner {signals.length} signaux
          </DialogTitle>
          <DialogDescription className="text-[13px] text-kora-ink-soft">
            Choisissez le signal principal : les observations des autres lui sont rattachées. La
            fusion est journalisée et réversible avec « Détacher ».
          </DialogDescription>
        </DialogHeader>
        <ul role="radiogroup" aria-label="Signal principal" className="space-y-2">
          {signals.map((s) => {
            const active = s.id === targetId;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTargetId(s.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                    active
                      ? "border-kora-teal bg-kora-teal-bg"
                      : "border-border bg-white hover:border-kora-teal-light",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-4 shrink-0 items-center justify-center rounded-full border-2",
                      active ? "border-kora-teal" : "border-border",
                    )}
                  >
                    {active && <span className="size-2 rounded-full bg-kora-teal" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[13px] font-semibold text-kora-ink">
                      {s.title}
                    </span>
                    <span className="text-[11.5px] text-muted-foreground">
                      {s.primaryOutlet.name} · {s.observationIds.length} observation
                      {s.observationIds.length > 1 ? "s" : ""} · score {scoreOn10(s.score.total)}
                    </span>
                  </span>
                  <StatusPill status={s.status} className="min-w-0 py-0.5 text-[11px]" />
                </button>
              </li>
            );
          })}
        </ul>
        <DialogFooter className="gap-2">
          <GhostButton onClick={() => onOpenChange(false)}>Annuler</GhostButton>
          <PrimaryButton
            disabled={!targetId || others.length === 0 || actions.merge.isPending}
            onClick={() =>
              targetId &&
              actions.merge.mutate(
                { targetId, otherIds: others },
                {
                  onSuccess: () => {
                    onOpenChange(false);
                    onMerged(targetId);
                  },
                },
              )
            }
          >
            <Merge className="size-4" />
            {actions.merge.isPending ? "Fusion…" : "Fusionner"}
          </PrimaryButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
