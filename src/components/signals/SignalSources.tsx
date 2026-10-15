import { ExternalLink, Newspaper } from "lucide-react";
import { useState } from "react";
import { BrandMark } from "@/components/kora/BrandMark";
import { formatDateShort } from "@/components/kora/labels";
import { Pill } from "@/components/kora/primitives";
import type { Observation, SignalDetail } from "@/lib/api/types";

const VISIBLE = 4;

export function PerplexityPill({ via }: { via: Observation["via"] }) {
  if (via !== "perplexity") return null;
  return (
    <Pill tone="purple" size="sm" className="font-semibold">
      Perplexity
    </Pill>
  );
}

/** Publications rattachées au signal, celles dont le score tient compte. */
export function SignalSources({ signal }: { signal: SignalDetail }) {
  const [expanded, setExpanded] = useState(false);
  const all = signal.observations;
  if (all.length === 0) return null;
  const shown = expanded ? all : all.slice(0, VISIBLE);
  const reprises = all.filter((o) => o.isSyndicated).length;

  return (
    <div className="mt-3.5 rounded-xl border border-border bg-white p-3">
      <p className="flex flex-wrap items-baseline gap-x-2 text-[13px] font-bold text-kora-ink">
        <Newspaper className="size-4 self-center text-kora-teal" />
        Sources prises en compte dans le score
        <span className="text-[11.5px] font-medium text-muted-foreground">
          {all.length} {all.length > 1 ? "publications" : "publication"}
          {reprises > 0 && ` dont ${reprises} ${reprises > 1 ? "reprises" : "reprise"}`}
        </span>
      </p>
      <ul className="mt-2 divide-y divide-border">
        {shown.map((o) => (
          <li key={o.id} className="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0">
            <BrandMark name={o.outlet.name} brand={o.outlet.brand} size="xs" />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-1.5 text-[12px]">
                <span className="font-semibold text-kora-ink">{o.outlet.name}</span>
                <span className="text-muted-foreground">{formatDateShort(o.publishedAt)}</span>
                <PerplexityPill via={o.via} />
                {o.isSyndicated && (
                  <Pill tone="amber" size="sm" className="font-semibold">
                    Reprise
                  </Pill>
                )}
              </p>
              <p className="truncate text-[11.5px] text-kora-ink-soft" title={o.title}>
                {o.title}
              </p>
            </div>
            <a
              href={o.url}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={`Ouvrir la source ${o.outlet.name}`}
              className="shrink-0 rounded-md p-1 text-kora-teal hover:bg-kora-teal-bg"
            >
              <ExternalLink className="size-3.5" />
            </a>
          </li>
        ))}
      </ul>
      {all.length > VISIBLE && (
        <button
          type="button"
          className="mt-1.5 text-[11.5px] font-semibold text-kora-teal hover:underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Réduire" : `Voir les ${all.length - VISIBLE} autres sources`}
        </button>
      )}
    </div>
  );
}
