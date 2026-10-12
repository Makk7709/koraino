import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const SIZES = {
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
} as const;

/**
 * Fenêtre modale aux couleurs de la maquette (carte blanche, voile navy léger).
 * Le contenu est démonté à la fermeture : l'état des formulaires repart à zéro.
 */
export function KoraDialog({
  open,
  onOpenChange,
  title,
  description,
  icon,
  size = "md",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  size?: keyof typeof SIZES;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-kora-ink/35 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          {...(description ? {} : { "aria-describedby": undefined })}
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex max-h-[88vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-[0_24px_64px_-24px_oklch(0.289_0.062_263.9/45%)] duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            SIZES[size],
          )}
        >
          <header className="flex items-start gap-3 border-b border-border/70 px-5 py-4">
            {icon}
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-[16px] font-bold text-kora-ink">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-0.5 text-[12.5px] leading-snug text-kora-ink-soft">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close
              aria-label="Fermer"
              className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-kora-ink"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </header>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function DialogBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("kora-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4", className)}>
      {children}
    </div>
  );
}

export function DialogFooterBar({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <footer className="flex items-center justify-between gap-3 border-t border-border/70 bg-muted/50 px-5 py-3">
      <div className="min-w-0 text-[11.5px] leading-snug text-muted-foreground">{note}</div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </footer>
  );
}
