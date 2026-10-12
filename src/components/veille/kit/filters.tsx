import { Search, X } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const ALL = "all" as const;
export type WithAll<T extends string> = T | typeof ALL;

/** Sélecteur blanc des filtres de table (maquette : « Tous les statuts ˅ »). */
export function FilterSelect<T extends string>({
  value,
  onChange,
  options,
  allLabel,
  className,
  ariaLabel,
}: {
  value: WithAll<T>;
  onChange: (v: WithAll<T>) => void;
  options: { value: T; label: string }[];
  allLabel?: string;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as WithAll<T>)}>
      <SelectTrigger
        aria-label={ariaLabel ?? allLabel}
        className={cn(
          "h-8 w-auto min-w-[9.5rem] gap-2 rounded-lg border-border bg-white px-3 text-[12px] font-medium text-kora-ink shadow-[0_1px_2px_oklch(0.289_0.062_263.9/5%)] focus:ring-kora-teal/40",
          className,
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72 rounded-lg">
        {allLabel && (
          <SelectItem value={ALL} className="text-[12px]">
            {allLabel}
          </SelectItem>
        )}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-[12px]">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Champ de recherche compact des barres de filtres. */
export function SearchField({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex h-8 w-60 items-center gap-2 rounded-lg border border-border bg-white px-2.5 text-[12px] shadow-[0_1px_2px_oklch(0.289_0.062_263.9/5%)] focus-within:border-kora-teal-light focus-within:ring-1 focus-within:ring-kora-teal/30",
        className,
      )}
    >
      <Search className="size-3.5 shrink-0 text-kora-ink-soft" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-kora-ink outline-none placeholder:text-muted-foreground"
      />
      {value && (
        <button
          type="button"
          aria-label="Effacer la recherche"
          onClick={() => onChange("")}
          className="rounded p-0.5 text-muted-foreground hover:text-kora-ink"
        >
          <X className="size-3" />
        </button>
      )}
    </label>
  );
}

/** Bascule segmentée (ex. vue grille / vue table). */
export function SegmentedToggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: {
    value: T;
    label: string;
    icon: ComponentType<{ className?: string }>;
  }[];
}) {
  return (
    <div className="inline-flex h-8 items-center rounded-lg border border-border bg-white p-0.5 shadow-[0_1px_2px_oklch(0.289_0.062_263.9/5%)]">
      {options.map((o) => {
        const Icon = o.icon;
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            title={o.label}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-full items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition",
              active
                ? "bg-kora-teal-bg text-kora-teal-dark shadow-[inset_0_0_0_1px_var(--kora-teal-light)]"
                : "text-kora-ink-soft hover:text-kora-ink",
            )}
          >
            <Icon className="size-3.5" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Barre de filtres alignée à droite d'un titre de carte. */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>;
}
