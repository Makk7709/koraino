import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { CATEGORY, THEME } from "@/components/kora/labels";
import type { Category, Theme } from "@/lib/api/types";
import { FilterSelect } from "./FilterSelect";
import { useCompanyOptions, useOutletOptions } from "./hooks";
import { CATEGORIES, THEMES, isCategory, isTheme } from "./signal-utils";

export interface SignalFilters {
  q?: string | undefined;
  companyId?: string | undefined;
  category?: Category | undefined;
  theme?: Theme | undefined;
  outlet?: string | undefined;
  sort: "recent" | "score";
}

const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ value: c, label: CATEGORY[c].label }));
const THEME_OPTIONS = THEMES.map((t) => ({ value: t, label: THEME[t].label }));
const SORT_OPTIONS = [
  { value: "score", label: "Meilleur score" },
  { value: "recent", label: "Plus récent" },
];

/** Barre de filtres de la page Signaux (recherche, entreprise, catégorie, thème, média, tri). */
export function SignalFiltersBar({
  value,
  onChange,
}: {
  value: SignalFilters;
  onChange: (patch: Partial<SignalFilters>) => void;
}) {
  const companyOptions = useCompanyOptions();
  const outletOptions = useOutletOptions();
  const [text, setText] = useState(value.q ?? "");

  useEffect(() => setText(value.q ?? ""), [value.q]);
  useEffect(() => {
    const t = setTimeout(() => {
      const next = text.trim() || undefined;
      if (next !== value.q) onChange({ q: next });
    }, 250);
    return () => clearTimeout(t);
  }, [text, value.q, onChange]);

  const active =
    !!value.q || !!value.companyId || !!value.category || !!value.theme || !!value.outlet;

  return (
    <div className="kora-card flex flex-wrap items-center gap-2 px-3 py-2.5">
      <label className="relative flex h-8 min-w-[220px] flex-1 items-center">
        <Search className="pointer-events-none absolute left-2.5 size-3.5 text-kora-ink-soft" />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Rechercher un titre, une entreprise, un média…"
          aria-label="Rechercher dans les signaux"
          className="h-8 w-full rounded-lg border border-border bg-white pr-7 pl-8 text-[12.5px] text-kora-ink shadow-[0_1px_2px_oklch(0.289_0.062_263.9/5%)] outline-none placeholder:text-muted-foreground focus:border-kora-teal-light focus:ring-2 focus:ring-kora-teal-light/30"
        />
        {text && (
          <button
            type="button"
            aria-label="Effacer la recherche"
            onClick={() => setText("")}
            className="absolute right-2 rounded p-0.5 text-muted-foreground hover:text-kora-ink"
          >
            <X className="size-3.5" />
          </button>
        )}
      </label>
      <FilterSelect
        label="Entreprise"
        allLabel="Toutes les entreprises"
        value={value.companyId}
        onValueChange={(v) => onChange({ companyId: v })}
        options={companyOptions}
        className="max-w-[12rem]"
      />
      <FilterSelect
        label="Catégorie"
        allLabel="Toutes les catégories"
        value={value.category}
        onValueChange={(v) => onChange({ category: isCategory(v) ? v : undefined })}
        options={CATEGORY_OPTIONS}
      />
      <FilterSelect
        label="Thème"
        allLabel="Tous les thèmes"
        value={value.theme}
        onValueChange={(v) => onChange({ theme: isTheme(v) ? v : undefined })}
        options={THEME_OPTIONS}
      />
      <FilterSelect
        label="Média"
        allLabel="Tous les médias"
        value={value.outlet}
        onValueChange={(v) => onChange({ outlet: v })}
        options={outletOptions}
        className="max-w-[12rem]"
      />
      <FilterSelect
        label="Tri"
        value={value.sort}
        onValueChange={(v) => onChange({ sort: v === "recent" ? "recent" : "score" })}
        options={SORT_OPTIONS}
        className="min-w-[8rem]"
      />
      {active && (
        <button
          type="button"
          onClick={() => {
            setText("");
            onChange({
              q: undefined,
              companyId: undefined,
              category: undefined,
              theme: undefined,
              outlet: undefined,
            });
          }}
          className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-kora-teal hover:bg-kora-teal-bg"
        >
          <X className="size-3.5" />
          Réinitialiser
        </button>
      )}
    </div>
  );
}
