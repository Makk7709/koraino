import { Link } from "@tanstack/react-router";
import { Crosshair, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { CountBadge, EmptyState, GhostButton, KoraCard, Pill } from "@/components/kora/primitives";
import {
  SOURCE_ACCESS,
  SOURCE_TYPE,
  formatDateTime,
  formatRelative,
} from "@/components/kora/labels";
import { AddSourceDialog } from "@/components/veille/AddSourceDialog";
import { ExternalAnchor, IconAction } from "@/components/veille/kit";
import { FREQUENCY } from "@/components/veille/labels";
import { displayUrl } from "@/components/veille/runs";
import { useCollectSource } from "@/components/veille/useCollect";
import type { Source } from "@/lib/api/types";

export function CompanySourcesCard({
  companyId,
  sources,
  readOnly,
}: {
  companyId: string;
  sources: Source[];
  readOnly: boolean;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const collect = useCollectSource();

  return (
    <KoraCard
      title="Sources rattachées"
      badge={<CountBadge value={sources.length} tone="teal" />}
      action={
        <GhostButton
          className="h-8 px-3 text-[12px]"
          disabled={readOnly}
          onClick={() => setAddOpen(true)}
        >
          <Plus className="size-3.5" /> Ajouter une source
        </GhostButton>
      }
    >
      {sources.length === 0 ? (
        <EmptyState title="Aucune source rattachée">
          Sans source, l&apos;entreprise n&apos;est pas collectée par KORA Radar.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border/70">
          {sources.map((s) => {
            const st = SOURCE_ACCESS[s.access];
            const collecting = collect.isPending && collect.variables === s.id;
            return (
              <li key={s.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[13px] font-semibold text-kora-ink">{s.label}</p>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {SOURCE_TYPE[s.type]} · {FREQUENCY[s.frequency]}
                    </span>
                  </div>
                  <ExternalAnchor href={s.url} className="block truncate font-mono text-[11px]">
                    {displayUrl(s.url)}
                  </ExternalAnchor>
                  {s.access === "erreur" && (
                    <p className="mt-0.5 truncate text-[11px] text-kora-rose">
                      {s.failureCode ?? "ERREUR"} · {s.failureReason ?? "Motif non communiqué"} ·{" "}
                      {Math.min(s.attempts, 3)}/3 essais
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Pill tone={st.tone} size="sm">
                    {st.label}
                  </Pill>
                  <span
                    className="text-[10.5px] text-muted-foreground"
                    title={s.lastSuccessAt ? formatDateTime(s.lastSuccessAt) : undefined}
                  >
                    {s.lastSuccessAt
                      ? `réussie ${formatRelative(s.lastSuccessAt)}`
                      : "aucune réussite"}
                  </span>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <IconAction
                    icon={RefreshCw}
                    label="Collecter maintenant"
                    disabled={readOnly || collecting || s.access === "desactivee"}
                    spinning={collecting}
                    onClick={() => collect.mutate(s.id)}
                  />
                  <Link
                    to="/veille"
                    search={{ source: s.id }}
                    title="Voir dans le registre des sources"
                    aria-label="Voir dans le registre des sources"
                    className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-white text-kora-ink-soft transition hover:border-kora-teal-light hover:bg-kora-teal-bg hover:text-kora-teal-dark"
                  >
                    <Crosshair className="size-3.5" />
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <AddSourceDialog open={addOpen} onOpenChange={setAddOpen} companyId={companyId} />
    </KoraCard>
  );
}
