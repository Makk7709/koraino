import type { ReactNode } from "react";

/**
 * Libellé + champ + aide / erreur reliés par `aria-describedby` (`${id}-hint`,
 * `${id}-error`) : le champ enfant doit référencer ces identifiants.
 */
export function AuthField({
  id,
  label,
  hint,
  error,
  action,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="block text-[12px] font-semibold text-kora-ink">
          {label}
        </label>
        {action}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-[11px] font-medium text-kora-rose">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-[11px] text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
