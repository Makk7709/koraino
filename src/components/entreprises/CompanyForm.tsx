import { Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { THEME, TONE_CLASSES } from "@/components/kora/labels";
import { Field, fieldClass } from "@/components/veille/kit";
import type { CompanyPriority, Theme } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { normalizeDomain, type CompanyErrors, type CompanyFormValues } from "./companyFormModel";
import { PRIORITY_OPTIONS, THEMES } from "./labels";
import { TagInput } from "./TagInput";

function ThemePicker({ value, onChange }: { value: Theme[]; onChange: (v: Theme[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Thématiques">
      {THEMES.map((t) => {
        const checked = value.includes(t);
        const tone = TONE_CLASSES[THEME[t].tone];
        return (
          <button
            key={t}
            type="button"
            role="checkbox"
            aria-checked={checked}
            onClick={() => onChange(checked ? value.filter((x) => x !== t) : [...value, t])}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition",
              checked
                ? cn(tone.bg, tone.fg, "border-transparent")
                : "border-border bg-white text-kora-ink-soft hover:border-kora-teal-light",
            )}
          >
            <span
              className={cn(
                "inline-flex size-3.5 items-center justify-center rounded-[4px] border",
                checked ? "border-current bg-current" : "border-border bg-white",
              )}
            >
              {checked && <Check className="size-2.5 text-white" strokeWidth={3} />}
            </span>
            {THEME[t].label}
          </button>
        );
      })}
    </div>
  );
}

/** Champs de la fiche registre (§3.1), partagés par la création et l'édition. */
export function CompanyFields({
  value,
  onChange,
  errors,
  idPrefix,
}: {
  value: CompanyFormValues;
  onChange: (v: CompanyFormValues) => void;
  errors: CompanyErrors;
  idPrefix: string;
}) {
  const set = <K extends keyof CompanyFormValues>(k: K, v: CompanyFormValues[K]) =>
    onChange({ ...value, [k]: v });
  const id = (k: string) => `${idPrefix}-${k}`;

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
      <Field
        label="Raison sociale"
        htmlFor={id("name")}
        required
        error={errors.name ?? null}
        className="col-span-2"
      >
        <Input
          id={id("name")}
          value={value.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="ex. Pasqal SAS"
          className={cn(fieldClass, errors.name && "border-kora-rose/60")}
        />
      </Field>
      <Field
        label="Alias"
        htmlFor={id("aliases")}
        hint="Noms commerciaux, sigles, anciennes dénominations — séparés par une virgule."
        className="col-span-2"
      >
        <TagInput
          id={id("aliases")}
          value={value.aliases}
          onChange={(v) => set("aliases", v)}
          placeholder="ex. Pasqal, PASQAL Quantum"
        />
      </Field>
      <Field label="Domaine officiel" htmlFor={id("domain")} required error={errors.domain ?? null}>
        <Input
          id={id("domain")}
          value={value.domain}
          onChange={(e) => set("domain", e.target.value)}
          onBlur={() => value.domain && set("domain", normalizeDomain(value.domain))}
          placeholder="pasqal.com"
          className={cn(
            fieldClass,
            "font-mono text-[12px] md:text-[12px]",
            errors.domain && "border-kora-rose/60",
          )}
        />
      </Field>
      <Field label="Secteur" htmlFor={id("sector")} required error={errors.sector ?? null}>
        <Input
          id={id("sector")}
          value={value.sector}
          onChange={(e) => set("sector", e.target.value)}
          placeholder="ex. Informatique quantique"
          className={cn(fieldClass, errors.sector && "border-kora-rose/60")}
        />
      </Field>
      <Field label="Territoire" htmlFor={id("territory")}>
        <Input
          id={id("territory")}
          value={value.territory}
          onChange={(e) => set("territory", e.target.value)}
          placeholder="ex. Inovallée · Meylan"
          className={fieldClass}
        />
      </Field>
      <Field label="Priorité éditoriale">
        <Select value={value.priority} onValueChange={(v) => set("priority", v as CompanyPriority)}>
          <SelectTrigger aria-label="Priorité" className={cn(fieldClass, "h-9")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRIORITY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-[13px]">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field
        label="Thématiques"
        hint="Servent aux regroupements du dashboard."
        className="col-span-2"
      >
        <ThemePicker value={value.themes} onChange={(v) => set("themes", v)} />
      </Field>
    </div>
  );
}
