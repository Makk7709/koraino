import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { TriangleAlert, X } from "lucide-react";
import type { ComponentType, FormEvent, ReactNode } from "react";
import { GhostButton, IconTile } from "@/components/kora/primitives";
import type { Tone } from "@/components/kora/labels";
import { cn } from "@/lib/utils";

const OVERLAY =
  "fixed inset-0 z-50 bg-kora-ink/35 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0";

const CENTERED =
  "kora-card fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 bg-white shadow-[0_24px_60px_-20px_oklch(0.289_0.062_263.9/45%)] duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95";

/** Classes des champs de formulaire (Input / Textarea / SelectTrigger). */
export const fieldClass =
  "rounded-lg border-border bg-white text-[13px] text-kora-ink shadow-none focus-visible:ring-kora-teal/40 md:text-[13px]";

/** Fenêtre modale aux couleurs KORA (en-tête, corps défilant, pied d'actions). */
export function KoraDialog({
  open,
  onOpenChange,
  title,
  description,
  icon,
  tone = "teal",
  children,
  footer,
  onSubmit,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
  tone?: Tone;
  children: ReactNode;
  footer?: ReactNode;
  onSubmit?: () => void;
  className?: string;
}) {
  const body = (
    <>
      <div className="kora-scrollbar max-h-[68vh] overflow-y-auto px-5 py-4">{children}</div>
      {footer && (
        <footer className="flex items-center justify-end gap-2 rounded-b-[inherit] border-t border-border/80 bg-secondary/50 px-5 py-3">
          {footer}
        </footer>
      )}
    </>
  );
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={OVERLAY} />
        <DialogPrimitive.Content className={cn(CENTERED, "max-w-lg", className)}>
          <header className="flex items-start gap-3 border-b border-border/80 px-5 py-4">
            {icon && <IconTile icon={icon} tone={tone} size="md" />}
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-[16px] font-bold text-kora-ink">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-0.5 text-[12px] text-kora-ink-soft">
                  {description}
                </DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">
                  {title}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              aria-label="Fermer"
              className="rounded-md p-1 text-kora-ink-soft transition hover:bg-secondary hover:text-kora-ink"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </header>
          {onSubmit ? (
            <form
              noValidate
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                onSubmit();
              }}
            >
              {body}
            </form>
          ) : (
            body
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Panneau latéral droit (fiche détaillée). */
export function KoraSheet({
  open,
  onOpenChange,
  title,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Titre accessible (lecteurs d'écran). */
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={OVERLAY} />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex h-full w-[min(700px,94vw)] flex-col border-l border-border bg-[oklch(0.982_0.008_205)] shadow-[-24px_0_60px_-30px_oklch(0.289_0.062_263.9/45%)] data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=open]:duration-300 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=closed]:duration-200",
            className,
          )}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
          <DialogPrimitive.Close
            aria-label="Fermer"
            className="absolute top-4 right-4 z-10 rounded-md p-1 text-kora-ink-soft transition hover:bg-white hover:text-kora-ink"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Confirmation d'une action destructive. */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialogPrimitive.Root>
      <AlertDialogPrimitive.Trigger asChild>{trigger}</AlertDialogPrimitive.Trigger>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className={OVERLAY} />
        <AlertDialogPrimitive.Content className={cn(CENTERED, "max-w-md p-5")}>
          <div className="flex items-start gap-3">
            <IconTile icon={TriangleAlert} tone="rose" size="lg" />
            <div className="min-w-0">
              <AlertDialogPrimitive.Title className="text-[16px] font-bold text-kora-ink">
                {title}
              </AlertDialogPrimitive.Title>
              <AlertDialogPrimitive.Description className="mt-1 text-[13px] text-kora-ink-soft">
                {description}
              </AlertDialogPrimitive.Description>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialogPrimitive.Cancel asChild>
              <GhostButton>Annuler</GhostButton>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild>
              <button
                type="button"
                onClick={onConfirm}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-kora-rose px-4 text-[13px] font-semibold text-white shadow-[0_6px_16px_-6px_var(--kora-rose)] transition hover:brightness-105"
              >
                {confirmLabel}
              </button>
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

/** Libellé + champ + aide / erreur. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required = false,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[12px] font-semibold text-kora-ink">
        {label}
        {required && <span className="ml-0.5 text-kora-rose">*</span>}
      </label>
      {children}
      {error ? (
        <p className="text-[11px] font-medium text-kora-rose">{error}</p>
      ) : (
        hint && <p className="text-[11px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
