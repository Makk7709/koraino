import { Eye, EyeOff } from "lucide-react";
import { forwardRef, useState, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Champ mot de passe avec bouton « Afficher / Masquer » accessible. */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<ComponentProps<"input">, "type">>(
  function PasswordInput({ className, ...props }, ref) {
    const [shown, setShown] = useState(false);
    return (
      <div className="relative">
        <Input
          ref={ref}
          type={shown ? "text" : "password"}
          spellCheck={false}
          autoCapitalize="none"
          className={cn("pr-10", className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-pressed={shown}
          aria-label={shown ? "Masquer le mot de passe" : "Afficher le mot de passe"}
          title={shown ? "Masquer le mot de passe" : "Afficher le mot de passe"}
          className="absolute top-1/2 right-1.5 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-kora-ink-soft transition hover:bg-secondary hover:text-kora-ink focus-visible:ring-2 focus-visible:ring-kora-teal/40 focus-visible:outline-none"
        >
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    );
  },
);
