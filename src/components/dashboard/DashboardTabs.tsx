import { UnderlineTabs } from "@/components/kora/primitives";
import { PeriodPicker } from "./PeriodPicker";
import type { Period } from "./period";

export type DashboardTab = "vue" | "analyses" | "actualites" | "calendrier" | "espace";

const DASHBOARD_TABS: { value: DashboardTab; label: string }[] = [
  { value: "vue", label: "Vue éditoriale" },
  { value: "analyses", label: "Analyses" },
  { value: "actualites", label: "Toutes les actualités" },
  { value: "calendrier", label: "Calendrier éditorial" },
  { value: "espace", label: "Mon espace" },
];

/** Onglets soulignés + sélecteur de période. */
export function DashboardTabs({
  value,
  onChange,
  period,
  onPeriodChange,
}: {
  value: DashboardTab;
  onChange: (t: DashboardTab) => void;
  period: Period;
  onPeriodChange: (p: Period) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <UnderlineTabs
        tabs={DASHBOARD_TABS}
        value={value}
        onChange={onChange}
        className="gap-7 overflow-x-auto pt-1 shadow-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>button]:shrink-0 [&>button]:pb-2 [&>button]:text-[13px]"
      />
      <PeriodPicker value={period} onChange={onPeriodChange} />
    </div>
  );
}
