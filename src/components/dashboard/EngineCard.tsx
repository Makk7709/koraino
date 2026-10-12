import { CircleCheck, Cpu, Sparkle } from "lucide-react";
import { HrefLink } from "@/components/signals/links";
import type { Dashboard } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/** Carte « Moteur d'analyse IA » (puce lumineuse, état, fonctionnalités). */
export function EngineCard({
  engine,
  loading,
}: {
  engine: Dashboard["engine"] | undefined;
  loading: boolean;
}) {
  const features =
    engine?.features && engine.features.length > 0
      ? engine.features
      : engine
        ? [
            `Veille multi-sources (${engine.sourcesCount} sources)`,
            "Analyse sémantique et scoring",
            "Détection de signaux faibles",
          ]
        : [];
  const active = engine?.active ?? false;

  return (
    <HrefLink
      href="/veille"
      className="kora-card group flex min-w-0 items-center gap-3.5 px-3.5 py-3 transition hover:shadow-[0_10px_28px_-14px_oklch(0.495_0.084_212.6/40%)]"
    >
      <span className="relative inline-flex size-[58px] shrink-0 items-center justify-center rounded-full bg-[radial-gradient(circle_at_50%_40%,oklch(0.36_0.07_220),oklch(0.2_0.04_230))] ring-[3px] ring-kora-lime/80 shadow-[0_0_18px_oklch(0.855_0.192_123.8/45%)]">
        <span className="absolute inset-[5px] rounded-full border border-kora-aurora/30" />
        <Cpu
          className="size-6 text-kora-aurora drop-shadow-[0_0_6px_var(--kora-aurora)]"
          strokeWidth={1.8}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <Sparkle className="size-4 shrink-0 fill-kora-teal-light/40 text-kora-teal" />
            <span className="truncate text-[13px] font-bold text-kora-ink">
              Moteur d&apos;analyse IA
            </span>
          </span>
          {engine ? (
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1 text-[11.5px] font-semibold",
                active ? "text-kora-green" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  active ? "bg-kora-green" : "bg-muted-foreground",
                )}
              />
              {active ? "Actif" : "En pause"}
            </span>
          ) : null}
        </span>
        <ul className="mt-1.5 space-y-1">
          {features.slice(0, 4).map((f) => (
            <li
              key={f}
              className="flex items-center gap-1.5 text-[11.5px] leading-tight text-kora-ink-soft"
            >
              <CircleCheck className="size-3.5 shrink-0 fill-kora-green text-white" />
              <span className="truncate">{f}</span>
            </li>
          ))}
          {!engine &&
            [0, 1, 2].map((i) => (
              <li
                key={i}
                className={cn("h-3 rounded bg-primary/10", loading && "animate-pulse")}
                style={{ width: `${80 - i * 12}%` }}
              />
            ))}
        </ul>
      </span>
    </HrefLink>
  );
}
