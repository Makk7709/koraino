import { useEffect, useState } from "react";
import { GhostButton } from "@/components/kora/primitives";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const QUICK_REASONS = [
  "Hors périmètre territorial",
  "Doublon d'un sujet existant",
  "Information non vérifiable",
  "Intérêt éditorial insuffisant",
];

/** Dialogue de motif obligatoire (rejet / « Ignorer » d'un signal). */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmer",
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  pending?: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  const valid = reason.trim().length >= 3;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl border-border bg-white p-5">
        <DialogHeader>
          <DialogTitle className="text-[16px] font-bold text-kora-ink">{title}</DialogTitle>
          {description && (
            <DialogDescription className="text-[13px] text-kora-ink-soft">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !pending) onConfirm(reason.trim());
          }}
          className="space-y-3"
        >
          <div className="flex flex-wrap gap-1.5">
            {QUICK_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                  reason === r
                    ? "border-kora-teal bg-kora-teal-bg text-kora-teal-dark"
                    : "border-border bg-white text-kora-ink-soft hover:border-kora-teal-light",
                )}
              >
                {r}
              </button>
            ))}
          </div>
          <Textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motif (obligatoire, conservé dans le journal des décisions)"
            className="min-h-[88px] rounded-lg bg-white text-[13px]"
          />
          <DialogFooter className="gap-2">
            <GhostButton onClick={() => onOpenChange(false)}>Annuler</GhostButton>
            <button
              type="submit"
              disabled={!valid || pending}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-kora-rose px-4 text-[13px] font-semibold text-white shadow-[0_6px_16px_-8px_oklch(0.628_0.198_10/70%)] transition hover:brightness-105 disabled:pointer-events-none disabled:opacity-50"
            >
              {pending ? "Enregistrement…" : confirmLabel}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
