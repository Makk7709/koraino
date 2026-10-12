import { useNavigate } from "@tanstack/react-router";
import type { ButtonHTMLAttributes, ComponentType, MouseEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Bouton icône carré des colonnes d'actions. Les props restantes sont transmises
 * au bouton pour qu'il serve de déclencheur Radix (`asChild`).
 */
export function IconAction({
  icon: Icon,
  label,
  onClick,
  tone = "default",
  spinning = false,
  className,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: ComponentType<{ className?: string }>;
  label: string;
  tone?: "default" | "danger";
  spinning?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      {...rest}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-lg border border-border bg-white transition disabled:pointer-events-none disabled:opacity-40",
        tone === "danger"
          ? "text-kora-rose hover:border-kora-rose/40 hover:bg-kora-rose-bg"
          : "text-kora-ink-soft hover:border-kora-teal-light hover:bg-kora-teal-bg hover:text-kora-teal-dark",
        className,
      )}
    >
      <Icon className={cn("size-3.5", spinning && "animate-spin")} />
    </button>
  );
}

/**
 * Lien interne vers une URL déjà construite (`/signaux?id=…`) : navigation client
 * sans dépendre du typage des search params d'une route tierce.
 */
export function HrefLink({
  href,
  className,
  children,
  title,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  const navigate = useNavigate();
  return (
    <a
      href={href}
      title={title}
      className={className}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        e.stopPropagation();
        void navigate({ href });
      }}
    >
      {children}
    </a>
  );
}

/** Lien de téléchargement stylé comme les boutons de la maquette. */
export function DownloadLink({
  href,
  children,
  variant = "ghost",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: "ghost" | "primary";
  className?: string;
}) {
  return (
    <a
      href={href}
      download
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold transition",
        variant === "primary"
          ? "kora-btn-primary"
          : "border border-border bg-white text-kora-ink shadow-[0_1px_2px_oklch(0.289_0.062_263.9/5%)] hover:border-kora-teal-light hover:bg-kora-teal-bg",
        className,
      )}
    >
      {children}
    </a>
  );
}

/** Lien externe (source, domaine) ouvert dans un nouvel onglet. */
export function ExternalAnchor({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cn("text-kora-teal hover:text-kora-teal-dark hover:underline", className)}
    >
      {children}
    </a>
  );
}
