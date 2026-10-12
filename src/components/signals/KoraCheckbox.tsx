import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Case à cocher de la maquette (carré bleu plein une fois cochée). */
export function KoraCheckbox({
  checked,
  onCheckedChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onCheckedChange(!checked);
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex size-[17px] shrink-0 items-center justify-center rounded-[5px] border transition-colors focus-visible:ring-2 focus-visible:ring-kora-blue/40 focus-visible:outline-none disabled:opacity-40",
        checked
          ? "border-kora-blue bg-kora-blue text-white shadow-[0_1px_3px_oklch(0.592_0.157_253.3/35%)]"
          : "border-[oklch(0.84_0.025_250)] bg-white hover:border-kora-blue/60",
        className,
      )}
    >
      {checked && <Check className="size-3" strokeWidth={3.2} />}
    </button>
  );
}
