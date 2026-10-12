import { CircleAlert, CircleCheck, Clock3, Link2, Repeat2, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { EVIDENCE } from "@/components/kora/labels";
import { KoraCard, Pill } from "@/components/kora/primitives";
import type { EvidenceState } from "@/lib/api/types";
import { cn } from "@/lib/utils";

function freshness(days: number | null): string {
  if (days === null) return "Inconnue";
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return "1 jour";
  return `${days} jours`;
}

/** Indicateur documentaire : état explicable, distinct du score, pas une probabilité. */
export function EvidencePanel({
  evidence,
  className,
}: {
  evidence: EvidenceState;
  className?: string;
}) {
  const level = EVIDENCE[evidence.level];
  return (
    <KoraCard
      title="Indicateur documentaire"
      badge={
        <Pill tone={level.tone} size="sm" className="font-semibold">
          {level.label}
        </Pill>
      }
      className={cn(className)}
    >
      <div className="grid grid-cols-3 gap-2">
        <Fact
          icon={<Link2 className="size-3.5" />}
          label="Source directe"
          value={evidence.directSource ? "Oui" : "Non"}
          ok={evidence.directSource}
        />
        <Fact
          icon={<Repeat2 className="size-3.5" />}
          label="Corroborations indépendantes"
          value={String(evidence.independentCorroborations)}
          ok={evidence.independentCorroborations > 0}
        />
        <Fact
          icon={<Clock3 className="size-3.5" />}
          label="Fraîcheur"
          value={freshness(evidence.freshnessDays)}
          ok={evidence.freshnessDays !== null && evidence.freshnessDays <= 14}
        />
      </div>

      <div className="mt-3">
        <p className="text-[11.5px] font-semibold text-kora-ink">Contradictions</p>
        {evidence.contradictions.length === 0 ? (
          <p className="mt-1 flex items-center gap-1.5 text-[12px] text-kora-ink-soft">
            <CircleCheck className="size-3.5 fill-kora-green text-white" />
            Aucune contradiction relevée
          </p>
        ) : (
          <ul className="mt-1 space-y-1">
            {evidence.contradictions.map((c) => (
              <li
                key={c}
                className="flex items-start gap-1.5 rounded-md bg-kora-rose-bg px-2 py-1 text-[12px] text-kora-ink"
              >
                <CircleAlert className="mt-px size-3.5 shrink-0 text-kora-rose" />
                {c}
              </li>
            ))}
          </ul>
        )}
      </div>

      {evidence.explanation.length > 0 && (
        <div className="mt-3">
          <p className="text-[11.5px] font-semibold text-kora-ink">Explications</p>
          <ul className="mt-1 space-y-1">
            {evidence.explanation.map((e) => (
              <li
                key={e}
                className="flex items-start gap-1.5 text-[12px] leading-snug text-kora-ink-soft"
              >
                <ShieldCheck className="mt-px size-3.5 shrink-0 text-kora-teal" />
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 border-t border-border pt-2.5 text-[11px] leading-snug text-muted-foreground">
        État explicable, pas une probabilité. Les reprises d&apos;un même communiqué ne comptent pas
        comme corroborations indépendantes.
      </p>
    </KoraCard>
  );
}

function Fact({
  icon,
  label,
  value,
  ok,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-white px-2.5 py-2">
      <p className="flex items-center gap-1 text-[10.5px] leading-tight text-muted-foreground">
        {icon}
        <span className="line-clamp-2">{label}</span>
      </p>
      <p className={cn("mt-1 text-[14px] font-bold", ok ? "text-kora-green" : "text-kora-amber")}>
        {value}
      </p>
    </div>
  );
}
