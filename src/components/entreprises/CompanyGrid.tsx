import { Globe, Lightbulb, MapPin, Radio, TriangleAlert } from "lucide-react";
import type { ComponentType } from "react";
import { BrandMark } from "@/components/kora/BrandMark";
import type { Company } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { PriorityPill, ThemePills } from "./CompanyBits";

function Stat({
  icon: Icon,
  value,
  label,
  alert = false,
}: {
  icon: ComponentType<{ className?: string }>;
  value: number;
  label: string;
  alert?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span
        className={cn(
          "inline-flex items-center gap-1 text-[15px] font-bold tabular-nums",
          alert ? "text-kora-rose" : "text-kora-ink",
        )}
      >
        <Icon className={cn("size-3.5", alert ? "text-kora-rose" : "text-kora-teal")} />
        {value}
      </span>
      <span className={cn("text-[11px]", alert ? "text-kora-rose" : "text-muted-foreground")}>
        {label}
      </span>
    </div>
  );
}

function CompanyCard({
  company: c,
  selected,
  onOpen,
}: {
  company: Company;
  selected: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "kora-card group flex flex-col p-4 text-left transition duration-200 hover:-translate-y-0.5 hover:border-kora-teal-light hover:shadow-[0_14px_32px_-16px_oklch(0.495_0.084_212.6/40%)]",
        selected && "border-kora-blue/40 bg-kora-blue-bg/50",
      )}
    >
      <div className="flex items-start gap-3">
        <BrandMark name={c.name} brand={c.brand} domain={c.domain} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold text-kora-ink group-hover:text-kora-teal-dark">
            {c.name}
          </p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-kora-teal">
            <Globe className="size-3 shrink-0" /> {c.domain}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-kora-ink-soft">{c.sector}</p>
        </div>
        <PriorityPill priority={c.priority} size="sm" />
      </div>

      <div className="mt-2.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
        <MapPin className="size-3 shrink-0" />
        {c.territory || "Territoire non renseigné"}
        {c.aliases.length > 0 && (
          <span className="truncate">
            {" · "}alias : {c.aliases.join(", ")}
          </span>
        )}
      </div>

      <ThemePills themes={c.themes} className="mt-2.5" />

      <div className="min-h-3.5 flex-1" />
      <div className="grid grid-cols-3 border-t border-border/70 pt-3">
        <Stat icon={Radio} value={c.sourceCount} label="sources" />
        <Stat
          icon={TriangleAlert}
          value={c.failingSourceCount}
          label="en échec"
          alert={c.failingSourceCount > 0}
        />
        <Stat icon={Lightbulb} value={c.signalCount} label="signaux" />
      </div>
    </button>
  );
}

export function CompanyGrid({
  companies,
  selectedId,
  onOpen,
}: {
  companies: Company[];
  selectedId: string | undefined;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-4 2xl:grid-cols-4">
      {companies.map((c) => (
        <CompanyCard
          key={c.id}
          company={c}
          selected={c.id === selectedId}
          onOpen={() => onOpen(c.id)}
        />
      ))}
    </div>
  );
}
