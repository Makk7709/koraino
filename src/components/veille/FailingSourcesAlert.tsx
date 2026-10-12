import { CircleCheck, RotateCw, TriangleAlert } from "lucide-react";
import { BrandMark } from "@/components/kora/BrandMark";
import { IconTile, Pill } from "@/components/kora/primitives";
import { formatRelative } from "@/components/kora/labels";
import type { Company, Source } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { ExternalAnchor } from "./kit";
import { displayUrl } from "./runs";
import { useCollectSource } from "./useCollect";

const MAX_ATTEMPTS = 3;
const VISIBLE = 4;

const RULE =
  "Une source indisponible n'est jamais présentée comme une « collecte réussie sans actualité » : son échec reste affiché jusqu'à la prochaine réussite.";

export function FailingSourcesAlert({
  sources,
  companies,
  readOnly,
  onShowAll,
}: {
  sources: Source[];
  companies: Map<string, Company>;
  readOnly: boolean;
  onShowAll: () => void;
}) {
  const collect = useCollectSource();
  const failing = sources.filter((s) => s.access === "erreur");

  if (failing.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-kora-green/20 bg-kora-green-bg/60 px-4 py-2.5">
        <CircleCheck className="size-4 shrink-0 text-kora-green" />
        <p className="text-[12px] text-kora-ink-soft">
          <span className="font-semibold text-kora-ink">Aucune source en échec.</span> {RULE}
        </p>
      </div>
    );
  }

  return (
    <section
      aria-label="Sources en échec"
      className="rounded-xl border border-kora-rose/25 bg-kora-rose-bg/55 p-4 shadow-[0_6px_24px_-12px_oklch(0.628_0.198_10/35%)]"
    >
      <header className="flex items-start gap-3">
        <IconTile icon={TriangleAlert} tone="rose" size="md" className="bg-white" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-bold text-kora-ink">
            {failing.length} source{failing.length > 1 ? "s" : ""} en échec d&apos;accès
          </h2>
          <p className="mt-0.5 text-[12px] text-kora-ink-soft">{RULE}</p>
        </div>
        {failing.length > VISIBLE && (
          <button
            type="button"
            onClick={onShowAll}
            className="shrink-0 text-[12px] font-semibold text-kora-rose hover:underline"
          >
            Voir les {failing.length} sources →
          </button>
        )}
      </header>

      <ul className="mt-3 space-y-1.5">
        {failing.slice(0, VISIBLE).map((s) => {
          const company = companies.get(s.companyId);
          const pending = collect.isPending && collect.variables === s.id;
          const exhausted = s.attempts >= MAX_ATTEMPTS;
          return (
            <li
              key={s.id}
              className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1.6fr)_auto_auto] items-center gap-4 rounded-lg border border-white bg-white/85 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                {company ? (
                  <BrandMark name={company.name} brand={company.brand} size="sm" />
                ) : (
                  <span className="size-8 shrink-0 rounded-lg bg-muted" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-bold text-kora-ink">
                    {company?.name ?? "Entreprise inconnue"}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">{s.label}</p>
                </div>
              </div>
              <ExternalAnchor href={s.url} className="truncate text-[12px]">
                {displayUrl(s.url)}
              </ExternalAnchor>
              <div className="flex min-w-0 items-center gap-2">
                <Pill tone="rose" size="sm" className="font-mono">
                  {s.failureCode ?? "ERREUR"}
                </Pill>
                <span
                  className="truncate text-[12px] text-kora-ink-soft"
                  title={s.failureReason ?? ""}
                >
                  {s.failureReason ?? "Motif non communiqué par la source"}
                </span>
              </div>
              <div
                className="flex flex-col items-end gap-1"
                title={`Dernier passage ${formatRelative(s.lastRunAt)}`}
              >
                <div className="flex gap-1" aria-hidden>
                  {Array.from({ length: MAX_ATTEMPTS }).map((_, i) => (
                    <span
                      key={i}
                      className={cn(
                        "size-1.5 rounded-full",
                        i < s.attempts ? "bg-kora-rose" : "bg-kora-rose/20",
                      )}
                    />
                  ))}
                </div>
                <span
                  className={cn(
                    "text-[11px] whitespace-nowrap tabular-nums",
                    exhausted ? "font-semibold text-kora-rose" : "text-kora-ink-soft",
                  )}
                >
                  {Math.min(s.attempts, MAX_ATTEMPTS)} / {MAX_ATTEMPTS} essais
                </span>
              </div>
              <button
                type="button"
                disabled={readOnly || pending}
                onClick={() => collect.mutate(s.id)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-kora-rose/30 bg-white px-3 text-[12px] font-semibold text-kora-rose transition hover:bg-kora-rose-bg disabled:pointer-events-none disabled:opacity-50"
              >
                <RotateCw className={cn("size-3.5", pending && "animate-spin")} />
                Réessayer
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
