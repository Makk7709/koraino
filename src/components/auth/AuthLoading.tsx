import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Indicateur discret : n'apparaît qu'après un court délai pour éviter un clignotement. */
export function AuthSpinner({
  label = "Vérification de la session…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setVisible(true), 300);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center gap-3 transition-opacity duration-300",
        visible ? "opacity-100" : "opacity-0",
        className,
      )}
    >
      <LoaderCircle aria-hidden className="size-6 animate-spin text-kora-teal" />
      <p className="text-[13px] font-medium text-kora-ink-soft">{label}</p>
    </div>
  );
}

/** Écran plein pendant la vérification de la session (aucun contenu applicatif). */
export function AuthLoading() {
  return (
    <div className="kora-page-bg flex min-h-screen items-center justify-center" aria-busy="true">
      <AuthSpinner />
    </div>
  );
}
