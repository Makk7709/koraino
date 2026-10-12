import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const ALL = "__tous__";

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * Select blanc des barres de filtres (maquette : « Tous les statuts ⌄ »).
 * `allLabel` ajoute l'option « tous » qui renvoie `undefined`.
 */
export function FilterSelect({
  label,
  value,
  onValueChange,
  options,
  allLabel,
  className,
  tone = "light",
}: {
  label: string;
  value: string | undefined;
  onValueChange: (v: string | undefined) => void;
  options: FilterOption[];
  allLabel?: string;
  className?: string;
  tone?: "light" | "dark";
}) {
  const current = value ?? (allLabel ? ALL : undefined);
  const display =
    value === undefined
      ? (allLabel ?? label)
      : (options.find((o) => o.value === value)?.label ?? label);
  return (
    <Select
      {...(current !== undefined ? { value: current } : {})}
      onValueChange={(v) => onValueChange(v === ALL ? undefined : v)}
    >
      <SelectTrigger
        aria-label={label}
        className={cn(
          "h-8 w-auto min-w-[8.25rem] gap-2 rounded-lg px-3 text-[12px] font-medium shadow-none focus:ring-kora-teal-light [&>svg]:size-3.5",
          tone === "light"
            ? "border-border bg-white text-kora-ink shadow-[0_1px_2px_oklch(0.289_0.062_263.9/5%)] hover:border-kora-teal-light [&>svg]:text-kora-ink-soft [&>svg]:opacity-90"
            : "border-white/15 bg-white/[0.06] text-white hover:bg-white/10 [&>svg]:text-white [&>svg]:opacity-80",
          className,
        )}
      >
        <SelectValue>{display}</SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-72 rounded-lg">
        {allLabel && (
          <SelectItem value={ALL} className="text-[12.5px]">
            {allLabel}
          </SelectItem>
        )}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-[12.5px]">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
