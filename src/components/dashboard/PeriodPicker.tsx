import { fr } from "date-fns/locale";
import { CalendarDays, ChevronDown } from "lucide-react";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { PERIOD_PRESETS, formatPeriod, type Period } from "./period";

/** Sélecteur de période du dashboard (maquette : « 📅 1 – 31 mars 2025 ⌄ »). */
export function PeriodPicker({
  value,
  onChange,
}: {
  value: Period;
  onChange: (p: Period) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>();

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDraft({ from: value.from, to: value.to });
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-border bg-white px-3 text-[12.5px] font-medium text-kora-ink shadow-[0_1px_2px_oklch(0.289_0.062_263.9/5%)] transition hover:border-kora-teal-light"
        >
          <CalendarDays className="size-4 text-kora-ink-soft" />
          <span className="whitespace-nowrap">{formatPeriod(value)}</span>
          <ChevronDown className="size-3.5 text-kora-ink-soft" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto rounded-xl p-0">
        <div className="flex">
          <ul className="flex w-40 flex-col gap-0.5 border-r border-border p-2">
            {PERIOD_PRESETS.map((p) => (
              <li key={p.key}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(p.get(new Date()));
                    setOpen(false);
                  }}
                  className="w-full rounded-md px-2.5 py-1.5 text-left text-[12.5px] font-medium text-kora-ink-soft transition hover:bg-kora-teal-bg hover:text-kora-teal-dark"
                >
                  {p.label}
                </button>
              </li>
            ))}
          </ul>
          <div>
            <Calendar
              mode="range"
              locale={fr}
              numberOfMonths={1}
              defaultMonth={value.from}
              selected={draft}
              onSelect={setDraft}
              className="[--cell-size:2.1rem]"
            />
            <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
              <span className="text-[11.5px] text-muted-foreground">
                {draft?.from && draft.to
                  ? formatPeriod({ from: draft.from, to: draft.to })
                  : "Choisissez une date de début et de fin"}
              </span>
              <button
                type="button"
                disabled={!draft?.from || !draft.to}
                onClick={() => {
                  if (draft?.from && draft.to) {
                    onChange({ from: draft.from, to: draft.to });
                    setOpen(false);
                  }
                }}
                className={cn(
                  "kora-btn-primary inline-flex h-7 items-center rounded-md px-3 text-[12px] font-semibold",
                  "disabled:pointer-events-none disabled:opacity-50",
                )}
              >
                Appliquer
              </button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
